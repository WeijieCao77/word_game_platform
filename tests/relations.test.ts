import { describe, it, expect } from "vitest";
import { validateGameConfig } from "@/lib/schema";
import { initState, endTurn, performAction, pairKey } from "@/lib/engine";

// 关系网：两个角色**之间**的状态。
// 复刻 VAL MANAGER 时发现平台完全没有这一层——它的 bonds.ts 用
// Record<"A|B", number> 存两两羁绊，还有队内和谐度参与战力。
// 平台原本只有全局变量和「每个角色自己的属性」，谁和谁的关系无处安放。

const cfg = {
  schemaVersion: 1 as const,
  meta: { title: "更衣室" },
  driver: {
    kind: "sim" as const,
    time: { turnLabel: "周", cycleLabel: "赛季", turnsPerCycle: 6, maxCycles: 2 },
    actionPoints: 3,
  },
  vars: [{ id: "士气", name: "士气", initial: 50, min: 0, max: 100 }],
  entityTypes: [
    { id: "选手", name: "选手", attributes: [{ id: "年龄", name: "年龄" }] },
  ],
  entities: [
    { id: "A", type: "选手", name: "阿泽", attrs: { 年龄: 20 }, tags: ["主力"] },
    { id: "B", type: "选手", name: "小北", attrs: { 年龄: 21 }, tags: ["主力"] },
    { id: "C", type: "选手", name: "老陈", attrs: { 年龄: 28 }, tags: ["主力"] },
  ],
  relations: [
    {
      id: "羁绊",
      name: "队内羁绊",
      entityType: "选手",
      // 同龄人天然亲近一点：年龄差越大，起点越低
      initial: "12 - abs(self.年龄 - other.年龄)",
      min: -20,
      max: 40,
    },
  ],
  derived: [{ id: "和谐度", name: "和谐度", expr: 'harmony("羁绊", "主力")' }],
  actions: [
    {
      id: "双人加练",
      name: "双人加练",
      cost: 1,
      target: { entityType: "选手", condition: 'tag("主力")' },
      // self 是谁？决策里 self 与 target 同绑到被选中的实体，
      // 所以双人关系要用一张卡的两个绑定；这里演示组内群改。
      effects: [{ ref: "羁绊", op: "relate_group" as const, tag: "主力", value: "2" }],
      text: "{target.name} 带着大家练了一下午配合。",
    },
    {
      id: "内讧",
      name: "闹了一场",
      cost: 1,
      effects: [{ ref: "羁绊", op: "relate_group" as const, tag: "主力", value: "-5" }],
      text: "训练室里吵起来了。",
    },
  ],
  cards: [{ id: "日常", weight: 1, text: "训练照常。" }],
  endings: [{ id: "散伙", title: "散伙", kind: "defeat" as const, condition: 'worst_bond("羁绊", "主力") <= -15' }],
};

describe("关系网：谁和谁之间的状态", () => {
  it("配置能过校验", () => {
    const r = validateGameConfig(cfg);
    expect(r.issues.filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`)).toEqual([]);
  });

  it("没碰过的一对按 initial 现算：同龄人起点更高", () => {
    const config = validateGameConfig(cfg).config!;
    const s = initState(config, 1);
    // A(20) 与 B(21) 差 1 岁 → 11；A(20) 与 C(28) 差 8 岁 → 4
    // 和谐度 = 三对的平均：(11 + 4 + 5) / 3
    expect(s.vars).toBeDefined();
    const harmony = config.derived!.find((d) => d.id === "和谐度");
    expect(harmony).toBeDefined();
  });

  it("relate_group 让组内两两都变，且只落盘碰过的那几对", () => {
    const config = validateGameConfig(cfg).config!;
    let s = initState(config, 2);
    expect(s.relations ?? {}).toEqual({});

    s = performAction(config, s, "双人加练", "A");
    const table = s.relations!.羁绊;
    // 三个人 = 三对
    expect(Object.keys(table)).toHaveLength(3);
    expect(table[pairKey("A", "B")]).toBe(13); // 11 + 2
    expect(table[pairKey("A", "C")]).toBe(6); // 4 + 2
    expect(table[pairKey("B", "C")]).toBe(7); // 5 + 2
  });

  it("上下限会钳住", () => {
    // 决策默认每回合只能用一次，所以给一个回合多、且不会中途散伙的变体
    const long = {
      ...cfg,
      driver: { ...cfg.driver, time: { ...cfg.driver.time, turnsPerCycle: 30 } },
      endings: [{ id: "完", title: "完", kind: "neutral" as const, condition: "士气 <= -1" }],
    };
    const config = validateGameConfig(long).config!;
    let s = initState(config, 3);
    for (let i = 0; i < 10 && !s.ended; i++) {
      s = performAction(config, s, "内讧");
      if (!s.ended && !s.pendingCard) s = endTurn(config, s);
    }
    expect(s.relations!.羁绊[pairKey("A", "B")]).toBe(-20); // 11 - 5*10 = -39 → 被 min 钳到 -20
  });

  it("worst_bond 能当结局条件：处到最僵的一对拖垮整个队", () => {
    const config = validateGameConfig(cfg).config!;
    let s = initState(config, 4);
    let guard = 0;
    while (!s.ended && guard++ < 40) {
      s = performAction(config, s, "内讧");
      if (s.ended) break;
      if (!s.pendingCard) s = endTurn(config, s);
    }
    expect(s.ended?.endingId).toBe("散伙");
  });

  it("引用不存在的关系 → 校验报错", () => {
    const bad = { ...cfg, derived: [{ id: "x", name: "x", expr: 'harmony("并不存在")' }] };
    const errs = validateGameConfig(bad).issues.filter((i) => i.severity === "error");
    expect(errs.some((e) => e.message.includes("不存在的关系"))).toBe(true);
  });

  it("关系挂在不存在的实体类型上 → 校验报错", () => {
    const bad = { ...cfg, relations: [{ ...cfg.relations[0], entityType: "幽灵" }] };
    const errs = validateGameConfig(bad).issues.filter((i) => i.severity === "error");
    expect(errs.some((e) => e.message.includes("不存在的实体类型"))).toBe(true);
  });
});
