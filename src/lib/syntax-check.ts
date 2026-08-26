import vm from "node:vm";

/**
 * 自由模式的「第一级校验」：代码写下去之前先过一遍语法。
 *
 * 快速模式写错了会被三级校验当场打回；自由模式原来这一层是空的，
 * 后果在第 3 次 VAL MANAGER 实测里现了原形：AI 写出的 js 里有一个多余的 `)`，
 * 浏览器解析失败 → 整个游戏脚本一行都没执行 → 玩家看到的是**黑屏**。
 * 而 AI 手上什么线索都没有：`read_errors` 只能拿到跨域遮蔽后的 `Script error.`，
 * 冒烟检查报的 `Unexpected token ')'` 不带文件名也不带行号。
 * 它逐行通读了 808 行也没找到，然后花了四轮、三百多万 token 去跟检查器争论「这是误判」。
 *
 * 所以这一层的价值不在「能发现语法错误」——浏览器早就发现了——
 * 而在**把文件名、行号、那一行原文当场交到 AI 手里**，让它一次就能改对。
 *
 * 只编译不执行（`new vm.Script` 就是纯编译），所以作者的代码在服务端跑不起来，
 * 也就没有沙箱逃逸那类风险。
 */

export interface SyntaxProblem {
  /** 出错的文件（html 里的内联脚本也报这个 html 的路径） */
  path: string;
  /** 1 起算的行号，落在整个文件里（内联脚本已换算过偏移） */
  line: number;
  /** V8 给的原话，例如 Unexpected token ')' */
  message: string;
  /** 那一行的原文，去掉两头空白 */
  lineText: string;
}

/** 把一条 SyntaxProblem 说成给 AI 看的人话 */
export function describeProblem(p: SyntaxProblem): string {
  return (
    `${p.path} 第 ${p.line} 行有语法错误，未落盘：${p.message}\n` +
    `    ${p.lineText}\n` +
    "先把这一行改对再写。（这是浏览器解析代码时会报的同一个错——" +
    "带着它上线，玩家打开就是黑屏。）"
  );
}

/**
 * V8 的语法错误信息藏在 stack 的头几行里，形如：
 *     game.js:4
 *     console.log(foo()));
 *                       ^
 *     SyntaxError: Unexpected token ')'
 * 取第一行的行号即可；拿不到就退回 0（调用方按「行号未知」处理）。
 */
function lineOf(err: unknown, filename: string): number {
  const stack = (err as Error)?.stack ?? "";
  for (const raw of stack.split("\n").slice(0, 3)) {
    const m = new RegExp(`^${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)$`).exec(raw.trim());
    if (m) return Number(m[1]);
  }
  return 0;
}

/**
 * ES module 语法在 `vm.Script`（普通脚本）里必然报错，但作品用
 * `<script type="module">` 引它是完全合法的。这类报错一律放行——
 * 宁可漏掉一个真错误，也不能把写得对的代码挡在门外。
 */
function isModuleOnlySyntax(message: string): boolean {
  return (
    /import statement outside a module/i.test(message) ||
    /Unexpected token 'export'/i.test(message) ||
    /await is only valid in async functions/i.test(message) ||
    /Cannot use 'import\.meta'/i.test(message)
  );
}

/** 查一段 js。offset 是这段代码在整个文件里的起始行（1 起算） */
function checkJs(path: string, code: string, offset = 1): SyntaxProblem | null {
  try {
    new vm.Script(code, { filename: path });
    return null;
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    if (!(err instanceof SyntaxError) || isModuleOnlySyntax(message)) return null;
    const local = lineOf(err, path);
    const line = local > 0 ? local + offset - 1 : offset;
    const lineText = (code.split("\n")[local > 0 ? local - 1 : 0] ?? "").trim().slice(0, 200);
    return { path, line, message, lineText };
  }
}

/**
 * 把 html 里的内联脚本抠出来。带 src 的不算（那是另一个文件，自己会被查到）；
 * type 不是 js 的也不算（`application/json`、`text/template` 这类本来就不是代码）。
 */
function inlineScripts(html: string): { code: string; offset: number }[] {
  const out: { code: string; offset: number }[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && !/^(text\/javascript|application\/javascript|module)$/.test(type)) continue;
    // 这段代码从第几行开始：数一下它前面有多少个换行
    const before = html.slice(0, m.index + m[0].indexOf(">") + 1);
    out.push({ code: m[2], offset: before.split("\n").length });
  }
  return out;
}

/**
 * 检查一个待落盘的文件。没问题返回 null。
 *
 * 只管代码文件：`.js`/`.mjs` 直接编译，`.html` 查里面的内联脚本，`.json` 查能不能解析。
 * 其余（css、csv、md、svg…）一律放行——它们坏了不会让游戏黑屏。
 */
export function checkFileSyntax(path: string, content: string): SyntaxProblem | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "js" || ext === "mjs") return checkJs(path, content);
  if (ext === "json") {
    try {
      JSON.parse(content);
      return null;
    } catch (err) {
      return {
        path,
        line: 0,
        message: (err as Error)?.message ?? "不是合法 JSON",
        lineText: "",
      };
    }
  }
  if (ext === "html" || ext === "htm") {
    for (const { code, offset } of inlineScripts(content)) {
      const bad = checkJs(path, code, offset);
      if (bad) return bad;
    }
    return null;
  }
  return null;
}
