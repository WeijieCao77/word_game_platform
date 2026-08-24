import { describe, expect, it } from "vitest";
import { GameConfig } from "@/lib/schema";
import { initState, step, choose, pendingChoices } from "@/lib/engine";
import { simulate } from "@/lib/simulate";

const lifeGame: GameConfig = {
  schemaVersion: 1,
  meta: { title: "小人生", intro: "你出生了。" },
  driver: { kind: "life", time: { label: "岁", start: 0, step: 1, max: 6 } },
  vars: [
    { id: "hp", name: "体力", initial: 5, min: 0, max: 10 },
    { id: "gold", name: "金币", initial: 0, min: 0 },
  ],
  cards: [
    { id: "拾金", weight: 2, text: "路边捡到金币。", effects: [{ ref: "gold", op: "add", value: "randint(1, 3)" }] },
    { id: "生病", weight: 1, text: "生了一场病。", effects: [{ ref: "hp", op: "add", value: "-2" }] },
    {
      id: "岔路",
      priority: 10,
      once: true,
      condition: "time == 3",
      text: "三岁那年，你走到一处岔路。",
      choices: [
        { id: "左", label: "向左（体力+2）", effects: [{ ref: "hp", op: "add", value: "2" }], text: "你选择了左边。" },
        { id: "右", label: "向右（金币+5）", effects: [{ ref: "gold", op: "add", value: "5" }], text: "你选择了右边。" },
      ],
    },
  ],
  endings: [
    { id: "夭折", title: "夭折", kind: "defeat", condition: "hp <= 0", priority: 10 },
    { id: "小富", title: "小富即安", kind: "victory", condition: "gold >= 8" },
  ],
  text: { timeoutEnding: { title: "平凡一生", text: "岁月静好。" } },
};

const storyGame: GameConfig = {
  schemaVersion: 1,
  meta: { title: "小故事" },
  driver: { kind: "story", startCard: "开场" },
  vars: [{ id: "勇气", name: "勇气", initial: 0 }],
  cards: [
    {
      id: "开场",
      text: "门前有一条狗。",
      choices: [
        { id: "冲", label: "冲过去", effects: [{ ref: "勇气", op: "add", value: "1" }], goto: "过关" },
        { id: "逃", label: "绕路走", goto: "绕路" },
      ],
    },
    { id: "过关", text: "狗被你吓跑了。勇气 {勇气}。", ending: "勇者" },
    { id: "绕路", text: "你安全绕开，但心里有点遗憾。", goto: "结尾" },
    { id: "结尾", text: "故事结束。", ending: "平淡" },
  ],
  endings: [
    { id: "勇者", title: "勇者", kind: "victory" },
    { id: "平淡", title: "平淡", kind: "neutral" },
  ],
};

describe("life 调度器", () => {
  it("同种子同操作 => 完全相同的过程（可复现）", () => {
    const runOnce = (): string => {
      let s = initState(lifeGame, 42);
      while (!s.ended) {
        if (s.pendingCard) {
          s = choose(lifeGame, s, pendingChoices(lifeGame, s)[0].id);
        } else {
          s = step(lifeGame, s);
        }
      }
      return JSON.stringify([s.log, s.vars, s.ended]);
    };
    expect(runOnce()).toBe(runOnce());
  });

  it("不同种子给出不同过程", () => {
    const trace = (seed: number): string => {
      let s = initState(lifeGame, seed);
      while (!s.ended) {
        s = s.pendingCard ? choose(lifeGame, s, pendingChoices(lifeGame, s)[0].id) : step(lifeGame, s);
      }
      return JSON.stringify(s.log);
    };
    const all = new Set([trace(1), trace(2), trace(3), trace(4)]);
    expect(all.size).toBeGreaterThan(1);
  });

  it("priority 主线卡在条件满足的回合强制触发", () => {
    let s = initState(lifeGame, 7);
    s = step(lifeGame, s); // 1 岁
    s = step(lifeGame, s); // 2 岁
    expect(s.pendingCard).toBeUndefined();
    s = step(lifeGame, s); // 3 岁 → 岔路
    expect(s.pendingCard).toBe("岔路");
    const opts = pendingChoices(lifeGame, s);
    expect(opts.map((o) => o.id)).toEqual(["左", "右"]);
    s = choose(lifeGame, s, "右");
    expect(s.vars.gold).toBeGreaterThanOrEqual(5);
  });

  it("待选择时不能推进时间", () => {
    let s = initState(lifeGame, 7);
    s = step(lifeGame, s);
    s = step(lifeGame, s);
    s = step(lifeGame, s);
    expect(() => step(lifeGame, s)).toThrow(/待选择/);
  });

  it("时间走完触发 timeout 兜底结局", () => {
    // 种子选择一条不夭折不发财的路线可能性存在；用模拟保证覆盖
    const report = simulate(lifeGame, 300, 99);
    expect(report.endings["__implicit__"]?.count ?? 0).toBeGreaterThan(0);
    expect(report.errors).toEqual([]);
  });
});

describe("story 调度器", () => {
  it("开局即触发起始卡并等待选择", () => {
    const s = initState(storyGame, 1);
    expect(s.pendingCard).toBe("开场");
    expect(s.log.some((l) => l.text.includes("门前有一条狗"))).toBe(true);
  });

  it("选项 goto 链与 ending", () => {
    let s = initState(storyGame, 1);
    s = choose(storyGame, s, "冲");
    expect(s.ended?.endingId).toBe("勇者");
    expect(s.log.some((l) => l.text.includes("勇气 1"))).toBe(true);
  });

  it("goto 链自动推进到结局", () => {
    let s = initState(storyGame, 1);
    s = choose(storyGame, s, "逃");
    expect(s.ended?.endingId).toBe("平淡");
  });

  it("goto 循环被链长限制拦截", () => {
    const loop: GameConfig = {
      ...storyGame,
      driver: { kind: "story", startCard: "a" },
      cards: [
        { id: "a", text: "甲", goto: "b" },
        { id: "b", text: "乙", goto: "a" },
      ],
    };
    expect(() => initState(loop, 1)).toThrow(/链过长/);
  });
});

describe("模拟器", () => {
  it("统计结局覆盖率并发现从未触发的内容", () => {
    const r = simulate(lifeGame, 400, 7);
    expect(r.runs).toBe(400);
    const total = Object.values(r.endings).reduce((s, e) => s + e.count, 0);
    expect(total).toBe(400);
    expect(r.errors).toEqual([]);
    // 三个结局（夭折/小富/兜底）在 400 局里都应出现
    expect(r.endings["夭折"]?.count ?? 0).toBeGreaterThan(0);
    expect(r.endings["小富"]?.count ?? 0).toBeGreaterThan(0);
  });
});
