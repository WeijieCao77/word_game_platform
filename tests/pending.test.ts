import { describe, it, expect } from "vitest";
import { validateGameConfig } from "@/lib/schema";
import { initState, endTurn, performAction } from "@/lib/engine";

// 待办箱：发出去要等回音的事。
// 这是复刻 VAL MANAGER 时发现平台缺的最大一块——它的转会报价、赞助洽谈、
// 招聘邀约、跳槽求职，本质都是「现在做个动作，过几回合才知道结果」。

const cfg = {
  schemaVersion: 1 as const,
  meta: { title: "报价" },
  driver: {
    kind: "sim" as const,
    time: { turnLabel: "周", cycleLabel: "赛季", turnsPerCycle: 10, maxCycles: 2 },
    actionPoints: 3,
  },
  vars: [
    { id: "资金", name: "资金", initial: 100, min: -50, max: 999 },
    { id: "报价中", name: "报价中", initial: 0, min: 0, max: 9, visible: false },
    { id: "签约数", name: "签约数", initial: 0, min: 0, max: 9 },
  ],
  entityTypes: [{ id: "选手", name: "选手", attributes: [{ id: "身价", name: "身价" }] }],
  entities: [
    { id: "A", type: "选手", name: "阿泽", attrs: { 身价: 30 }, tags: ["市场"] },
    { id: "B", type: "选手", name: "小北", attrs: { 身价: 20 }, tags: ["市场"] },
  ],
  pendings: [
    {
      id: "转会报价",
      name: "转会报价",
      waitTurns: "3",
      targetType: "选手",
      waitingText: "对方俱乐部还在考虑。",
      outcomes: [
        {
          id: "接受",
          condition: "资金 >= target.身价",
          effects: [
            { ref: "资金", op: "add" as const, value: "-target.身价" },
            { ref: "target", op: "remove_tag" as const, tag: "市场" },
            { ref: "target", op: "add_tag" as const, tag: "主力" },
            { ref: "签约数", op: "add" as const, value: "1" },
            { ref: "报价中", op: "add" as const, value: "-1" },
          ],
          text: "{target.name} 答应了。",
        },
        {
          id: "谈崩",
          condition: "1",
          effects: [{ ref: "报价中", op: "add" as const, value: "-1" }],
          text: "{target.name} 拒绝了：钱不够。",
        },
      ],
    },
  ],
  actions: [
    {
      id: "报价",
      name: "发出报价",
      cost: 1,
      target: { entityType: "选手", condition: 'tag("市场")' },
      effects: [
        { ref: "转会报价", op: "pend" as const },
        { ref: "报价中", op: "add" as const, value: "1" },
      ],
      text: "给 {target.name} 发了报价，等回音。",
    },
  ],
  cards: [{ id: "日常", weight: 1, text: "训练照常。" }],
  endings: [{ id: "收工", title: "收工", kind: "neutral" as const, condition: "签约数 >= 2" }],
};

describe("待办箱：发出去要等回音", () => {
  it("配置能过校验", () => {
    const r = validateGameConfig(cfg);
    expect(r.issues.filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`)).toEqual([]);
  });

  it("报价发出后挂起，三回合后才出结果", () => {
    const config = validateGameConfig(cfg).config!;
    let s = initState(config, 42);
    expect(s.pendings ?? []).toHaveLength(0);

    s = performAction(config, s, "报价", "A");
    expect(s.pendings).toHaveLength(1);
    expect(s.pendings![0].target).toBe("A");
    expect(s.vars.签约数).toBe(0); // 还没成交

    // 第 1 周发出、约定等 3 周 → 到期回合是第 4 周，在第 4 周的结算里出结果
    s = endTurn(config, s); // 走完第 1 周
    expect(s.pendings).toHaveLength(1);
    s = endTurn(config, s); // 走完第 2 周
    expect(s.pendings).toHaveLength(1);
    s = endTurn(config, s); // 走完第 3 周
    expect(s.pendings).toHaveLength(1);
    s = endTurn(config, s); // 走完第 4 周：到期
    expect(s.pendings).toHaveLength(0);
    expect(s.vars.签约数).toBe(1);
    expect(s.vars.资金).toBe(70);
    expect(s.entities!.A.tags).toContain("主力");
    expect(s.log.some((e) => e.text?.includes("阿泽 答应了"))).toBe(true);
  });

  it("钱不够就走兜底分支，玩家能看到「谈崩了」而不是石沉大海", () => {
    const poor = { ...cfg, vars: cfg.vars.map((v) => (v.id === "资金" ? { ...v, initial: 5 } : v)) };
    const config = validateGameConfig(poor).config!;
    let s = initState(config, 7);
    s = performAction(config, s, "报价", "A");
    for (let i = 0; i < 4; i++) s = endTurn(config, s);
    expect(s.pendings).toHaveLength(0);
    expect(s.vars.签约数).toBe(0);
    expect(s.log.some((e) => e.text?.includes("拒绝了"))).toBe(true);
  });

  it("可以同时押好几件事，各自按各自的到期回合出结果", () => {
    const config = validateGameConfig(cfg).config!;
    let s = initState(config, 9);
    s = performAction(config, s, "报价", "A");
    s = endTurn(config, s);
    s = performAction(config, s, "报价", "B"); // 晚一周发出
    expect(s.pendings).toHaveLength(2);
    expect(s.pendings![1].dueTurn).toBeGreaterThan(s.pendings![0].dueTurn);
  });

  it("pend 引用了不存在的待办 → 校验报错", () => {
    const bad = { ...cfg, actions: [{ ...cfg.actions[0], effects: [{ ref: "并不存在", op: "pend" as const }] }] };
    const errs = validateGameConfig(bad).issues.filter((i) => i.severity === "error");
    expect(errs.some((e) => e.message.includes("不存在的待办"))).toBe(true);
  });

  it("所有结果分支都可能不满足 → 警告（玩家等半天等到个寂寞）", () => {
    const bad = {
      ...cfg,
      pendings: [{ ...cfg.pendings[0], outcomes: [{ ...cfg.pendings[0].outcomes[0] }] }],
    };
    const warns = validateGameConfig(bad).issues.filter((i) => i.severity === "warning");
    expect(warns.some((w) => w.message.includes("悄无声息地消失"))).toBe(true);
  });
});
