import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatMessage, ChatResult, ToolDef } from "@/lib/ai/provider";

// play_check：让 AI **当轮**就能知道自己改完之后作品还走不走得通。
//
// 为什么要有它：原来 AI 是写完就交差，对不对要等下一轮才知道——而下一轮拿到的
// 结论还可能是错的（实测里就有一次检查撞上容器重启，报「第 4 步走不下去」，
// 我据此判了「上一轮把代码改坏了」，其实代码一个字都没动）。
// 人写代码是改一次跑一次看一眼，这个工具补的就是那一眼。
//
// 这里守两件事：① 结果要真的送到模型面前；② **没跑成的时候绝不能长得像通过**。

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
const { SqliteGameStore } = await import("@/lib/store/sqlite");

const toolCall = (name: string): ChatResult => ({
  message: {
    role: "assistant",
    content: null,
    tool_calls: [{ id: `c${calls.length}`, type: "function", function: { name, arguments: "{}" } }],
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

/** 让 AI 只调一次 play_check，然后收口；返回工具那一轮的返回值 */
async function runCheck(runPlayCheck?: () => Promise<string>): Promise<string> {
  scripted = (round) => (round === 0 ? toolCall("play_check") : textReply("看完了。"));
  await runAssistant(
    {
      config: CONFIG,
      designCard: "# 游戏设计卡\n状态：调优中\n",
      mode: "code",
      files: { list: () => [], read: () => null, write: () => {} },
      runPlayCheck,
    },
    [{ role: "user", content: "改一下" }]
  );
  const toolMsg = calls[1].messages.find((m) => m.role === "tool");
  return String(toolMsg?.content ?? "");
}

beforeEach(() => {
  calls.length = 0;
});

describe("play_check 这个工具", () => {
  it("模型点名要它，工具清单里就得有", async () => {
    await runCheck(async () => "随便什么报告");
    const names = (calls[0].tools ?? []).map((t) => t.function.name);
    expect(names).toContain("play_check");
  });

  it("体检报告要原样送到模型面前", async () => {
    const report = "开局走通 4 步；导航 11 项里「总览」点了没反应。";
    expect(await runCheck(async () => report)).toBe(report);
  });

  it("没人替它跑的时候，返回的话不许像「通过」", async () => {
    // 这是最要紧的一条：平台今天已经在「把没测到说成没问题」上栽过四次
    const nobody =
      "这一轮没人替你跑体检（作者的工作台没开着，实测脚本也没在跑），等了 90 秒没等到。\n" +
      "**这不等于体检通过**——它只是没跑成。";
    const got = await runCheck(async () => nobody);
    expect(got).toContain("不等于体检通过");
    expect(got).not.toMatch(/^通过|试玩通过/);
  });

  it("快速模式的作品说清楚用不上，而不是装作跑过了", async () => {
    const got = await runCheck(undefined);
    expect(got).toContain("快速模式");
    expect(got).not.toContain("通过");
  });
});

describe("体检挂号簿（存储层）", () => {
  const newStore = (): InstanceType<typeof SqliteGameStore> =>
    new SqliteGameStore(path.join(mkdtempSync(path.join(tmpdir(), "wgp-pc-")), "test.db"));

  const report = {
    at: new Date().toISOString(),
    bootText: 100,
    steps: [],
    walked: 0,
    arrived: false,
    stuck: null,
    nav: [],
    notes: [],
    ms: 1000,
  };

  it("挂号、查号、销号", () => {
    const store = newStore();
    expect(store.playCheckWantedAt("g1")).toBeNull();
    store.playCheckWant("g1");
    expect(store.playCheckWantedAt("g1")).not.toBeNull();
    store.playCheckClearWant("g1");
    expect(store.playCheckWantedAt("g1")).toBeNull();
  });

  it("报告一到就自动销号——不然 AI 下一轮又等一次已经跑过的体检", () => {
    const store = newStore();
    store.playCheckWant("g1");
    store.playCheckSet("g1", report);
    expect(store.playCheckWantedAt("g1")).toBeNull();
    expect(store.playCheckGet("g1")?.bootText).toBe(100);
  });

  it("挂号是按作品分开的，别的作品不受影响", () => {
    const store = newStore();
    store.playCheckWant("g1");
    expect(store.playCheckWantedAt("g2")).toBeNull();
  });
});

describe("守则里得写清什么时候用它", () => {
  it("自由模式的守则要求写完文件就跑一次", async () => {
    const { buildSystemPrompt } = await import("@/lib/ai/prompt");
    const code = buildSystemPrompt(CONFIG as never, "code");
    expect(code).toContain("play_check");
    expect(code).toContain("别写完就交差等下一轮");
  });
});
