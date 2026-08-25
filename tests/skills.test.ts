import { describe, it, expect } from "vitest";
import { SKILL_PACKS, SYSTEM_PROMPT, buildSystemPrompt, pickSkills } from "@/lib/ai/prompt";
import { GameConfig } from "@/lib/schema";

// 技能包：守则原本是一整块 17k 字，每轮请求都要重发——做恋爱游戏的人也要吃下
// 经营数值那一大段，既烧 token 也稀释注意力。拆成「常驻核心 + 按需技能包」。

const base = {
  schemaVersion: 1,
  meta: { title: "t" },
  driver: { kind: "story", startCard: "a" },
  vars: [],
  cards: [{ id: "a", text: "……" }],
  endings: [],
} as unknown as GameConfig;

const sim = {
  ...base,
  meta: { title: "t", genre: "电竞经营" },
  driver: { kind: "sim", time: { turnLabel: "周", cycleLabel: "赛季", turnsPerCycle: 5, maxCycles: 2 } },
} as unknown as GameConfig;

describe("技能包按需加载", () => {
  it("刚起步的叙事作品拿到的提示明显短于全量", () => {
    const short = buildSystemPrompt(base);
    expect(short.length).toBeLessThan(SYSTEM_PROMPT.length * 0.75);
  });

  it("sim 作品会自动拿到经营模块，叙事作品不会", () => {
    expect(pickSkills(sim)).toContain("经营模块");
    expect(pickSkills(base)).not.toContain("经营模块");
  });

  it("作品已经用了的模块必发——不然 AI 看不懂自己写过的东西", () => {
    const withRel = { ...base, relations: [{ id: "r", name: "r", entityType: "x" }] } as unknown as GameConfig;
    expect(pickSkills(withRel)).toContain("关系网");
  });

  it("没发的包会在索引里露名字，并告诉 AI 用 read_skill 取", () => {
    const p = buildSystemPrompt(base);
    const missing = Object.keys(SKILL_PACKS).filter((k) => !pickSkills(base).includes(k));
    expect(missing.length).toBeGreaterThan(0);
    expect(p).toContain("read_skill");
    for (const k of missing) expect(p).toContain(k);
  });

  it("常驻核心里必须有身份铁律、四阶段流程与表达式语法", () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain("你只做一件事");
    expect(p).toContain("四阶段创作流程");
    expect(p).toContain("表达式语言");
  });

  it("全量提示仍然包含每一个包（测试与调试用）", () => {
    for (const pack of Object.values(SKILL_PACKS)) {
      expect(SYSTEM_PROMPT).toContain(pack.body.slice(0, 40));
    }
  });
});
