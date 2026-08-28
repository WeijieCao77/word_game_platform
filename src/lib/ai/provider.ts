// 模型供应商客户端：多供应商共存，一键切换。
import { recoverInlineToolCalls } from "./inline-tools";
//
// 推荐用法（各家 key 各自存放，切换只改 AI_PROVIDER 一个变量）：
//   AI_PROVIDER=openai | deepseek | anthropic | qwen | kimi
//   OPENAI_API_KEY / DEEPSEEK_API_KEY / ANTHROPIC_API_KEY / QWEN_API_KEY / KIMI_API_KEY
//   AI_MODEL 可选，不填用该供应商的默认模型
//
// 兼容旧用法：不设 AI_PROVIDER 时沿用 AI_BASE_URL + AI_API_KEY + AI_MODEL 三件套。
// base_url 含 "anthropic" 时走 Anthropic 原生 Messages API，其余走 OpenAI Chat Completions。

interface ProviderDef {
  base: string;
  keyEnv: string;
  defaultModel: string;
}

const PROVIDERS: Record<string, ProviderDef> = {
  openai: { base: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", defaultModel: "gpt-5-mini" },
  // deepseek-chat/reasoner 别名 2026-07 已下线，V4 起用 deepseek-v4-flash / deepseek-v4-pro
  deepseek: { base: "https://api.deepseek.com", keyEnv: "DEEPSEEK_API_KEY", defaultModel: "deepseek-v4-flash" },
  anthropic: { base: "https://api.anthropic.com", keyEnv: "ANTHROPIC_API_KEY", defaultModel: "claude-haiku-4-5" },
  qwen: { base: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyEnv: "QWEN_API_KEY", defaultModel: "qwen-plus" },
  kimi: { base: "https://api.moonshot.cn/v1", keyEnv: "KIMI_API_KEY", defaultModel: "moonshot-v1-8k" },
};

interface Resolved {
  base: string;
  apiKey: string;
  model: string;
}

function resolveProvider(): Resolved | null {
  const name = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (name && PROVIDERS[name]) {
    const p = PROVIDERS[name];
    const apiKey = process.env[p.keyEnv] ?? process.env.AI_API_KEY ?? "";
    const base = (process.env.AI_BASE_URL_OVERRIDE ?? p.base).replace(/\/$/, "");
    const model = process.env.AI_MODEL?.trim() || p.defaultModel;
    if (!apiKey) return null;
    return { base, apiKey, model };
  }
  // 旧三件套
  const base = (process.env.AI_BASE_URL ?? "").replace(/\/$/, "");
  const apiKey = process.env.AI_API_KEY ?? "";
  const model = process.env.AI_MODEL ?? "";
  if (!base || !apiKey || !model) return null;
  return { base, apiKey, model };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResult {
  message: ChatMessage;
  totalTokens: number;
}

export function aiConfigured(): boolean {
  return resolveProvider() !== null;
}

/** 运维可见的非敏感信息：当前供应商与模型名（绝不含密钥） */
export function aiRuntimeInfo(): { provider: string; model: string | null } {
  const name = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  const provider = name && PROVIDERS[name] ? name : "legacy";
  return { provider, model: resolveProvider()?.model ?? null };
}

/**
 * 流**空闲**多久算断了（毫秒）。
 *
 * 注意是「空闲」不是「总时长」：写一整个游戏文件本来就要跑好几分钟，
 * 按总时长掐会把正常的长生成掐死——那比现在这个毛病更糟。
 * 这里量的是「有多久一个字节都没来」，正常流式调用不会出现这种间隔。
 *
 * 放宽到 3 分钟是给推理模型留的：上下文很大的时候，首字之前它可能想很久。
 */
function streamIdleMs(): number {
  return Number(process.env.AI_STREAM_IDLE_MS ?? 180000);
}

async function readSSE(res: Response, onEvent: (payload: string) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("AI 服务没有返回可读的流");
  const decoder = new TextDecoder();
  let buf = "";
  const idleMs = streamIdleMs();
  let idle: ReturnType<typeof setTimeout> | undefined;

  /**
   * 看门狗：**连接还在、但对面不说话了**，这种情况原来会一直挂到整轮预算用光
   * （异步任务 12 分钟），作者只能干等。等到的还是一句没头没尾的错误。
   *
   * 上游把流掐断那种（`TypeError: terminated`）本来就会抛，不归这里管；
   * 这里补的是「没抛，但也不来了」那一种。
   */
  const readOnce = (): Promise<ReadableStreamReadResult<Uint8Array>> =>
    Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        idle = setTimeout(() => {
          // **先 reject 再 cancel**，顺序反了看门狗就白设了：
          // `reader.cancel()` 会让挂着的那个 `read()` 以 `{done:true}` 结束，
          // Promise.race 谁先落谁赢——于是流被判成「正常读完了」，
          // 拿到半份回复当成功返回。自测里就是这么错的。
          reject(
            new Error(
              `AI 服务连着 ${Math.round(idleMs / 1000)} 秒没有再发来任何内容，判定这条连接已经断了（stream idle timeout）`
            )
          );
          void reader.cancel().catch(() => {});
        }, idleMs);
      }),
    ]).finally(() => clearTimeout(idle));

  const emit = (block: string): void => {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload && payload !== "[DONE]") onEvent(payload);
    }
  };

  for (;;) {
    const { done, value } = await readOnce();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE 以空行分隔事件；\r\n 也要认（有的网关会改写换行）
    for (;;) {
      const m = buf.match(/\r?\n\r?\n/);
      if (!m || m.index === undefined) break;
      emit(buf.slice(0, m.index));
      buf = buf.slice(m.index + m[0].length);
    }
  }
  if (buf.trim()) emit(buf);
}

/**
 * 单次回复的 token 上限。
 *
 * 走流式之后不必再为超时压低这个数——文档的建议是流式给到 6.4 万。
 * 它是上限不是消耗，模型写多少算多少；压太低反而会把一份写到一半的
 * 游戏文件截断，那比慢更糟。
 */
function maxTokens(): number {
  return Number(process.env.AI_MAX_TOKENS ?? 64000);
}

export async function callChat(messages: ChatMessage[], tools?: ToolDef[]): Promise<ChatResult> {
  const p = resolveProvider();
  if (!p) throw new Error("AI 尚未配置");
  if (p.base.includes("anthropic")) return callAnthropic(p, messages, tools);
  // stream_options 是 OpenAI / DeepSeek 那边的约定，用来让最后一帧带上 usage。
  // 有的兼容供应商不认这个字段、还会直接 400；那就去掉它重试一次
  // ——宁可这一轮统计不到 token，也不能整条通道不可用。
  const send = async (withStreamOptions: boolean): Promise<Response> =>
    fetch(`${p.base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${p.apiKey}`,
      },
      body: JSON.stringify({
        model: p.model,
        messages,
        tools: tools && tools.length > 0 ? tools : undefined,
        max_tokens: maxTokens(),
        // 流式：写一整个游戏文件动辄上万 token，非流式连接会被中途掐断（见 readSSE 的注释）
        stream: true,
        ...(withStreamOptions ? { stream_options: { include_usage: true } } : {}),
        // 不设 temperature：gpt-5 系推理模型只接受默认值，其余供应商默认值也够用
        // gpt-5 系默认思考较深，交互式工作台压低推理档换速度（可用 AI_REASONING_EFFORT 覆盖）
        ...(p.model.startsWith("gpt-5") ? { reasoning_effort: process.env.AI_REASONING_EFFORT ?? "low" } : {}),
      }),
    });

  let res = await send(true);
  if (res.status === 400) {
    const text = await res.text();
    if (text.includes("stream_options")) {
      res = await send(false);
    } else {
      throw new Error(`AI 服务返回 400：${text.slice(0, 300)}`);
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI 服务返回 ${res.status}：${text.slice(0, 300)}`);
  }

  const texts: string[] = [];
  // 工具调用是按 index 分片流回来的：id 与函数名通常只在第一片出现，
  // 参数 JSON 一片片拼。用 index 归位，别按到达顺序拼。
  const partial = new Map<number, { id: string; name: string; args: string }>();
  let total = 0;
  await readSSE(res, (payload) => {
    let ev: {
      choices?: {
        delta?: {
          content?: string | null;
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
        };
      }[];
      usage?: { total_tokens?: number };
    };
    try {
      ev = JSON.parse(payload);
    } catch {
      return; // 心跳/注释行，忽略
    }
    if (ev.usage?.total_tokens) total = ev.usage.total_tokens;
    const delta = ev.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === "string") texts.push(delta.content);
    for (const [i, call] of (delta.tool_calls ?? []).entries()) {
      const idx = call.index ?? i;
      const cur = partial.get(idx) ?? { id: "", name: "", args: "" };
      if (call.id) cur.id = call.id;
      if (call.function?.name) cur.name = call.function.name;
      if (call.function?.arguments) cur.args += call.function.arguments;
      partial.set(idx, cur);
    }
  });

  const toolCalls: ToolCall[] = [...partial.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, c]) => ({
      id: c.id || `call_${idx}`,
      type: "function" as const,
      function: { name: c.name, arguments: c.args || "{}" },
    }));
  // 有的模型/网关不走 tool_calls，把调用当正文吐出来——捞回来，别让这一轮白干
  const raw = texts.join("");
  const rescued = toolCalls.length === 0 ? recoverInlineToolCalls(raw) : { text: raw, calls: [] };
  const content = rescued.text;
  const calls = toolCalls.length > 0 ? toolCalls : rescued.calls;
  if (!content && calls.length === 0) throw new Error("AI 服务返回了空回复");
  return {
    message: { role: "assistant", content: content || null, tool_calls: calls.length > 0 ? calls : undefined },
    totalTokens: total,
  };
}

// ---------------- Anthropic 原生 Messages API ----------------
// agent 循环内部统一用 OpenAI 消息形状，这里做双向转换。

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

function toAnthropicPayload(
  messages: ChatMessage[],
  tools?: ToolDef[]
): { system: string; messages: unknown[]; tools?: unknown[] } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content ?? "")
    .join("\n\n");
  const out: { role: "user" | "assistant"; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      out.push({ role: "user", content: m.content ?? "" });
    } else if (m.role === "assistant") {
      const blocks: AnthropicBlock[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const call of m.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: call.function.arguments ? JSON.parse(call.function.arguments) : {},
        });
      }
      if (blocks.length > 0) out.push({ role: "assistant", content: blocks });
    } else if (m.role === "tool") {
      // 并行工具结果必须合并进同一条 user 消息
      const block = { type: "tool_result", tool_use_id: m.tool_call_id, content: m.content ?? "" };
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as unknown[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return {
    system,
    messages: out,
    tools: tools?.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    })),
  };
}

async function callAnthropic(p: Resolved, messages: ChatMessage[], tools?: ToolDef[]): Promise<ChatResult> {
  const payload = toAnthropicPayload(messages, tools);
  const res = await fetch(`${p.base}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": p.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: maxTokens(),
      // 流式：max_tokens 开大就必须流式，否则会撞 HTTP 超时（见 readSSE 的注释）
      stream: true,
      system: payload.system || undefined,
      messages: payload.messages,
      tools: payload.tools && payload.tools.length > 0 ? payload.tools : undefined,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI 服务返回 ${res.status}：${text.slice(0, 300)}`);
  }

  // Anthropic 的流按「内容块」组织：content_block_start 宣布这一块是什么，
  // content_block_delta 一片片送内容（文字是 text_delta，工具参数是 input_json_delta），
  // content_block_stop 收尾。工具参数同样要一片片拼成完整 JSON。
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  const blocks = new Map<number, { type: string; id: string; name: string; json: string }>();
  let inTok = 0;
  let outTok = 0;

  await readSSE(res, (payload) => {
    let ev: {
      type?: string;
      index?: number;
      message?: { usage?: { input_tokens?: number; output_tokens?: number } };
      content_block?: { type?: string; id?: string; name?: string };
      delta?: { type?: string; text?: string; partial_json?: string };
      usage?: { output_tokens?: number };
      error?: { message?: string };
    };
    try {
      ev = JSON.parse(payload);
    } catch {
      return;
    }
    switch (ev.type) {
      case "message_start":
        inTok = ev.message?.usage?.input_tokens ?? 0;
        outTok = ev.message?.usage?.output_tokens ?? 0;
        break;
      case "content_block_start":
        blocks.set(ev.index ?? 0, {
          type: ev.content_block?.type ?? "text",
          id: ev.content_block?.id ?? "",
          name: ev.content_block?.name ?? "",
          json: "",
        });
        break;
      case "content_block_delta": {
        const b = blocks.get(ev.index ?? 0);
        if (!b) break;
        if (ev.delta?.type === "text_delta" && ev.delta.text) textParts.push(ev.delta.text);
        if (ev.delta?.type === "input_json_delta" && ev.delta.partial_json) b.json += ev.delta.partial_json;
        break;
      }
      case "message_delta":
        if (ev.usage?.output_tokens) outTok = ev.usage.output_tokens;
        break;
      case "error":
        throw new Error(`AI 服务流中报错：${ev.error?.message ?? "未知"}`);
      default:
        break;
    }
  });

  for (const [idx, b] of [...blocks.entries()].sort((a, c) => a[0] - c[0])) {
    if (b.type !== "tool_use") continue;
    toolCalls.push({
      id: b.id || `call_${idx}`,
      type: "function",
      // 参数为空时给个 {}，不然下游 JSON.parse 会炸
      function: { name: b.name, arguments: b.json || "{}" },
    });
  }

  // 同上：原生接口一般不会这样，但换个网关就说不准了，两条路都兜一下
  const rawText = textParts.join("");
  const rescued = toolCalls.length === 0 ? recoverInlineToolCalls(rawText) : { text: rawText, calls: [] };
  const content = rescued.text;
  const calls = toolCalls.length > 0 ? toolCalls : rescued.calls;
  if (!content && calls.length === 0) throw new Error("AI 服务返回了空回复");
  return {
    message: {
      role: "assistant",
      content: content || null,
      tool_calls: calls.length > 0 ? calls : undefined,
    },
    totalTokens: inTok + outTok,
  };
}
