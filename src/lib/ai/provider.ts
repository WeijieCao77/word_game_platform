// 模型供应商客户端。通过环境变量热插拔：
//   AI_BASE_URL   https://api.openai.com/v1（OpenAI）
//                 https://api.anthropic.com（Claude，走原生 Messages API）
//                 https://api.deepseek.com 等 OpenAI 兼容端点（DeepSeek/Qwen/Kimi…）
//   AI_API_KEY    对应密钥
//   AI_MODEL      gpt-4o-mini / claude-haiku-4-5 / deepseek-chat …
// base_url 含 "anthropic" 时走 Anthropic 原生协议，其余走 OpenAI Chat Completions。

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
  return !!(process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL);
}

export async function callChat(messages: ChatMessage[], tools?: ToolDef[]): Promise<ChatResult> {
  const base = (process.env.AI_BASE_URL ?? "").replace(/\/$/, "");
  if (base.includes("anthropic")) return callAnthropic(base, messages, tools);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      // 不设 temperature：gpt-5 系推理模型只接受默认值，其余供应商默认值也够用
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

async function callAnthropic(base: string, messages: ChatMessage[], tools?: ToolDef[]): Promise<ChatResult> {
  const payload = toAnthropicPayload(messages, tools);
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.AI_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL,
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
