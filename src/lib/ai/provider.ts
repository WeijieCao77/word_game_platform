// 模型供应商客户端：多供应商共存，一键切换。
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
  deepseek: { base: "https://api.deepseek.com", keyEnv: "DEEPSEEK_API_KEY", defaultModel: "deepseek-chat" },
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

export async function callChat(messages: ChatMessage[], tools?: ToolDef[]): Promise<ChatResult> {
  const p = resolveProvider();
  if (!p) throw new Error("AI 尚未配置");
  if (p.base.includes("anthropic")) return callAnthropic(p, messages, tools);
  const res = await fetch(`${p.base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${p.apiKey}`,
    },
    body: JSON.stringify({
      model: p.model,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      // 不设 temperature：gpt-5 系推理模型只接受默认值，其余供应商默认值也够用
      // gpt-5 系默认思考较深，交互式工作台压低推理档换速度（可用 AI_REASONING_EFFORT 覆盖）
      ...(p.model.startsWith("gpt-5") ? { reasoning_effort: process.env.AI_REASONING_EFFORT ?? "low" } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI 服务返回 ${res.status}：${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices: { message: ChatMessage }[];
    usage?: { total_tokens?: number };
  };
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("AI 服务返回了空回复");
  return { message, totalTokens: data.usage?.total_tokens ?? 0 };
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
      max_tokens: 16000,
      system: payload.system || undefined,
      messages: payload.messages,
      tools: payload.tools && payload.tools.length > 0 ? payload.tools : undefined,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI 服务返回 ${res.status}：${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    content: AnthropicBlock[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const block of data.content ?? []) {
    if (block.type === "text" && block.text) textParts.push(block.text);
    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id ?? `call_${toolCalls.length}`,
        type: "function",
        function: { name: block.name ?? "", arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }
  return {
    message: {
      role: "assistant",
      content: textParts.join("\n") || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    },
    totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
  };
}
