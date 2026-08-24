import { describe, expect, it } from "vitest";
import { evaluate, parseExpr, collectRefs, ExprError, Scope, Value, PURE_FUNCTIONS } from "@/lib/expr";
import { asNumber } from "@/lib/expr";

function scopeOf(vars: Record<string, Value>): Scope {
  return {
    get(path) {
      if (path.length !== 1) return undefined;
      return Object.prototype.hasOwnProperty.call(vars, path[0]) ? vars[path[0]] : undefined;
    },
    call(name, args) {
      const pure = PURE_FUNCTIONS[name];
      if (pure) return pure.fn(args.map((a) => asNumber(a)));
      if (name === "rand") return 0.5;
      throw new ExprError(`未知函数 "${name}"`);
    },
  };
}

describe("表达式语言", () => {
  const s = scopeOf({ money: 100, 灵力: 30, morale: 0.5 });

  it("四则与优先级", () => {
    expect(evaluate("1 + 2 * 3", s)).toBe(7);
    expect(evaluate("(1 + 2) * 3", s)).toBe(9);
    expect(evaluate("10 % 3", s)).toBe(1);
    expect(evaluate("-money / 4", s)).toBe(-25);
  });

  it("比较、逻辑与三元", () => {
    expect(evaluate("money >= 100 && 灵力 < 50", s)).toBe(true);
    expect(evaluate("money > 200 || 灵力 == 30", s)).toBe(true);
    expect(evaluate("!(money == 100)", s)).toBe(false);
    expect(evaluate("money > 50 ? 1 : 2", s)).toBe(1);
  });

  it("中文标识符与函数", () => {
    expect(evaluate("clamp(灵力 * 4, 0, 100)", s)).toBe(100);
    expect(evaluate("min(money, 42)", s)).toBe(42);
    expect(evaluate("floor(morale * 3)", s)).toBe(1);
  });

  it("字符串仅用于比较与函数参数", () => {
    expect(evaluate('"a" == "a"', s)).toBe(true);
    expect(() => evaluate('"a" + 1', s)).toThrow(ExprError);
  });

  it("除零与溢出被拒绝", () => {
    expect(() => evaluate("1 / 0", s)).toThrow(ExprError);
    expect(() => evaluate("1 % 0", s)).toThrow(ExprError);
  });

  it("未知变量与函数被拒绝", () => {
    expect(() => evaluate("nothing + 1", s)).toThrow(/未知变量/);
    expect(() => evaluate("hack()", s)).toThrow(/未知函数/);
  });

  it("恶意/越权输入被拒绝（不是 eval）", () => {
    expect(() => parseExpr("process.exit(1)")).toThrow(/函数名不能包含点号/);
    expect(() => parseExpr("a; b")).toThrow(ExprError);
    expect(() => parseExpr("() => 1")).toThrow(ExprError);
    expect(() => parseExpr("a['constructor']")).toThrow(ExprError);
    expect(() => parseExpr("`${x}`")).toThrow(ExprError);
    expect(() => evaluate("__proto__", s)).toThrow(/未知变量/);
  });

  it("长度/深度/复杂度上限", () => {
    expect(() => parseExpr("1+".repeat(600) + "1")).toThrow(ExprError);
    expect(() => parseExpr("(".repeat(40) + "1" + ")".repeat(40))).toThrow(/嵌套过深/);
  });

  it("collectRefs 收集引用", () => {
    const { idents, calls } = collectRefs(parseExpr("money > 10 && fired(\"x\") ? 灵力 : 0"));
    expect(idents.map((p) => p.join("."))).toEqual(["money", "灵力"]);
    expect(calls.map((c) => c.name)).toEqual(["fired"]);
  });
});
