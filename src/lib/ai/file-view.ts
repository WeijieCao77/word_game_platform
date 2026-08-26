/**
 * 怎么把一个「比模型上下文还大的文件」给 AI 看。
 *
 * 这是复刻 VAL MANAGER 绕不过去的一关。原作 13,132 行；一份长成那样的 game.js
 * 有几十万字符，而 read_file 原来的做法是「前 30,000 字符，剩下截断」——
 * 也就是说文件一旦长过三万字，**后面的部分 AI 再也看不见了**，
 * 也就再也改不动了（patch_file 要先看准原文才能改）。作品长到一半就卡死。
 *
 * 人读大文件从来不是从头读到尾，而是：先看目录 → 跳到那一节 → 或者直接搜一个词。
 * 这里给的就是这三样：
 *   read_file(path)                      小文件给全文；大文件给**目录**（每一节在第几行）
 *   read_file(path, from, lines)         看某一段，带行号
 *   read_file(path, find: "xxx")         搜一个词，给出现的位置和上下文
 *
 * 有了它，文件多大都改得动——这正是「一层层搭到几千行」的前提。
 */

/** 小于这个长度就直接给全文，省得让 AI 多跑一趟 */
const FULL_MAX = 30_000;
/** 一次最多给多少行 */
const MAX_LINES = 400;
const DEFAULT_LINES = 140;
/** 搜索最多展示几处 */
const SHOW_HITS = 3;
/** 目录最多列几条 */
const MAX_OUTLINE = 200;
/** 搜索上下文各留几行 */
const CONTEXT = 8;

export interface ViewOptions {
  from?: number;
  lines?: number;
  find?: string;
}

export function viewFile(path: string, content: string, opt: ViewOptions = {}): string {
  const all = content.split("\n");
  const total = all.length;

  if (opt.find) return search(path, all, opt.find);
  if (typeof opt.from === "number" && opt.from > 0) {
    return window(path, all, opt.from, opt.lines);
  }
  if (content.length <= FULL_MAX) return content;

  return (
    `${path} 有 ${total} 行 / ${content.length} 字符，太大了不能一次全给你。下面是它的目录。\n` +
    `要看某一段：read_file(path, from: 行号, lines: 行数)；` +
    `要找某段代码：read_file(path, find: "一小段原文")。\n\n` +
    outline(path, all)
  );
}

/** 给一段，带行号——行号是给 patch_file 定位用的 */
function window(path: string, all: string[], from: number, lines?: number): string {
  const total = all.length;
  const start = Math.max(1, Math.min(from, total));
  const count = Math.max(1, Math.min(lines ?? DEFAULT_LINES, MAX_LINES));
  const end = Math.min(total, start + count - 1);
  const body = all
    .slice(start - 1, end)
    .map((l, i) => `${start + i}| ${l}`)
    .join("\n");
  const tail = end < total ? `\n…（还有 ${total - end} 行，接着读：from: ${end + 1}）` : "";
  return `${path} 第 ${start}–${end} 行 / 共 ${total} 行\n${body}${tail}`;
}

/** 搜一个词，给出现位置与上下文 */
function search(path: string, all: string[], needle: string): string {
  const hits: number[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].includes(needle)) hits.push(i + 1);
  }
  if (hits.length === 0) {
    return (
      `${path} 里没有「${needle}」。别照着印象改——` +
      `先 read_file(path) 看目录，或换一小段确定存在的原文再搜。`
    );
  }
  const shown = hits.slice(0, SHOW_HITS).map((line) => {
    const start = Math.max(1, line - CONTEXT);
    const end = Math.min(all.length, line + CONTEXT);
    const body = all
      .slice(start - 1, end)
      .map((l, i) => `${start + i}|${start + i === line ? ">" : " "} ${l}`)
      .join("\n");
    return `— 第 ${line} 行 —\n${body}`;
  });
  // 只要出现不止一次就要点破——patch_file 要求 find 在文件里唯一，
  // 两次和九次一样会失败，早说一句省它一整轮
  let more = "";
  if (hits.length > 1) {
    more = `\n\n**这段原文不唯一（${hits.length} 处），patch_file 的 find 要写得更长**，把上下几行带上。`;
    if (hits.length > SHOW_HITS) {
      more += `\n另外还有 ${hits.length - SHOW_HITS} 处：第 ${hits.slice(SHOW_HITS).join("、")} 行。`;
    }
  }
  return `${path} 里「${needle}」出现 ${hits.length} 次（共 ${all.length} 行）\n\n${shown.join("\n\n")}${more}`;
}

/** 文件目录：哪一节在第几行 */
function outline(path: string, all: string[]): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const marks: string[] = [];
  for (let i = 0; i < all.length && marks.length < MAX_OUTLINE; i++) {
    const label = markOf(ext, all[i]);
    if (label) marks.push(`${i + 1}| ${label}`);
  }
  if (marks.length === 0) {
    return `（这个文件里没找到可以当目录的结构，直接按行读：read_file(path, from: 1, lines: ${DEFAULT_LINES})）`;
  }
  const tail = marks.length >= MAX_OUTLINE ? `\n…（目录也太长了，只列了前 ${MAX_OUTLINE} 条）` : "";
  return marks.join("\n") + tail;
}

function markOf(ext: string, raw: string): string | null {
  const line = raw.trimEnd();
  const t = line.trim();
  if (!t) return null;

  if (ext === "css") {
    if (/^@(media|supports|keyframes)/.test(t)) return t.replace(/\s*\{\s*$/, "");
    if (/^[.#:@[a-zA-Z][^{}]*\{\s*$/.test(t) && !t.startsWith("/*")) return t.replace(/\s*\{\s*$/, "");
    // 分节注释：/* ── 表格 ── */
    if (/^\/\*.*\*\/$/.test(t) && t.length < 80) return t;
    return null;
  }

  if (ext === "html" || ext === "htm") {
    const id = /<(section|main|div|nav|header|footer)\b[^>]*\bid="([^"]+)"/.exec(t);
    if (id) return `<${id[1]} id="${id[2]}">`;
    const h = /^<(h[1-4])\b[^>]*>(.{0,60})/.exec(t);
    if (h) return `<${h[1]}> ${h[2].replace(/<[^>]*>/g, "")}`;
    if (/^<(script|style|template)\b/.test(t)) return t.slice(0, 70);
    return null;
  }

  // js / ts / 其它：认函数、类、界面注册、分节注释。
  // 名字不要限成 ASCII——AI 写中文项目时函数就叫「结算第0周」，
  // 限死了目录里恰恰漏掉最该看的那几行。
  if (/^\s*(export\s+)?(async\s+)?function\s+[^\s(){}]+/.test(line)) return t.replace(/\s*\{\s*$/, "");
  if (/^\s*(export\s+)?class\s+[^\s(){}]+/.test(line)) return t.replace(/\s*\{\s*$/, "");
  if (/^\s*(export\s+)?(const|let|var)\s+[^\s(){}=]+\s*=\s*(async\s*)?(function\b|\(|\{)/.test(line)) {
    return t.replace(/\s*[{(].*$/, "").trim();
  }
  // WGP.screen("squad", …) —— 自由模式里一个界面就是一节
  const screen = /WGP\.screen\(\s*["']([^"']+)["']/.exec(t);
  if (screen) return `界面 ${screen[1]}`;
  // 分节注释：// ── 三、界面 ── / /* ===== 结算 ===== */
  if (/^\/\/\s*[─=—*-]{2,}/.test(t) || /^\/\*\s*[─=—*-]{2,}/.test(t)) return t.slice(0, 70);
  if (/^\/\/\s*[一二三四五六七八九十]+[、.]/.test(t)) return t.slice(0, 70);
  return null;
}
