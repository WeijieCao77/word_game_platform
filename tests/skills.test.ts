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

/**
 * 提示里那句「一轮对话有时间上限（默认 40 秒）」是个真 bug。
 * 异步化之后自由模式一轮有 12 分钟，可提示里还写着 40 秒——
 * 模型照着那句话把活切成一小口一小口，每轮只长一千来字符，
 * 一部一万三千行的作品永远搭不完。差距不在表达力，在这句假话。
 */
describe("一轮的预算要如实告诉模型", () => {
  const cfg = {
    schemaVersion: 1,
    meta: { title: "t" },
    driver: { kind: "story", startCard: "a" },
    vars: [],
    cards: [],
    endings: [],
  } as unknown as GameConfig;

  it("占位符一定被换掉——漏了就等于把 __ROUND_BUDGET__ 发给模型看", () => {
    expect(buildSystemPrompt(cfg, "code", 720_000)).not.toContain("__ROUND_BUDGET__");
    expect(buildSystemPrompt(cfg, "engine")).not.toContain("__ROUND_BUDGET__");
  });

  it("12 分钟就写「约 12 分钟」，不是「40 秒」", () => {
    const p = buildSystemPrompt(cfg, "code", 720_000);
    expect(p).toContain("约 12 分钟");
    expect(p).not.toContain("默认 40 秒");
  });

  it("短预算照实说成秒", () => {
    expect(buildSystemPrompt(cfg, "code", 40_000)).toContain("40 秒");
  });

  it("自由模式要带上「剩余清单」——没有它，AI 每轮只做想起来的那件事", () => {
    const p = buildSystemPrompt(cfg, "code", 720_000);
    expect(p).toContain("剩余清单");
    expect(p).toContain("清单没清空");
  });
});
