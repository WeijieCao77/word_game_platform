import { describe, expect, it } from "vitest";
import { GameConfig } from "@/lib/schema";
import { initState, step } from "@/lib/engine";

// 反重复文案变体：确定性轮转，同一张卡连续两次触发文案必不同，同种子完全可复现。

const config: GameConfig = {
  schemaVersion: 1,
  meta: { title: "变体测试" },
  driver: { kind: "life", time: { label: "年", start: 0, step: 1, max: 40 } },
  vars: [],
  cards: [
    {
      id: "日常",
      weight: 1,
      cooldown: 0,
      text: "文案甲",
      textVariants: ["文案乙", "文案丙"],
    },
  ],
  endings: [{ id: "e", title: "完", kind: "neutral", condition: "turn >= 999" }],
  text: { timeoutEnding: { title: "完" } },
};

describe("textVariants 反重复", () => {
  it("连续触发文案不重复，且全部来自变体池", () => {
    let state = initState(config, 42);
    for (let i = 0; i < 12; i++) state = step(config, state);
    const texts = state.log.filter((l) => l.kind === "card").map((l) => l.text);
    expect(texts.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < texts.length; i++) {
      expect(texts[i], `第 ${i} 次触发与上一次重复`).not.toBe(texts[i - 1]);
    }
    for (const t of texts) expect(["文案甲", "文案乙", "文案丙"]).toContain(t);
  });

  it("同种子可复现，不同种子起点可不同", () => {
    const run = (seed: number): string[] => {
      let s = initState(config, seed);
      for (let i = 0; i < 6; i++) s = step(config, s);
      return s.log.filter((l) => l.kind === "card").map((l) => l.text);
    };
    expect(run(7)).toEqual(run(7));
  });
});
