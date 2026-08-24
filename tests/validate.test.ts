import { describe, expect, it } from "vitest";
import { validateGameConfig } from "@/lib/schema";

const base = {
  schemaVersion: 1,
  meta: { title: "测试" },
  driver: { kind: "life", time: { label: "岁", start: 0, step: 1, max: 10 } },
  vars: [{ id: "hp", name: "体力", initial: 10, min: 0, max: 100 }],
  cards: [{ id: "c1", weight: 1, text: "平安一年。" }],
  endings: [{ id: "e1", title: "终", kind: "neutral", condition: "hp <= 0" }],
};

function clone(): any {
  return structuredClone(base);
}

describe("结构 + 语义校验", () => {
  it("合法配置通过", () => {
    const r = validateGameConfig(clone());
    expect(r.ok).toBe(true);
  });

  it("结构错误：缺字段", () => {
    const c = clone();
    delete c.meta;
    const r = validateGameConfig(c);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.startsWith("meta"))).toBe(true);
  });

  it("悬空 goto", () => {
    const c = clone();
    c.cards[0].goto = "不存在";
    const r = validateGameConfig(c);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("不存在的卡"))).toBe(true);
  });

  it("未知变量与未知函数", () => {
    const c = clone();
    c.cards[0].effects = [{ ref: "mp", op: "add", value: "1" }];
    c.cards[0].condition = "hack(1)";
    const r = validateGameConfig(c);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('不存在的变量 "mp"'))).toBe(true);
    expect(r.issues.some((i) => i.message.includes("未知函数"))).toBe(true);
  });

  it("fired 引用不存在的卡", () => {
    const c = clone();
    c.cards[0].condition = 'fired("ghost")';
    const r = validateGameConfig(c);
    expect(r.ok).toBe(false);
  });

  it("story 起始卡必须存在，孤儿卡报警告", () => {
    const c = clone();
    c.driver = { kind: "story", startCard: "c1" };
    c.cards = [
      { id: "c1", text: "开始", choices: [{ id: "a", label: "走", goto: "c2" }] },
      { id: "c2", text: "结束", ending: "e2" },
      { id: "orphan", text: "孤儿" },
    ];
    c.endings = [{ id: "e2", title: "完", kind: "neutral" }];
    const r = validateGameConfig(c);
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.severity === "warning" && i.message.includes("孤儿卡"))).toBe(true);
  });

  it("story 起始卡不存在是错误", () => {
    const c = clone();
    c.driver = { kind: "story", startCard: "ghost" };
    const r = validateGameConfig(c);
    expect(r.ok).toBe(false);
  });

  it("模板插值中的表达式也被校验", () => {
    const c = clone();
    c.cards[0].text = "你有 {gold} 枚金币";
    const r = validateGameConfig(c);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('未知变量 "gold"'))).toBe(true);
  });

  it("不可达结局启发式：变量从未被修改", () => {
    const c = clone();
    c.vars.push({ id: "fame", name: "名声", initial: 0 });
    c.endings.push({ id: "e2", title: "成名", kind: "victory", condition: "fame >= 100" });
    const r = validateGameConfig(c);
    expect(r.issues.some((i) => i.severity === "warning" && i.message.includes("可能永远不会触发"))).toBe(true);
  });

  it("无条件且无引用的结局报警告", () => {
    const c = clone();
    c.endings.push({ id: "e3", title: "隐藏", kind: "victory" });
    const r = validateGameConfig(c);
    expect(r.issues.some((i) => i.message.includes("永远不会出现"))).toBe(true);
  });

  it("保留字不能作变量 id", () => {
    const c = clone();
    c.vars.push({ id: "time", name: "时间", initial: 0 });
    const r = validateGameConfig(c);
    expect(r.ok).toBe(false);
  });
});
