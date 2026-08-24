// 受限表达式语言的 AST 定义。
// 该语言只允许：数字/字符串字面量、点分标识符、四则运算、比较、
// 逻辑运算、三元运算、白名单函数调用。绝不执行任意 JS。

export type Expr =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "ident"; path: string[] }
  | { kind: "call"; name: string; args: Expr[] }
  | { kind: "unary"; op: "-" | "!"; operand: Expr }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { kind: "ternary"; cond: Expr; then: Expr; else: Expr };

export type BinaryOp =
  | "+" | "-" | "*" | "/" | "%"
  | "==" | "!=" | "<" | "<=" | ">" | ">="
  | "&&" | "||";

export type Value = number | string | boolean;

export class ExprError extends Error {
  constructor(message: string, public readonly source?: string) {
    super(source ? `${message}（表达式：${source}）` : message);
    this.name = "ExprError";
  }
}
