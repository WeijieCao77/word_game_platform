import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// 流式解析的回归测试。
//
// 这一块是「AI 从来不写文件」的真因所在：让模型写一整个 HTML 游戏，
// 输出上万 token、生成好几分钟，非流式的连接会被中途掐断
// （线上抓到的正是 undici 的 {"error":"terminated"}）。改成流式之后，
// 拼装逻辑就成了新的风险点——工具参数是一片片送回来的，拼错了不会报错，
// 只会得到一份坏 JSON。所以这里逐条锁住拼装行为。

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});
afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("Anthropic 流式：把分片拼回完整回复", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.AI_MODEL = "claude-test";
  });

  it("文字分片按顺序拼起来", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"深夜"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"两点，"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"机房还亮着。"}}\n\n',
        'data: {"type":"message_delta","usage":{"output_tokens":42}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ])
    ));
    const { callChat } = await import("@/lib/ai/provider");
    const r = await callChat([{ role: "user", content: "写个开头" }]);
    expect(r.message.content).toBe("深夜两点，机房还亮着。");
    expect(r.totalTokens).toBe(52);
  });

  it("工具参数的 JSON 一片片拼成完整的一份", async () => {
    // 这正是写文件的形状：write_file 的 content 会被切成很多片
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}\n\n',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"write_file"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"index"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":".html\\",\\"content\\":\\"<h1>"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"你好</h1>\\"}"}}\n\n',
        'data: {"type":"content_block_stop","index":0}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ])
    ));
    const { callChat } = await import("@/lib/ai/provider");
    const r = await callChat([{ role: "user", content: "写文件" }], []);
    const call = r.message.tool_calls?.[0];
    expect(call?.function.name).toBe("write_file");
    const args = JSON.parse(call!.function.arguments) as { path: string; content: string };
    expect(args.path).toBe("index.html");
    expect(args.content).toBe("<h1>你好</h1>");
  });

  it("一次回复里的多个工具调用各归各的，不会串味", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"a","name":"write_file"}}\n\n',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"b","name":"read_file"}}\n\n',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"b.js\\"}"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.js\\"}"}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ])
    ));
    const { callChat } = await import("@/lib/ai/provider");
    const r = await callChat([{ role: "user", content: "两件事" }], []);
    expect(r.message.tool_calls).toHaveLength(2);
    expect(JSON.parse(r.message.tool_calls![0].function.arguments).path).toBe("a.js");
    expect(JSON.parse(r.message.tool_calls![1].function.arguments).path).toBe("b.js");
  });

  it("一个 TCP 包里挤了多条事件、事件被切成两半，都要还原得回来", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\ndata: {"type":"content_bl',
        'ock_delta","index":0,"delta":{"type":"text_delta","text":"半截"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"接上了"}}\n\n',
      ])
    ));
    const { callChat } = await import("@/lib/ai/provider");
    const r = await callChat([{ role: "user", content: "x" }]);
    expect(r.message.content).toBe("半截接上了");
  });

  it("流里报错要抛出来，不能当成空回复咽下去", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse(['data: {"type":"error","error":{"message":"overloaded"}}\n\n'])
    ));
    const { callChat } = await import("@/lib/ai/provider");
    await expect(callChat([{ role: "user", content: "x" }])).rejects.toThrow(/overloaded/);
  });

  it("请求体里带 stream 与放大的 max_tokens", async () => {
    const spy = vi.fn(async () => sseResponse(['data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n']));
    vi.stubGlobal("fetch", spy);
    const { callChat } = await import("@/lib/ai/provider");
    await callChat([{ role: "user", content: "x" }]);
    const body = JSON.parse((spy.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBeGreaterThanOrEqual(32000);
  });
});

describe("OpenAI 兼容流式", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.AI_MODEL = "test-model";
  });

  it("文字分片拼起来，用量从 usage 事件取", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        'data: {"choices":[{"delta":{}}],"usage":{"total_tokens":77}}\n\n',
        "data: [DONE]\n\n",
      ])
    ));
    const { callChat } = await import("@/lib/ai/provider");
    const r = await callChat([{ role: "user", content: "x" }]);
    expect(r.message.content).toBe("你好");
    expect(r.totalTokens).toBe(77);
  });

  it("供应商不认 stream_options 就去掉重试一次，不让整条通道挂掉", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      calls.push(init.body);
      if (calls.length === 1) {
        return new Response('{"error":{"message":"unknown field stream_options"}}', { status: 400 });
      }
      return sseResponse(['data: {"choices":[{"delta":{"content":"退而求其次也能跑"}}]}\n\n', "data: [DONE]\n\n"]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { callChat } = await import("@/lib/ai/provider");
    const r = await callChat([{ role: "user", content: "x" }]);
    expect(r.message.content).toBe("退而求其次也能跑");
    expect(JSON.parse(calls[0]).stream_options).toBeDefined();
    expect(JSON.parse(calls[1]).stream_options).toBeUndefined();
    expect(JSON.parse(calls[1]).stream).toBe(true);
  });

  it("400 但不是 stream_options 的问题就直接报错，不要瞎重试", async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"model not found"}}', { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { callChat } = await import("@/lib/ai/provider");
    await expect(callChat([{ role: "user", content: "x" }])).rejects.toThrow(/model not found/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("工具调用按 index 归位，参数拼成完整 JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"write_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.html\\"}"}}]}}]}\n\n',
        "data: [DONE]\n\n",
      ])
    ));
    const { callChat } = await import("@/lib/ai/provider");
    const r = await callChat([{ role: "user", content: "x" }], []);
    const call = r.message.tool_calls?.[0];
    expect(call?.function.name).toBe("write_file");
    expect(JSON.parse(call!.function.arguments).path).toBe("a.html");
  });
});
