// OpenAI 兼容的 Chat Completions 客户端。
// 通过环境变量适配 DeepSeek / Qwen / 豆包 / Kimi 等国内模型：
//   AI_BASE_URL   如 https://api.deepseek.com
//   AI_API_KEY    密钥
//   AI_MODEL      如 deepseek-chat

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
      temperature: 0.7,
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
