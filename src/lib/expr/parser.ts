import { BinaryOp, Expr, ExprError } from "./ast";

const MAX_LENGTH = 1000;
const MAX_DEPTH = 32;
const MAX_TOKENS = 300;

interface Token {
  type: "num" | "str" | "ident" | "op" | "lparen" | "rparen" | "comma";
  value: string;
  pos: number;
}

const OPERATORS = ["==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "<", ">", "!", "?", ":"];
const IDENT_RE = /^[A-Za-z_一-鿿][A-Za-z0-9_一-鿿]*$/;

function tokenize(source: string): Token[] {
  if (source.length > MAX_LENGTH) {
    throw new ExprError(`表达式过长（超过 ${MAX_LENGTH} 字符）`, source);
  }
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j])) j++;
      const raw = source.slice(i, j);
      if (!/^\d+(\.\d+)?$/.test(raw)) throw new ExprError(`无效数字 "${raw}"`, source);
      tokens.push({ type: "num", value: raw, pos: i });
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < source.length && source[j] !== quote) j++;
      if (j >= source.length) throw new ExprError("字符串缺少结束引号", source);
      tokens.push({ type: "str", value: source.slice(i + 1, j), pos: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_一-鿿]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_.一-鿿]/.test(source[j])) j++;
      tokens.push({ type: "ident", value: source.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", value: "(", pos: i });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ")", pos: i });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ",", pos: i });
      i++;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (OPERATORS.includes(two)) {
      tokens.push({ type: "op", value: two, pos: i });
      i += 2;
      continue;
    }
    if (OPERATORS.includes(ch)) {
      tokens.push({ type: "op", value: ch, pos: i });
      i++;
      continue;
    }
    throw new ExprError(`无法识别的字符 "${ch}"（位置 ${i}）`, source);
  }
  if (tokens.length > MAX_TOKENS) {
    throw new ExprError(`表达式过于复杂（超过 ${MAX_TOKENS} 个符号）`, source);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(private tokens: Token[], private source: string) {}

  parse(): Expr {
    const expr = this.parseTernary();
    if (this.pos < this.tokens.length) {
      throw new ExprError(`多余的内容 "${this.tokens[this.pos].value}"`, this.source);
    }
    return expr;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos++];
    if (!t) throw new ExprError("表达式意外结束", this.source);
    return t;
  }

  private enter(): void {
    this.depth++;
    if (this.depth > MAX_DEPTH) throw new ExprError("表达式嵌套过深", this.source);
  }

  private exit(): void {
    this.depth--;
  }

  private parseTernary(): Expr {
    this.enter();
    let cond = this.parseBinary(0);
    const t = this.peek();
    if (t && t.type === "op" && t.value === "?") {
      this.next();
      const then = this.parseTernary();
      const colon = this.next();
      if (colon.type !== "op" || colon.value !== ":") {
        throw new ExprError("三元运算符缺少 :", this.source);
      }
      const otherwise = this.parseTernary();
      cond = { kind: "ternary", cond, then, else: otherwise };
    }
    this.exit();
    return cond;
  }

  // 优先级：|| < && < 比较 < 加减 < 乘除
  private static LEVELS: BinaryOp[][] = [
    ["||"],
    ["&&"],
    ["==", "!=", "<", "<=", ">", ">="],
    ["+", "-"],
    ["*", "/", "%"],
  ];

  private parseBinary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.parseUnary();
    this.enter();
    let left = this.parseBinary(level + 1);
    for (;;) {
      const t = this.peek();
      if (t && t.type === "op" && (Parser.LEVELS[level] as string[]).includes(t.value)) {
        this.next();
        const right = this.parseBinary(level + 1);
        left = { kind: "binary", op: t.value as BinaryOp, left, right };
      } else {
        break;
      }
    }
    this.exit();
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t && t.type === "op" && (t.value === "-" || t.value === "!")) {
      this.next();
      this.enter();
      const operand = this.parseUnary();
      this.exit();
      return { kind: "unary", op: t.value as "-" | "!", operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.next();
    if (t.type === "num") return { kind: "num", value: parseFloat(t.value) };
    if (t.type === "str") return { kind: "str", value: t.value };
    if (t.type === "lparen") {
      this.enter();
      const inner = this.parseTernary();
      this.exit();
      const close = this.next();
      if (close.type !== "rparen") throw new ExprError("缺少右括号", this.source);
      return inner;
    }
    if (t.type === "ident") {
      const parts = t.value.split(".");
      if (parts.some((p) => !IDENT_RE.test(p))) {
        throw new ExprError(`无效标识符 "${t.value}"`, this.source);
      }
      const nxt = this.peek();
      if (nxt && nxt.type === "lparen") {
        if (parts.length > 1) throw new ExprError(`函数名不能包含点号："${t.value}"`, this.source);
        this.next();
        const args: Expr[] = [];
        if (this.peek()?.type !== "rparen") {
          for (;;) {
            this.enter();
            args.push(this.parseTernary());
            this.exit();
            const sep = this.next();
            if (sep.type === "rparen") break;
            if (sep.type !== "comma") throw new ExprError("函数参数之间需要逗号", this.source);
          }
        } else {
          this.next();
        }
        return { kind: "call", name: t.value, args };
      }
      return { kind: "ident", path: parts };
    }
    throw new ExprError(`意外的符号 "${t.value}"`, this.source);
  }
}

const cache = new Map<string, Expr>();
const CACHE_LIMIT = 2000;

export function parseExpr(source: string): Expr {
  const cached = cache.get(source);
  if (cached) return cached;
  const ast = new Parser(tokenize(source), source).parse();
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(source, ast);
  return ast;
}

/** 收集表达式引用的所有标识符路径与函数调用，供语义校验使用。 */
export function collectRefs(expr: Expr): { idents: string[][]; calls: { name: string; args: Expr[] }[] } {
  const idents: string[][] = [];
  const calls: { name: string; args: Expr[] }[] = [];
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case "ident":
        idents.push(e.path);
        break;
      case "call":
        calls.push({ name: e.name, args: e.args });
        e.args.forEach(walk);
        break;
      case "unary":
        walk(e.operand);
        break;
      case "binary":
        walk(e.left);
        walk(e.right);
        break;
      case "ternary":
        walk(e.cond);
        walk(e.then);
        walk(e.else);
        break;
      default:
        break;
    }
  };
  walk(expr);
  return { idents, calls };
}
