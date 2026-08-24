export { ExprError } from "./ast";
export type { Expr, Value } from "./ast";
export { parseExpr, collectRefs } from "./parser";
export {
  evaluate,
  evaluateNumber,
  evaluateBool,
  evalAst,
  asNumber,
  PURE_FUNCTIONS,
} from "./eval";
export type { Scope } from "./eval";
