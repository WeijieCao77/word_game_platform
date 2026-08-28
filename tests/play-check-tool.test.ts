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
const { playCheckHasIssue } = await import("@/lib/playcheck/types");
const { summarizePlayCheck, describePlayCheck } = await import("@/lib/playcheck/report");

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
    numbers: { nan: [], huge: [], noisy: [], earlyEnd: "" },
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

/**
 * 线上真事故：作者发一句话，工作台回一行
 * **`Cannot read properties of undefined (reading 'nan')`**。
 *
 * 根因是 `playCheckGet()` 写的是 `JSON.parse(row.report) as PlayCheckReport`——
 * 一个裸的类型断言。库里躺着的是**上一个版本存下的报告**，没有 numbers 那一段，
 * 于是 `r.numbers.nan` 当场炸，整轮对话断掉。
 *
 * 我本来写过一条「老报告没有 numbers 也不能炸」的测试，可它走的是
 * `parsePlayCheck`——**而从库里读根本不走那条路**。测错了路径，给了假的信心。
 * 所以这一组必须**把旧形状真的写进库里再读回来**。
 */
describe("库里躺着的旧报告", () => {
  const newStore = (): InstanceType<typeof SqliteGameStore> =>
    new SqliteGameStore(path.join(mkdtempSync(path.join(tmpdir(), "wgp-old-")), "test.db"));

  /** 昨天之前存下的形状：没有 numbers / walked / arrived */
  const OLD_SHAPE = {
    at: "2026-08-01T00:00:00.000Z",
    bootText: 800,
    steps: [{ label: "开始", dead: [], filled: [] }],
    stuck: null,
    nav: [{ label: "阵容", changed: true, already: false, textLen: 900, clickable: 12 }],
    notes: [],
    ms: 3000,
  };

  it("读回来不许炸，缺的字段要有默认值", () => {
    const store = newStore();
    store.playCheckSet("g1", OLD_SHAPE as never);
    const r = store.playCheckGet("g1")!;
    expect(r.numbers).toBeTruthy();
    expect(r.numbers.nan).toEqual([]);
    expect(r.walked).toBe(1); // 退回 steps 的条数
    expect(r.arrived).toBe(false); // 缺了就按「没走到」算，宁可误报
  });

  it("**拿它去判有没有问题也不许炸**——这一步就是线上炸的那一步", () => {
    const store = newStore();
    store.playCheckSet("g1", OLD_SHAPE as never);
    const r = store.playCheckGet("g1")!;
    expect(() => playCheckHasIssue(r)).not.toThrow();
    expect(() => summarizePlayCheck(r)).not.toThrow();
    expect(() => describePlayCheck(r)).not.toThrow();
  });

  it("**原来的时间戳要留住**——盖成当前时间，发布门槛的「体检比文件旧」就废了", () => {
    const store = newStore();
    store.playCheckSet("g1", OLD_SHAPE as never);
    expect(store.playCheckGet("g1")!.at).toBe("2026-08-01T00:00:00.000Z");
  });

  it("形状漂得再远也只当没体检过，不许把整轮打断", () => {
    // 写入那一侧要求有 at（NOT NULL），所以「完全没 at 的垃圾」进不了库；
    // 真实会发生的是**字段对不上**——比如某一版把 nav 存成了对象而不是数组。
    const store = newStore();
    store.playCheckSet("g1", { at: "2026-08-01T00:00:00.000Z", nav: { 不是: "数组" } } as never);
    const r = store.playCheckGet("g1")!;
    expect(() => playCheckHasIssue(r)).not.toThrow();
    expect(() => describePlayCheck(r)).not.toThrow();
    expect(r.bootText).toBe(0);
    expect(r.nav).toEqual([]);
  });
});
