import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GameConfig, CardDef } from "@/lib/schema";
import { extractRequiredVars, insertLibraryCard, shareBlockReason, LibraryEntry } from "@/lib/library";

const sourceGame: GameConfig = {
  schemaVersion: 1,
  meta: { title: "来源游戏" },
  driver: { kind: "life", time: { label: "年", start: 0, step: 1, max: 10 } },
  vars: [
    { id: "金币", name: "金币", initial: 10, min: 0 },
    { id: "运势", name: "运势", initial: 0, min: 0, max: 1, visible: false },
    { id: "无关", name: "无关", initial: 0 },
  ],
  cards: [
    {
      id: "奇遇",
      weight: 1,
      condition: "金币 >= 5",
      text: "你{运势 == 1 ? \"走运\" : \"倒霉\"}了。",
      effects: [
        { ref: "运势", op: "set", value: "chance(0.5) ? 1 : 0" },
        { ref: "金币", op: "add", value: "运势 == 1 ? 5 : -2" },
      ],
    },
    { id: "带跳转", weight: 1, text: "a", goto: "奇遇" },
    { id: "带埋线", weight: 1, condition: 'fired("奇遇")', text: "b" },
  ],
  endings: [{ id: "e", title: "完", kind: "neutral", condition: "turn >= 999" }],
  text: { timeoutEnding: { title: "完" } },
};

describe("内容库", () => {
  it("独立卡可入库，goto/fired 依赖卡被拦截并给出原因", () => {
    expect(shareBlockReason(sourceGame.cards[0])).toBeNull();
    expect(shareBlockReason(sourceGame.cards[1])).toMatch(/goto/);
    expect(shareBlockReason(sourceGame.cards[2])).toMatch(/fired/);
  });

  it("依赖变量按实际引用提取（含隐藏变量，不带无关变量）", () => {
    const vars = extractRequiredVars(sourceGame.cards[0], sourceGame);
    expect(vars.map((v) => v.id).sort()).toEqual(["运势", "金币"]);
  });

  it("插入目标游戏：补缺失变量、id 冲突自动改名、默认给 weight", () => {
    const entry: LibraryEntry = {
      id: "official:x:奇遇",
      name: "奇遇",
      category: "机遇",
      tags: ["通用"],
      card: sourceGame.cards[0],
      requiredVars: extractRequiredVars(sourceGame.cards[0], sourceGame),
      source: "official",
      author: "官方",
      createdAt: "2026-01-01T00:00:00Z",
    };
    const target: GameConfig = {
      schemaVersion: 1,
      meta: { title: "目标游戏" },
      driver: { kind: "life", time: { label: "岁", start: 0, step: 1, max: 5 } },
      vars: [{ id: "金币", name: "银两", initial: 3, min: 0 }],
      cards: [{ id: "奇遇", weight: 1, text: "已有同名卡" }],
      endings: [{ id: "e", title: "完", kind: "neutral", condition: "turn >= 999" }],
      text: { timeoutEnding: { title: "完" } },
    };
    const { config: next, cardId } = insertLibraryCard(target, entry);
    expect(cardId).toBe("奇遇_2");
    expect(next.cards.map((c) => c.id)).toContain("奇遇_2");
    // 已存在的金币不覆盖（保留目标定义），缺失的运势补齐
    expect(next.vars.find((v) => v.id === "金币")?.name).toBe("银两");
    expect(next.vars.find((v) => v.id === "运势")).toBeTruthy();
    expect(next.cards.find((c) => c.id === "奇遇_2")?.weight).toBe(1);
  });

  it("官方 manifest 的每一条都能在模板里找到且可入库", () => {
    const dir = path.join(__dirname, "..", "templates");
    const manifest = JSON.parse(readFileSync(path.join(dir, "library-manifest.json"), "utf8")) as {
      template: string;
      cardId: string;
      category: string;
    }[];
    const configs = new Map<string, GameConfig>();
    for (const m of manifest) {
      if (!configs.has(m.template)) {
        configs.set(m.template, JSON.parse(readFileSync(path.join(dir, m.template), "utf8")));
      }
      const card = configs.get(m.template)!.cards.find((c: CardDef) => c.id === m.cardId);
      expect(card, `${m.template} 缺少卡片 ${m.cardId}`).toBeTruthy();
      expect(shareBlockReason(card!), `${m.cardId} 不可入库`).toBeNull();
      const vars = extractRequiredVars(card!, configs.get(m.template)!);
      expect(vars.length).toBeGreaterThan(0);
    }
  });
});
