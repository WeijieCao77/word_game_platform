import { Expr, ExprError, Value } from "./ast";
import { parseExpr } from "./parser";

const MAX_STEPS = 5000;

/**
 * 求值作用域。标识符与函数都通过它解析——求值器本身不接触任何
 * JS 全局对象或原型链，天然免疫 XSS / 原型污染。
 */
export interface Scope {
  /** 解析点分路径，如 ["money"]、["target","attack"]。未知返回 undefined。 */
  get(path: string[]): Value | undefined;
  /** 调用白名单函数。未知函数应抛 ExprError。 */
  call(name: string, args: Value[]): Value;
}

function truthy(v: Value): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return v.length > 0;
}

export function asNumber(v: Value, context?: string): number {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new ExprError(`数值溢出或非法（${context ?? "计算结果"}）`);
    return v;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  throw new ExprError(`需要数字，得到字符串 "${v}"${context ? `（${context}）` : ""}`);
}

export function evalAst(ast: Expr, scope: Scope): Value {
  let steps = 0;
  const ev = (e: Expr): Value => {
    if (++steps > MAX_STEPS) throw new ExprError("表达式求值步数超限");
    switch (e.kind) {
      case "num":
        return e.value;
      case "str":
        return e.value;
      case "ident": {
        const v = scope.get(e.path);
        if (v === undefined) throw new ExprError(`未知变量 "${e.path.join(".")}"`);
        return v;
      }
      case "call":
        return scope.call(e.name, e.args.map(ev));
      case "unary": {
        const v = ev(e.operand);
        return e.op === "-" ? -asNumber(v) : !truthy(v);
      }
      case "ternary":
        return truthy(ev(e.cond)) ? ev(e.then) : ev(e.else);
      case "binary": {
        if (e.op === "&&") return truthy(ev(e.left)) ? truthy(ev(e.right)) : false;
        if (e.op === "||") return truthy(ev(e.left)) ? true : truthy(ev(e.right));
        const l = ev(e.left);
        const r = ev(e.right);
        switch (e.op) {
          case "==":
            return l === r || asLoose(l) === asLoose(r);
          case "!=":
            return !(l === r || asLoose(l) === asLoose(r));
          case "<":
            return asNumber(l) < asNumber(r);
          case "<=":
            return asNumber(l) <= asNumber(r);
          case ">":
            return asNumber(l) > asNumber(r);
          case ">=":
            return asNumber(l) >= asNumber(r);
          case "+":
            return checkFinite(asNumber(l) + asNumber(r));
          case "-":
            return checkFinite(asNumber(l) - asNumber(r));
          case "*":
            return checkFinite(asNumber(l) * asNumber(r));
          case "/": {
            const rn = asNumber(r);
            if (rn === 0) throw new ExprError("除以零");
            return checkFinite(asNumber(l) / rn);
          }
          case "%": {
            const rn = asNumber(r);
            if (rn === 0) throw new ExprError("对零取模");
            return checkFinite(asNumber(l) % rn);
          }
        }
      }
    }
  };
  return ev(ast);
}

function asLoose(v: Value): Value {
  return typeof v === "boolean" ? (v ? 1 : 0) : v;
}

function checkFinite(n: number): number {
  if (!Number.isFinite(n)) throw new ExprError("数值溢出");
  return n;
}

export function evaluate(source: string, scope: Scope): Value {
  try {
    return evalAst(parseExpr(source), scope);
  } catch (err) {
    if (err instanceof ExprError && !err.source) {
      throw new ExprError(err.message.replace(/（表达式：.*）$/, ""), source);
    }
    throw err;
  }
}

export function evaluateNumber(source: string, scope: Scope): number {
  return asNumber(evaluate(source, scope), source);
}

export function evaluateBool(source: string, scope: Scope): boolean {
  return truthy(evaluate(source, scope));
}

/** 纯数学函数白名单（与游戏状态无关的部分），供 Scope 实现复用。 */
export const PURE_FUNCTIONS: Record<string, { arity: [number, number]; fn: (args: number[]) => number }> = {
  min: { arity: [2, 8], fn: (a) => Math.min(...a) },
  max: { arity: [2, 8], fn: (a) => Math.max(...a) },
  abs: { arity: [1, 1], fn: ([x]) => Math.abs(x) },
  floor: { arity: [1, 1], fn: ([x]) => Math.floor(x) },
  ceil: { arity: [1, 1], fn: ([x]) => Math.ceil(x) },
  round: { arity: [1, 1], fn: ([x]) => Math.round(x) },
  sqrt: { arity: [1, 1], fn: ([x]) => (x < 0 ? 0 : Math.sqrt(x)) },
  clamp: { arity: [3, 3], fn: ([x, lo, hi]) => Math.min(Math.max(x, lo), hi) },
};
