import { describe, it, expect } from "vitest";
import { validateGameConfig } from "@/lib/schema";

// 承诺体检：开场白里写了的玩法，游戏里得真有。
// 这两条规则的由来：一款 AI 生成的《荒诞宗门江湖》在简介里写「可以分配天赋点」，
// 玩家点进去发现根本没有加点环节。

const base = {
  schemaVersion: 1 as const,
  driver: { kind: "story" as const, startCard: "开局" },
  vars: [
    { id: "天赋点", name: "天赋点", initial: 8, visible: false },
    { id: "灵根", name: "灵根", initial: 1 },
    { id: "悟性", name: "悟性", initial: 1 },
  ],
  endings: [{ id: "完", title: "完", kind: "neutral" as const, condition: "灵根 >= 2" }],
};

const plainCard = { id: "开局", text: "你睁开眼。", choices: [{ id: "走", label: "往前走", effects: [{ ref: "灵根", op: "add" as const, value: "1" }] }] };

/** 官方示例《修仙人生重开》那种写法：几个 +1 选项各扣 1 点，goto 回自己 */
const allocCard = {
  id: "开局",
  text: "剩余天赋 {天赋点} 点。",
  choices: [
    { id: "加灵根", label: "灵根 +1", condition: "天赋点 >= 1", effects: [{ ref: "灵根", op: "add" as const, value: "1" }, { ref: "天赋点", op: "add" as const, value: "-1" }], goto: "开局" },
    { id: "加悟性", label: "悟性 +1", condition: "天赋点 >= 1", effects: [{ ref: "悟性", op: "add" as const, value: "1" }, { ref: "天赋点", op: "add" as const, value: "-1" }], goto: "开局" },
    { id: "够了", label: "就这样开始", effects: [{ ref: "灵根", op: "add" as const, value: "1" }] },
  ],
};

const hasAllocWarning = (cfg: unknown): boolean =>
  validateGameConfig(cfg).issues.some((i) => i.message.includes("没有任何一处让玩家花掉这些点"));

describe("承诺体检：说了能加点，就得真有地方花", () => {
  it("简介写「可以分配天赋点」但没有加点环节 → 报警", () => {
    expect(hasAllocWarning({ ...base, meta: { title: "宗门", description: "开局可以分配 8 点天赋。" }, cards: [plainCard] })).toBe(true);
  });

  it("开场白写「自由分配」也算承诺", () => {
    expect(hasAllocWarning({ ...base, meta: { title: "宗门", intro: "还有八点天赋由你自由分配。" }, cards: [plainCard] })).toBe(true);
  });

  it("真有加点环节 → 不报警", () => {
    expect(hasAllocWarning({ ...base, meta: { title: "宗门", intro: "还有 8 点天赋可以亲手分配。" }, cards: [allocCard] })).toBe(false);
  });

  it("压根没提加点 → 不报警", () => {
    expect(hasAllocWarning({ ...base, meta: { title: "宗门", intro: "你睁开眼，山门在雾里。" }, cards: [plainCard] })).toBe(false);
  });
});

describe("承诺体检：说了有几种结局，就得真有那么多", () => {
  const endingWarning = (cfg: unknown): boolean =>
    validateGameConfig(cfg).issues.some((i) => i.message.includes("种结局，实际只写了"));

  it("吹 12 种结局只写了 1 个 → 报警", () => {
    expect(endingWarning({ ...base, meta: { title: "宗门", description: "12 种结局等你解锁。" }, cards: [plainCard] })).toBe(true);
  });

  it("说 2 种、实际 1 个 → 不打扰（宣传口径的正常出入）", () => {
    expect(endingWarning({ ...base, meta: { title: "宗门", description: "2 种结局。" }, cards: [plainCard] })).toBe(false);
  });
});
