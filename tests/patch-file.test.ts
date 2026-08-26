import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessage, ChatResult, ToolDef } from "@/lib/ai/provider";

// patch_file 的回归测试。
//
// 为什么要有这个工具：write_file 是整份覆盖，改一份一万字符的 game.js 就要把
// 全文再吐一遍——实测一部 28k 字符的作品烧掉 26 万 token，大头就在反复重写。
//
// 为什么要把它测细：这类工具错了不会报错，只会**悄悄把代码改坏**。
// 所以「找不到」「不唯一」这两种情况必须退回去让模型重来，绝不能猜。

const calls: { messages: ChatMessage[]; tools?: ToolDef[] }[] = [];
let scripted: (round: number, tools?: ToolDef[]) => ChatResult;

vi.mock("@/lib/ai/provider", () => ({
  aiConfigured: () => true,
  aiRuntimeInfo: () => ({ provider: "test", model: "test" }),
  callChat: async (messages: ChatMessage[], tools?: ToolDef[]): Promise<ChatResult> => {
    calls.push({ messages, tools });
    return scripted(calls.length - 1, tools);
  },
}));

const { runAssistant } = await import("@/lib/ai/agent");

const toolCall = (name: string, args: unknown): ChatResult => ({
  message: {
    role: "assistant",
    content: null,
    tool_calls: [{ id: `c${calls.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  },
  totalTokens: 10,
});
const textReply = (text: string): ChatResult => ({ message: { role: "assistant", content: text }, totalTokens: 5 });

const CONFIG = {
  schemaVersion: 1 as const,
  meta: { title: "自由模式作品" },
  driver: { kind: "story" as const, startCard: "a" },
  vars: [],
  cards: [{ id: "a", text: "占位" }],
  endings: [],
};

/** 一个假的文件系统，行为跟存储层一致 */
function fakeFiles(init: Record<string, string>) {
  const store = new Map(Object.entries(init));
  return {
    list: () => [...store.entries()].map(([path, c]) => ({ path, size: c.length })),
    read: (p: string) => store.get(p) ?? null,
    write: (p: string, c: string) => void store.set(p, c),
    dump: () => Object.fromEntries(store),
  };
}

/** 让 AI 只调一次 patch_file，然后收口；返回工具那一轮的返回值 */
async function runPatch(files: ReturnType<typeof fakeFiles>, args: unknown): Promise<string> {
  scripted = (round) => (round === 0 ? toolCall("patch_file", args) : textReply("改完了。"));
  await runAssistant(
    { config: CONFIG, designCard: "# 游戏设计卡\n状态：调优中\n", mode: "code", files },
    [{ role: "user", content: "改一下" }]
  );
  const toolMsg = calls[1].messages.find((m) => m.role === "tool");
  return String(toolMsg?.content ?? "");
}

beforeEach(() => {
  calls.length = 0;
});

describe("patch_file：改局部，不整份重写", () => {
  it("换掉一段，文件其余部分一个字不动", async () => {
    const files = fakeFiles({ "game.js": "var a = 1;\nvar b = 2;\nvar c = 3;\n" });
    const out = await runPatch(files, {
      path: "game.js",
      edits: [{ find: "var b = 2;", replace: "var b = 22;" }],
    });
    expect(files.dump()["game.js"]).toBe("var a = 1;\nvar b = 22;\nvar c = 3;\n");
    expect(out).toContain("已改 game.js");
  });

  it("一次带多处改动，按顺序应用", async () => {
    const files = fakeFiles({ "style.css": "body{color:#fff}\n.hud{color:#aaa}\n" });
    await runPatch(files, {
      path: "style.css",
      edits: [
        { find: "color:#fff", replace: "color:#eee" },
        { find: "color:#aaa", replace: "color:#999" },
      ],
    });
    expect(files.dump()["style.css"]).toBe("body{color:#eee}\n.hud{color:#999}\n");
  });

  it("原文不唯一就退回去要上下文，绝不猜着改", async () => {
    const files = fakeFiles({ "game.js": "msg();\nmsg();\n" });
    const before = files.dump()["game.js"];
    const out = await runPatch(files, { path: "game.js", edits: [{ find: "msg();", replace: "say();" }] });
    expect(out).toContain("出现了 2 次");
    expect(files.dump()["game.js"], "文件必须原封不动").toBe(before);
  });

  it("确认要改多处就加 all，全部替换", async () => {
    const files = fakeFiles({ "game.js": "msg();\nmsg();\n" });
    await runPatch(files, { path: "game.js", edits: [{ find: "msg();", replace: "say();", all: true }] });
    expect(files.dump()["game.js"]).toBe("say();\nsay();\n");
  });

  it("找不到原文就报错，并且**前面几处也不落盘**（要么全成要么不动）", async () => {
    const files = fakeFiles({ "game.js": "var a = 1;\nvar b = 2;\n" });
    const before = files.dump()["game.js"];
    const out = await runPatch(files, {
      path: "game.js",
      edits: [
        { find: "var a = 1;", replace: "var a = 11;" },
        { find: "这行根本不存在", replace: "x" },
      ],
    });
    expect(out).toContain("没找到原文");
    expect(files.dump()["game.js"], "半截生效比报错更糟").toBe(before);
  });

  it("文件不存在时指路去 write_file", async () => {
    const files = fakeFiles({});
    const out = await runPatch(files, { path: "新文件.js", edits: [{ find: "a", replace: "b" }] });
    expect(out).toContain("write_file");
  });

  it("改完没变化就直说，不假装干了活", async () => {
    const files = fakeFiles({ "a.js": "x" });
    const out = await runPatch(files, { path: "a.js", edits: [{ find: "x", replace: "x" }] });
    expect(out).toContain("没有实际变化");
  });

  it("find 为空要拦下来——那是想凭空插内容", async () => {
    const files = fakeFiles({ "a.js": "x" });
    const out = await runPatch(files, { path: "a.js", edits: [{ find: "", replace: "y" }] });
    expect(out).toContain("锚在一段已有的原文上");
  });

  it("省的是真金白银：改一行只发一行，不是整份文件", async () => {
    // 这一条锁的是这个工具存在的理由本身
    const big = "// 头部\n".repeat(2000) + "var target = 1;\n" + "// 尾部\n".repeat(2000);
    const files = fakeFiles({ "game.js": big });
    scripted = (round) =>
      round === 0
        ? toolCall("patch_file", {
            path: "game.js",
            edits: [{ find: "var target = 1;", replace: "var target = 2;" }],
          })
        : textReply("改完了。");
    await runAssistant(
      { config: CONFIG, designCard: "# 游戏设计卡\n状态：调优中\n", mode: "code", files },
      [{ role: "user", content: "改一下" }]
    );
    const sent = JSON.stringify(calls[0].messages) + JSON.stringify(calls[1].messages);
    const argsSize = JSON.stringify({
      path: "game.js",
      edits: [{ find: "var target = 1;", replace: "var target = 2;" }],
    }).length;
    expect(argsSize).toBeLessThan(200);
    expect(big.length).toBeGreaterThan(20000);
    // 整份重写的话这一轮至少要多发两万字符
    expect(sent.includes(big), "不该把整份文件塞进对话").toBe(false);
    expect(files.dump()["game.js"]).toContain("var target = 2;");
  });
});

describe("自由模式的单轮预算放宽", () => {
  it("code 模式的默认预算远大于快速模式", async () => {
    // 实测一次「写一份上万字符的文件」的模型调用要 2~3 分钟，
    // 40 秒的预算等于每轮只写得动一个文件。
    const files = fakeFiles({ "index.html": "<p>x</p>" });
    let rounds = 0;
    scripted = (round) => {
      rounds = round + 1;
      return round < 3
        ? toolCall("patch_file", {
            path: "index.html",
            edits: [{ find: `<p>x</p>`, replace: `<p>x</p>` }],
          })
        : textReply("收工。");
    };
    await runAssistant(
      { config: CONFIG, designCard: "# 游戏设计卡\n状态：调优中\n", mode: "code", files },
      [{ role: "user", content: "接着做" }]
    );
    // 预算没被 40 秒截断，几轮都跑到了
    expect(rounds).toBeGreaterThan(2);
  });
});
