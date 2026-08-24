import { describe, expect, it } from "vitest";
import { GameConfig } from "@/lib/schema";
import {
  initState,
  step,
  choose,
  pendingChoices,
  performAction,
  endTurn,
  availableActions,
  eligibleTargets,
} from "@/lib/engine";
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

describe("life 冷却防重复", () => {
  const repeatGame: GameConfig = {
    schemaVersion: 1,
    meta: { title: "重复测试" },
    driver: { kind: "life", time: { label: "年", start: 0, step: 1, max: 12 } },
    vars: [],
    cards: [
      { id: "甲", weight: 1, text: "甲事件" },
      { id: "乙", weight: 1, text: "乙事件" },
      { id: "丙", weight: 1, text: "丙事件" },
    ],
    endings: [{ id: "e", title: "完", kind: "neutral", condition: "turn >= 999" }],
    text: { timeoutEnding: { title: "完" } },
  };

  it("默认冷却下同一张卡不会连续两回合出现", () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = initState(repeatGame, seed);
      while (!s.ended) s = step(repeatGame, s);
      const cards = s.log.filter((l) => l.kind === "card").map((l) => l.text);
      for (let i = 1; i < cards.length; i++) {
        expect(cards[i]).not.toBe(cards[i - 1]);
      }
    }
  });

  it("cooldown: 0 允许连续出现（小卡池不停摆）", () => {
    const single: GameConfig = {
      ...repeatGame,
      cards: [{ id: "唯一", weight: 1, cooldown: 0, text: "唯一事件" }],
    };
    let s = initState(single, 3);
    while (!s.ended) s = step(single, s);
    expect(s.log.filter((l) => l.kind === "card").length).toBe(12);
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

describe("sim 调度器", () => {
  const simGame: GameConfig = {
    schemaVersion: 1,
    meta: { title: "小队经营" },
    driver: {
      kind: "sim",
      time: { turnLabel: "周", cycleLabel: "季", turnsPerCycle: 3, maxCycles: 2 },
      drawsPerTurn: 0,
    },
    vars: [
      { id: "钱", name: "钱", initial: 10, min: 0 },
      { id: "分", name: "分", initial: 0, min: 0, resetEachCycle: true },
    ],
    entityTypes: [
      { id: "队员", name: "队员", attributes: [{ id: "力量", name: "力量", min: 1, max: 99 }] },
    ],
    entities: [
      { id: "甲", type: "队员", name: "小甲", attrs: { 力量: 50 }, tags: ["主力"] },
      { id: "乙", type: "队员", name: "小乙", attrs: { 力量: 40 }, tags: ["候补"] },
    ],
    derived: [{ id: "实力", name: "实力", expr: 'avg("队员", "力量", "主力")' }],
    actions: [
      {
        id: "训练",
        name: "训练",
        target: { entityType: "队员", condition: 'tag("主力")' },
        condition: "钱 >= 2",
        effects: [
          { ref: "钱", op: "add", value: "-2" },
          { ref: "target.力量", op: "add", value: "5" },
        ],
        text: "训练了 {target.name}",
      },
      {
        id: "提拔",
        name: "提拔",
        target: { entityType: "队员", condition: 'tag("候补")' },
        effects: [
          { ref: "target", op: "remove_tag", tag: "候补" },
          { ref: "target", op: "add_tag", tag: "主力" },
        ],
      },
    ],
    settlements: [
      {
        id: "比赛",
        name: "比赛",
        data: [{ 对手: 45 }, { 对手: 55 }],
        compute: [{ id: "差", expr: "实力 - row.对手" }],
        outcomes: [
          { id: "胜", condition: "差 >= 0", effects: [{ ref: "分", op: "add", value: "3" }], text: "胜（差 {差}）" },
          { id: "负", condition: "1", effects: [], text: "负" },
        ],
      },
    ],
    curves: [
      {
        id: "消耗",
        name: "消耗",
        entityType: "队员",
        phase: "turn",
        condition: 'tag("主力")',
        effects: [{ ref: "self.力量", op: "add", value: "-1" }],
      },
    ],
    cards: [],
    endings: [{ id: "满分", title: "满分", kind: "victory", condition: "分 >= 999" }],
    text: { timeoutEnding: { title: "收摊" } },
  };

  it("决策：条件/次数/目标过滤生效，效果落到实体", () => {
    let s = initState(simGame, 5);
    expect(s.turn).toBe(1);
    expect(s.cycle).toBe(1);
    const acts = availableActions(simGame, s);
    expect(acts.find((a) => a.id === "训练")?.available).toBe(true);
    expect(eligibleTargets(simGame, s, "训练").map((t) => t.id)).toEqual(["甲"]);
    s = performAction(simGame, s, "训练", "甲");
    expect(s.entities!["甲"].attrs.力量).toBe(55);
    expect(s.vars.钱).toBe(8);
    expect(() => performAction(simGame, s, "训练", "甲")).toThrow(/次数已用完/);
  });

  it("标签操作改变目标池与聚合", () => {
    let s = initState(simGame, 5);
    s = performAction(simGame, s, "提拔", "乙");
    expect(s.entities!["乙"].tags).toContain("主力");
    expect(eligibleTargets(simGame, s, "训练").map((t) => t.id)).toEqual(["甲", "乙"]);
  });

  it("endTurn：结算按 data 行推进，曲线消耗，回合与周期滚动，resetEachCycle 生效", () => {
    let s = initState(simGame, 5);
    s = endTurn(simGame, s); // 第1周：实力50 vs 45 → 胜
    expect(s.vars.分).toBe(3);
    expect(s.turn).toBe(2);
    expect(s.entities!["甲"].attrs.力量).toBe(49); // 曲线 -1
    expect(s.log.some((l) => l.kind === "settlement" && l.text.includes("胜"))).toBe(true);
    s = endTurn(simGame, s); // 第2周：49 vs 55 → 负
    expect(s.vars.分).toBe(3);
    s = endTurn(simGame, s); // 第3周：季末滚动
    expect(s.cycle).toBe(2);
    expect(s.turn).toBe(1);
    expect(s.vars.分).toBe(0); // resetEachCycle
    s = endTurn(simGame, s);
    s = endTurn(simGame, s);
    s = endTurn(simGame, s); // 第2季末 → maxCycles 用尽
    expect(s.ended?.title).toBe("收摊");
  });

  it("同种子同操作可复现", () => {
    const run = (): string => {
      let s = initState(simGame, 42);
      s = performAction(simGame, s, "训练", "甲");
      while (!s.ended) s = endTurn(simGame, s);
      return JSON.stringify([s.log, s.vars, s.entities]);
    };
    expect(run()).toBe(run());
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
