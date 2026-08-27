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
  /** 它其实定义在这个文件里；找不到就是空 */
  definedIn?: string;
  /**
   * 哪一种「找不到」：
   *   nowhere    整部作品没有任何地方定义过它
   *   not-loaded 定义在某个文件里，但那个文件没被 index.html 加载
   *   too-late   定义在一个**排在后面**的文件里，而这一行在加载时就执行了
   */
  kind: "nowhere" | "not-loaded" | "too-late";
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
      const where = elsewhere.get(c.name);
      out.push({
        name: c.name,
        file: s.file,
        line: c.line,
        definedIn: where,
        kind: where ? "not-loaded" : "nowhere",
      });
    }
  }

  // 加载顺序：名字确实定义了，可**调的时候还没定义**。
  //
  // 线上那部 VAL MANAGER 就死在这儿——game.js 排在 screens-setup.js 前面，
  // 却在启动时就调 registerSetup()。前面几层查的都是「定义在不在」，
  // 这一层查的是「调的那一刻在不在」。
  const definedBy = loaded.map((p) => definedNames(stripLiterals(files[p] ?? "")));
  // index.html 里的内联脚本位置不好判（可能在 head 也可能在 body 末尾），
  // 一律当成「谁都用得上」——宁可漏，不可冤
  const inline = definedNames(stripLiterals(inlineScripts(html)));
  for (let a = 0; a < loaded.length; a++) {
    const earlier = new Set<string>(inline);
    for (let k = 0; k <= a; k++) for (const n of definedBy[k]) earlier.add(n);
    for (const c of loadTimeCalls(stripLiterals(files[loaded[a]] ?? ""))) {
      if (earlier.has(c.name) || GLOBALS.has(c.name) || seen.has(c.name)) continue;
      const laterIdx = definedBy.findIndex((set, k) => k > a && set.has(c.name));
      if (laterIdx < 0) continue;
      seen.add(c.name);
      out.push({
        name: c.name,
        file: loaded[a],
        line: c.line,
        definedIn: loaded[laterIdx],
        kind: "too-late",
      });
    }
  }
  return out;
}

/**
 * 「加载的时候那个名字还不存在」——加载顺序体检。
 *
 * 线上那部 VAL MANAGER 就死在这里，而且前面三层护栏一层都拦不住：
 *
 *     index.html：… game.js, screens-setup.js …   ← game.js 排在前面
 *     game.js:308           registerSetup();       ← 启动时就调
 *     screens-setup.js:5    function registerSetup() {   ← 定义在后面那个文件里
 *
 * 语法对、文件也都引了、名字也确实定义过——可浏览器执行到 game.js 第 308 行时，
 * screens-setup.js 还没开始加载，那个名字就是空的。脚本当场断掉，后面一行都不跑，
 * 玩家看到 64 个字。
 *
 * 判据的核心是**这行代码是不是在加载的那一刻就会执行**：
 *   - 顶层的语句：会
 *   - 顶层 if / for / try 块里的：会
 *   - 立即执行函数（IIFE）里的：会
 *   - 顶层具名函数的函数体：**只有这个函数被上面那些地方调到了才会**（一路传递下去）
 *   - 其余（回调、对象字面量里的方法、类的方法）：不会，一律不报
 *
 * 最后一条是这层能不能上线的关键。「game.js 里的点击处理函数调了 screens-*.js 里的
 * 渲染函数」是完全正常、也完全安全的写法——点的时候所有文件早加载完了。
 * 把它报出来就是误报，而误报比不报还坏。
 */

/** 一段顶层花括号块 */
interface Block {
  /** `{` 的下标 */
  open: number;
  /** `}` 的下标 */
  close: number;
  /** `{` 前面那一小段原文，用来判断这是什么块 */
  head: string;
  /** `}` 后面那一小段原文，用来认出 IIFE 的 `)()` */
  tail: string;
}

/** 把一段代码按**这一层**的花括号切成若干块（不进入嵌套） */
function topBlocks(code: string, from = 0, to = code.length): Block[] {
  const out: Block[] = [];
  let depth = 0;
  let open = -1;
  for (let i = from; i < to; i++) {
    const c = code[i];
    if (c === "{") {
      if (depth === 0) open = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && open >= 0) {
        out.push({
          open,
          close: i,
          head: code.slice(Math.max(from, open - 120), open),
          tail: code.slice(i + 1, Math.min(to, i + 8)),
        });
        open = -1;
      }
      if (depth < 0) depth = 0; // 花括号没配平（少见）就当它没发生，别把整层判废
    }
  }
  return out;
}

type BlockKind = "fn" | "iife" | "control" | "other";

function classify(b: Block): { kind: BlockKind; name?: string } {
  const head = b.head;
  // 立即执行：`})()` 或 `}()`
  if (/^\s*\)?\s*\(/.test(b.tail)) return { kind: "iife" };
  const fn = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*$/.exec(head);
  if (fn) return { kind: "fn", name: fn[1] };
  if (/\bclass\b[^{]*$/.test(head)) return { kind: "other" };
  // 顶层的 if / for / while / switch / try / else / do —— 加载时就会跑
  if (/\b(if|for|while|switch|catch|with)\s*\([^()]*\)\s*$/.test(head)) return { kind: "control" };
  if (/\b(try|else|do|finally)\s*$/.test(head)) return { kind: "control" };
  return { kind: "other" };
}

interface CallSite {
  name: string;
  line: number;
}

/** 取出一段区间里的裸调用（不进入嵌套块） */
function callsInRange(code: string, from: number, to: number, skip: Block[]): CallSite[] {
  const holes = skip.map((b) => [b.open, b.close] as const);
  const inHole = (i: number): boolean => holes.some(([a, z]) => i > a && i < z);
  const out: CallSite[] = [];
  const re = /(^|[^.\\\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) && m.index < to) {
    const at = m.index + m[1].length;
    if (at < from || at >= to || inHole(at)) continue;
    const name = m[2];
    if (KEYWORDS.has(name)) continue;
    const before = code.slice(Math.max(0, at - 12), at);
    if (/\b(function|class)\s*\*?\s*$/.test(before)) continue;
    out.push({ name, line: code.slice(0, at).split("\n").length });
  }
  return out;
}

/**
 * 这段代码在**加载那一刻**会调到哪些名字。
 *
 * 顶层具名函数只有被调到了才算数，而且要一路传递下去
 * （init() 调 boot()，boot() 里调的也算）。
 */
export function loadTimeCalls(code: string): CallSite[] {
  const fns = new Map<string, Block>();
  const eager: Block[] = [];
  const collect = (from: number, to: number, acc: CallSite[]): void => {
    const blocks = topBlocks(code, from, to);
    acc.push(...callsInRange(code, from, to, blocks));
    for (const b of blocks) {
      const k = classify(b);
      if (k.kind === "fn" && k.name) {
        if (!fns.has(k.name)) fns.set(k.name, b);
      } else if (k.kind === "iife" || k.kind === "control") {
        eager.push(b);
      }
    }
  };

  const acc: CallSite[] = [];
  collect(0, code.length, acc);
  // 立即执行块与控制块里的内容同样是加载时执行的，递归进去
  let queue = [...eager];
  const seenBlocks = new Set<number>();
  while (queue.length > 0) {
    const b = queue.shift()!;
    if (seenBlocks.has(b.open)) continue;
    seenBlocks.add(b.open);
    const before = eager.length;
    collect(b.open + 1, b.close, acc);
    queue = queue.concat(eager.slice(before));
  }
  // 被加载时调到的顶层函数，函数体也算加载时执行——一路传递
  const done = new Set<string>();
  for (let guard = 0; guard < 200; guard++) {
    const next = acc.find((c) => fns.has(c.name) && !done.has(c.name));
    if (!next) break;
    done.add(next.name);
    const body = fns.get(next.name)!;
    const before = eager.length;
    collect(body.open + 1, body.close, acc);
    for (const b of eager.slice(before)) {
      if (!seenBlocks.has(b.open)) {
        seenBlocks.add(b.open);
        collect(b.open + 1, b.close, acc);
      }
    }
  }
  return acc;
}

/** 最多说几条——一次说二十条谁也修不完，先把最前面的几条修掉再说 */
const MAX_REPORT = 8;

/** 写成给 AI 看的话；没问题返回空串 */
export function describeMissingRefs(list: MissingRef[]): string {
  if (list.length === 0) return "";
  const shown = list.slice(0, MAX_REPORT);
  const lines = shown.map((r) => {
    if (r.kind === "too-late") {
      return (
        `- ${r.name}()（${r.file}:${r.line} 调的）：它定义在 ${r.definedIn} 里，` +
        `而 index.html 把 ${r.definedIn} 排在 ${r.file} **后面**——` +
        `这一行在页面加载时就执行了，那时候 ${r.definedIn} 还没加载，名字是空的。` +
        `两个办法挑一个：把 ${r.definedIn} 的 <script> 挪到 ${r.file} 前面，` +
        `或者把启动代码挪进 window.addEventListener("load", …)（**推荐**，` +
        `这样谁先谁后都不影响）。`
      );
    }
    if (r.kind === "not-loaded") {
      return (
        `- ${r.name}()（${r.file}:${r.line} 调的）：它定义在 ${r.definedIn} 里，` +
        `但 index.html 没有加载那个文件——补一行 <script src="${r.definedIn}"></script>，` +
        `排在用到它的脚本前面。`
      );
    }
    return (
      `- ${r.name}()（${r.file}:${r.line} 调的）：**整部作品没有任何地方定义过它**。` +
      `要么把它写出来，要么这里本来该调别的名字。`
    );
  });
  return (
    `⚠ 有 ${list.length} 个名字被调用了却找不到定义——作品一跑到这里就会断在 ` +
    `「xxx is not defined」，后面的代码一行都不会执行（玩家看到的是一片空白）：\n` +
    lines.join("\n") +
    (list.length > shown.length ? `\n…还有 ${list.length - shown.length} 个。` : "")
  );
}
