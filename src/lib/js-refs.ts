/**
 * 「调了一个从来没定义过的函数」——第二级接线体检。
 *
 * 线上真死过一部作品：`registerSetup is not defined（game.js:308:3）`，
 * 玩家点开只剩 64 个字。它过了第一级校验（每个文件语法都对），
 * 也过了接线体检（文件都被 index.html 引了），可它一开局就断在这一行——
 * **调用写了，定义从来没写**（或者写在了一个没被加载的文件里）。
 *
 * 这种错语法检查一辈子也查不出来：`registerSetup()` 是完全合法的 JavaScript，
 * 只有真跑起来才知道那个名字是空的。而自由模式又没有模拟器去跑。
 * 所以补这一层：**把作品自己的代码通读一遍，看有没有谁调了一个谁都没定义的名字。**
 *
 * 铁律是宁可漏、不可冤（误报比不报还坏——它会让 AI 去修一个不存在的 bug，
 * 一轮几十万 token）。所以这里处处往「不报」那边靠：
 *
 *   - 只看**裸调用** `foo(...)`。`obj.foo()` 一律不管——那是运行时才知道的东西。
 *   - 字符串、注释、模板串里的内容全部抹掉再看，免得把文案当代码。
 *   - 定义收得极宽：函数声明、类、var/let/const、直接赋值、window.x =、
 *     函数参数、catch 变量、import 进来的名字，**任何一处像定义的都算数**。
 *   - 浏览器与语言自带的一大票全局名（含平台运行库 WGP）全部放行。
 *   - 拿不准的（动态生成的名字、eval、with）一概不报。
 *
 * 报出来的两种情形都是板上钉钉的：
 *   1. 这个名字**全作品没有任何地方定义过** → 铁定 not defined
 *   2. 它定义在某个文件里，但**那个文件没被 index.html 加载** → 同样铁定 not defined，
 *      而且直接告诉 AI 少了哪一行 script
 */

/** 语言与浏览器自带的全局名。宁可多列，漏列一个就是一条误报。 */
const GLOBALS = new Set([
  // 语言内置
  "Object","Array","String","Number","Boolean","Symbol","BigInt","Function","Math","JSON","Date",
  "RegExp","Error","TypeError","RangeError","SyntaxError","ReferenceError","EvalError","URIError",
  "Map","Set","WeakMap","WeakSet","Promise","Proxy","Reflect","Intl","globalThis","eval",
  "parseInt","parseFloat","isNaN","isFinite","encodeURIComponent","decodeURIComponent",
  "encodeURI","decodeURI","structuredClone","queueMicrotask",
  "ArrayBuffer","DataView","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Uint16Array",
  "Int32Array","Uint32Array","Float32Array","Float64Array","BigInt64Array","BigUint64Array",
  // 浏览器
  "window","document","navigator","location","history","screen","parent","top","self","frames",
  "console","alert","confirm","prompt","setTimeout","clearTimeout","setInterval","clearInterval",
  "requestAnimationFrame","cancelAnimationFrame","requestIdleCallback","cancelIdleCallback",
  "getComputedStyle","matchMedia","addEventListener","removeEventListener","dispatchEvent",
  "postMessage","fetch","XMLHttpRequest","WebSocket","Worker","Blob","File","FileReader",
  "FormData","Headers","Request","Response","URL","URLSearchParams","AbortController",
  "TextEncoder","TextDecoder","Image","Audio","AudioContext","webkitAudioContext","Option",
  "Event","CustomEvent","MouseEvent","KeyboardEvent","TouchEvent","PointerEvent","MutationObserver",
  "ResizeObserver","IntersectionObserver","performance","crypto","localStorage","sessionStorage",
  "indexedDB","matchAll","scrollTo","scrollBy","open","close","print","focus","blur",
  "HTMLElement","Element","Node","NodeList","DocumentFragment","DOMParser","XPathResult",
  "CanvasRenderingContext2D","Path2D","ImageData","OffscreenCanvas","Notification","speechSynthesis",
  // 平台运行库（/wgp/runtime.js，作品里可以直接用）
  "WGP","wgp",
]);

/** 关键字：`if (`、`for (`、`switch (`… 长得像调用，但不是 */
const KEYWORDS = new Set([
  "if","for","while","switch","catch","function","return","typeof","instanceof","new","delete",
  "void","in","of","do","else","try","finally","throw","case","break","continue","var","let",
  "const","class","extends","super","this","import","export","default","yield","await","async",
  "get","set","static","with","debugger","true","false","null","undefined",
]);

export interface MissingRef {
  /** 被调用却找不到定义的名字 */
  name: string;
  /** 第一次调用它的文件 */
  file: string;
  /** 第一次调用它的行号（1 起） */
  line: number;
  /** 它其实定义在这个文件里，只是这个文件没被 index.html 加载；找不到就是空 */
  definedIn?: string;
}

/**
 * 抹掉注释、字符串、模板串与正则字面量，只留下「像代码的部分」。
 *
 * 抹的时候用等长的空格替换，行号才不会错位（报错要能指到行）。
 * 抹不干净宁可多抹——多抹只会少报几条，少抹会把文案当代码去查。
 */
/**
 * 这个 `/` 是正则的开头，还是除号？
 *
 * 没有完整的解析器就只能看前一个有意义的字符：`(`、`=`、`,`、`return` 之后
 * 是正则，标识符和 `)` 之后是除法。判错了也只会少抹或多抹一小段，
 * 不会让这一层报出假的缺失（真正危险的是不抹——那会冒出 \B( 这种假调用）。
 */
function regexAllowedBefore(out: string[], i: number): boolean {
  let k = i - 1;
  while (k >= 0 && /\s/.test(out[k])) k--;
  if (k < 0) return true;
  const c = out[k];
  if ("(,=:[!&|?{};+-*%~^<>".includes(c)) return true;
  // return / typeof / case / in / of / do / else 之后也是正则
  const word = out.slice(Math.max(0, k - 9), k + 1).join("");
  return /\b(return|typeof|case|in|of|do|else|yield|await|delete|void|instanceof)$/.test(word);
}

export function stripLiterals(src: string): string {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (c === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
    } else if (c === "/" && regexAllowedBefore(out, i)) {
      // 正则字面量：/\B(?=(\d{3}))/g 里的 \B( 长得跟函数调用一模一样，
      // 不抹掉就会报出一个叫 B 的「缺失函数」——平台自己的运行库当场中招。
      let j = i + 1;
      let cls = false;
      while (j < n) {
        const ch = src[j];
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "\n") break; // 正则不跨行；跨行了说明这是个除号，放它过去
        if (ch === "[") cls = true;
        else if (ch === "]") cls = false;
        else if (ch === "/" && !cls) break;
        j++;
      }
      if (j < n && src[j] === "/") {
        blank(i + 1, j);
        i = j + 1;
      } else {
        i++;
      }
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === c) break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

/** 这段代码里定义了哪些名字（收得尽量宽） */
export function definedNames(code: string): Set<string> {
  const names = new Set<string>();
  const add = (s: string | undefined): void => {
    if (s) names.add(s);
  };
  const id = "[A-Za-z_$][\\w$]*";
  const patterns = [
    new RegExp(`\\bfunction\\s*\\*?\\s*(${id})`, "g"),
    new RegExp(`\\bclass\\s+(${id})`, "g"),
    // var/let/const 一行里可能声明好几个：a = 1, b = 2
    new RegExp(`\\b(?:var|let|const)\\s+(${id})`, "g"),
    // 直接赋值给一个全局名，或挂到 window / globalThis 上
    new RegExp(`(?:^|[;{}\\n])\\s*(${id})\\s*=[^=]`, "g"),
    new RegExp(`\\b(?:window|globalThis|self)\\.(${id})\\s*=`, "g"),
    // catch (e) 与 import 进来的名字
    new RegExp(`\\bcatch\\s*\\(\\s*(${id})`, "g"),
    new RegExp(`\\bimport\\s+(?:\\*\\s+as\\s+)?(${id})`, "g"),
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) add(m[1]);
  }
  // 函数参数：形参在函数体里是局部名，漏收会造成一片误报。
  // 连同解构、默认值一起，把括号里所有像标识符的东西都收进来（宁可多收）。
  const paramRe = new RegExp(`(?:\\bfunction\\s*\\*?\\s*(?:${id})?\\s*|\\b${id}\\s*|\\)\\s*=>|=>)?\\(([^()]*)\\)\\s*(?:=>|\\{)`, "g");
  let p: RegExpExecArray | null;
  while ((p = paramRe.exec(code))) {
    for (const t of p[1].match(new RegExp(id, "g")) ?? []) add(t);
  }
  // 单参数箭头函数：x => …
  const arrowRe = new RegExp(`(${id})\\s*=>`, "g");
  let a: RegExpExecArray | null;
  while ((a = arrowRe.exec(code))) add(a[1]);
  // 对象方法简写 / 类方法：foo() { … } —— 它们不是全局名，但也绝不该被当成缺失
  // 前面可以是 { , ; 换行，也可以是上一个方法体的收尾 }（class A { c(){} play(){} } 就是这样）
  const methodRe = new RegExp(`(?:^|[,{;}\\n])\\s*(?:async\\s+|\\*\\s*|get\\s+|set\\s+)?(${id})\\s*\\([^()]*\\)\\s*\\{`, "g");
  let mm: RegExpExecArray | null;
  while ((mm = methodRe.exec(code))) add(mm[1]);
  return names;
}

/** 这段代码里裸调用了哪些名字（`obj.foo()` 不算） */
function calledNames(code: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  const re = /(^|[^.\\\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const name = m[2];
    if (KEYWORDS.has(name)) continue;
    const at = m.index + m[1].length;
    // `new Foo(` 里的 Foo 也算调用，但 `function foo(` 里的 foo 是定义
    const before = code.slice(Math.max(0, at - 12), at);
    if (/\b(function|class)\s*\*?\s*$/.test(before)) continue;
    const line = code.slice(0, at).split("\n").length;
    out.push({ name, line });
  }
  return out;
}

/** 从 index.html 里按顺序取出本地 js 引用（跳过外链与平台运行库） */
function scriptRefs(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b[^>]*?\bsrc\s*=\s*("|')([^"']+)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const src = m[2];
    if (/^(https?:)?\/\//i.test(src) || /^(data|blob):/i.test(src)) continue;
    if (/^\/?wgp\//i.test(src)) continue;
    out.push(src.replace(/^\.?\//, "").split(/[?#]/)[0]);
  }
  return out;
}

/** index.html 里的内联脚本正文 */
function inlineScripts(html: string): string {
  const out: string[] = [];
  const re = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out.join("\n");
}

/** 太大的作品不查——通读几百万字符不值当，而且这层本来就只是提醒 */
const MAX_TOTAL = 3_000_000;

/**
 * 体检：作品自己的代码里，有没有谁调了一个谁都没定义的名字。
 *
 * `files` 是「路径 → 内容」，要给真内容（这一层就是靠读代码干活的）。
 */
export function checkMissingRefs(files: Record<string, string>): MissingRef[] {
  const paths = Object.keys(files);
  const index = paths.find((p) => /(^|\/)index\.html$/i.test(p));
  if (!index) return [];
  const total = paths.reduce((n, p) => n + (files[p]?.length ?? 0), 0);
  if (total > MAX_TOTAL) return [];

  const html = files[index] ?? "";
  const loaded = scriptRefs(html).filter((p) => typeof files[p] === "string");
  const sources: { file: string; code: string }[] = [
    { file: index, code: stripLiterals(inlineScripts(html)) },
    ...loaded.map((p) => ({ file: p, code: stripLiterals(files[p] ?? "") })),
  ];

  // 加载进来的那些文件定义了什么
  const defined = new Set<string>();
  for (const s of sources) for (const n of definedNames(s.code)) defined.add(n);

  // 没被加载的文件定义了什么——用来把话说得更准：
  // 「registerSetup 在 screens-setup.js 里，只是那个文件没被引进来」
  const elsewhere = new Map<string, string>();
  for (const p of paths) {
    if (p === index || loaded.includes(p)) continue;
    if (!/\.(js|mjs)$/i.test(p)) continue;
    for (const n of definedNames(stripLiterals(files[p] ?? ""))) {
      if (!elsewhere.has(n)) elsewhere.set(n, p);
    }
  }

  const seen = new Set<string>();
  const out: MissingRef[] = [];
  for (const s of sources) {
    for (const c of calledNames(s.code)) {
      if (defined.has(c.name) || GLOBALS.has(c.name) || seen.has(c.name)) continue;
      seen.add(c.name);
      out.push({ name: c.name, file: s.file, line: c.line, definedIn: elsewhere.get(c.name) });
    }
  }
  return out;
}

/** 最多说几条——一次说二十条谁也修不完，先把最前面的几条修掉再说 */
const MAX_REPORT = 8;

/** 写成给 AI 看的话；没问题返回空串 */
export function describeMissingRefs(list: MissingRef[]): string {
  if (list.length === 0) return "";
  const shown = list.slice(0, MAX_REPORT);
  const lines = shown.map((r) =>
    r.definedIn
      ? `- ${r.name}()（${r.file}:${r.line} 调的）：它定义在 ${r.definedIn} 里，` +
        `但 index.html 没有加载那个文件——补一行 <script src="${r.definedIn}"></script>，` +
        `排在用到它的脚本前面。`
      : `- ${r.name}()（${r.file}:${r.line} 调的）：**整部作品没有任何地方定义过它**。` +
        `要么把它写出来，要么这里本来该调别的名字。`
  );
  return (
    `⚠ 有 ${list.length} 个名字被调用了却找不到定义——作品一跑到这里就会断在 ` +
    `「xxx is not defined」，后面的代码一行都不会执行（玩家看到的是一片空白）：\n` +
    lines.join("\n") +
    (list.length > shown.length ? `\n…还有 ${list.length - shown.length} 个。` : "")
  );
}
