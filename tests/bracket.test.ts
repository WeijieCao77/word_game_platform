import { describe, it, expect } from "vitest";
import { validateGameConfig } from "@/lib/schema";
import { initState, endTurn } from "@/lib/engine";

// 淘汰赛对阵表：联赛只解决「谁排第几」，解决不了「谁淘汰了谁」。
// 一切赛事题材最紧张的部分恰恰在淘汰赛——VAL MANAGER 有胜者组/败者组，
// 我们此前连单败都做不出来。

const teams = [
  { name: "我队", strength: 80 },
  { name: "甲", strength: 78 },
  { name: "乙", strength: 76 },
  { name: "丙", strength: 74 },
];

const cfg = {
  schemaVersion: 1 as const,
  meta: { title: "季后赛" },
  driver: {
    kind: "sim" as const,
    time: { turnLabel: "周", cycleLabel: "赛季", turnsPerCycle: 3, maxCycles: 1 },
    actionPoints: 1,
  },
  vars: [
    { id: "战力", name: "战力", initial: 85, min: 0, max: 200 },
    { id: "冠军数", name: "冠军数", initial: 0, min: 0, max: 9 },
    { id: "走到第几轮", name: "走到第几轮", initial: 0, min: 0, max: 9 },
  ],
  leagues: [
    { id: "联赛", name: "常规赛", playerTeam: "我队", settlement: "周赛", teams },
  ],
  settlements: [
    {
      id: "周赛",
      name: "常规赛",
      condition: "turn <= 2",
      data: [{ 名称: "甲", 强度: 78 }, { 名称: "乙", 强度: 76 }],
      compute: [{ id: "净胜", expr: "战力 - row.强度" }],
      outcomes: [
        { id: "胜", condition: "净胜 > 0", effects: [], leagueResult: "win" as const, text: "赢了 {row.名称}。" },
        { id: "负", condition: "1", effects: [], leagueResult: "loss" as const, text: "输给了 {row.名称}。" },
      ],
    },
  ],
  brackets: [
    {
      id: "季后赛",
      name: "季后赛",
      league: "联赛",
      size: 4,
      condition: "turn == 3",
      compute: [{ id: "净胜", expr: "战力 - row.强度 + randint(-5, 5)" }],
      outcomes: [
        {
          id: "晋级",
          condition: "净胜 > 0",
          effects: [{ ref: "走到第几轮", op: "set" as const, value: "round" }],
          leagueResult: "win" as const,
          text: "第 {round} 轮：击败 {row.名称}。",
        },
        { id: "出局", condition: "1", effects: [], leagueResult: "loss" as const, text: "第 {round} 轮：不敌 {row.名称}。" },
      ],
      championEffects: [{ ref: "冠军数", op: "add" as const, value: "1" }],
      championText: "举起了奖杯。",
      eliminatedText: "季后赛第 {round} 轮止步。",
    },
  ],
  cards: [{ id: "日常", weight: 1, text: "训练。" }],
  endings: [{ id: "完", title: "完", kind: "neutral" as const, condition: "冠军数 >= 1" }],
};

describe("淘汰赛对阵表", () => {
  it("配置能过校验", () => {
    const r = validateGameConfig(cfg);
    expect(r.issues.filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`)).toEqual([]);
  });

  it("常规赛打完后开打，四强两轮决出冠军", () => {
    const config = validateGameConfig(cfg).config!;
    let s = initState(config, 11);
    for (let i = 0; i < 3 && !s.ended; i++) {
      if (s.pendingCard) break;
      s = endTurn(config, s);
    }
    const b = s.brackets?.季后赛;
    expect(b).toBeDefined();
    expect(b!.rounds).toHaveLength(2); // 4 强 → 半决赛 + 决赛
    expect(b!.rounds[0].pairs).toHaveLength(2);
    expect(b!.rounds[1].pairs).toHaveLength(1);
    expect(["我队", "甲", "乙", "丙"]).toContain(b!.champion);
  });

  it("战力压倒性时能夺冠，冠军效果与文案都生效", () => {
    const strong = { ...cfg, vars: cfg.vars.map((v) => (v.id === "战力" ? { ...v, initial: 200 } : v)) };
    const config = validateGameConfig(strong).config!;
    let s = initState(config, 5);
    for (let i = 0; i < 3 && !s.ended; i++) {
      if (s.pendingCard) break;
      s = endTurn(config, s);
    }
    expect(s.brackets!.季后赛.champion).toBe("我队");
    expect(s.log.some((e) => e.text?.includes("举起了奖杯"))).toBe(true);
  });

  it("战力极低时第一轮就出局，会写清楚止步第几轮", () => {
    const weak = { ...cfg, vars: cfg.vars.map((v) => (v.id === "战力" ? { ...v, initial: 1 } : v)) };
    const config = validateGameConfig(weak).config!;
    let s = initState(config, 6);
    for (let i = 0; i < 3 && !s.ended; i++) {
      if (s.pendingCard) break;
      s = endTurn(config, s);
    }
    expect(s.brackets!.季后赛.champion).not.toBe("我队");
    expect(s.log.some((e) => e.text?.includes("止步"))).toBe(true);
  });

  it("参赛队数不是 2 的幂 → 校验报错", () => {
    const bad = { ...cfg, brackets: [{ ...cfg.brackets[0], size: 3 }] };
    const errs = validateGameConfig(bad).issues.filter((i) => i.severity === "error");
    expect(errs.some((e) => e.message.includes("2 的幂"))).toBe(true);
  });

  it("没有任何分支标 win → 校验报错（玩家永远赢不了一轮）", () => {
    const bad = {
      ...cfg,
      brackets: [{ ...cfg.brackets[0], outcomes: [{ id: "总是输", condition: "1", effects: [], text: "输。" }] }],
    };
    const errs = validateGameConfig(bad).issues.filter((i) => i.severity === "error");
    expect(errs.some((e) => e.message.includes("永远赢不了"))).toBe(true);
  });

  it("联赛队数撑不起对阵表规模 → 校验报错", () => {
    const bad = { ...cfg, brackets: [{ ...cfg.brackets[0], size: 8 }] };
    const errs = validateGameConfig(bad).issues.filter((i) => i.severity === "error");
    expect(errs.some((e) => e.message.includes("撑不起"))).toBe(true);
  });
});
