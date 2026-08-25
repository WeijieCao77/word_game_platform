import { describe, expect, it } from "vitest";
import { GameConfig } from "@/lib/schema";
import { simulate, summarizeReport } from "@/lib/simulate";

// 开局即死检测：负面结局第一回合就能触发的配置，模拟报告必须醒目告警。

const baseLife = (endingCondition: string): GameConfig => ({
  schemaVersion: 1,
  meta: { title: "早死检测" },
  driver: { kind: "life", time: { label: "年", start: 0, step: 1, max: 30 } },
  vars: [{ id: "声望", name: "声望", initial: 10 }],
  cards: [
    { id: "日常", weight: 1, text: "平平无奇的一年。", effects: [{ ref: "声望", op: "add", value: "-6" }] },
  ],
  endings: [{ id: "崩盘", title: "崩盘", kind: "defeat", condition: endingCondition }],
  text: { timeoutEnding: { title: "寿终正寝" } },
});

describe("simulate 早终局检测", () => {
  it("第一回合就能触发的负面结局 → earlyEndRate 高并触发告警文案", () => {
    const report = simulate(baseLife("声望 < 10"), 100, 42);
    expect(report.earlyThreshold).toBeGreaterThanOrEqual(2);
    expect(report.earlyEndRate).toBeGreaterThan(0.5);
    expect(summarizeReport(report)).toContain("开局即死");
  });

  it("带回合门槛的同款结局 → 不再告警", () => {
    const report = simulate(baseLife("声望 < 10 && turn >= 10"), 100, 42);
    expect(report.earlyEndRate).toBe(0);
    expect(summarizeReport(report)).not.toContain("开局即死");
  });
});
