#!/usr/bin/env node
/**
 * 把一部**已发布**的自由模式作品的代码抓下来，逐个文件做语法检查，指出错在哪一行。
 *
 *     node scripts/syntax-freemode.mjs https://线上地址 <gameId>
 *
 * 为什么要有这个：第 3 次 VAL MANAGER 实测判红，玩家看到的是**黑屏**。
 * 根因是 AI 写的 js 里有个语法错误——浏览器解析失败，游戏脚本一行都没执行。
 * 但沙箱 iframe 是不透明源，错误传到平台只剩一句 `Script error.`，
 * 谁也看不出错在哪个文件第几行。这个脚本就是补这一刀。
 *
 * 判定逻辑与 src/lib/syntax-check.ts 一致（那份是写文件时的门禁，这份是对线上作品的体检）。
 * 这里必须是独立的 .mjs：脚本要在 Actions 的 runner 上直接跑，不经过打包。
 *
 * 退出码：0 = 全部能解析；1 = 发现语法错误；2 = 抓不到作品。
 */
import vm from "node:vm";

const [, , base, gameId] = process.argv;
if (!base || !gameId) {
  console.error("用法：node scripts/syntax-freemode.mjs <baseUrl> <gameId>");
  process.exit(2);
}

const MODULE_ONLY =
  /(import statement outside a module|Unexpected token 'export'|await is only valid in async functions|Cannot use 'import\.meta')/i;

function checkJs(path, code, offset = 1) {
  try {
    new vm.Script(code, { filename: path });
    return null;
  } catch (err) {
    const message = err?.message ?? String(err);
    if (!(err instanceof SyntaxError) || MODULE_ONLY.test(message)) return null;
    let local = 0;
    for (const raw of String(err.stack ?? "").split("\n").slice(0, 3)) {
      const m = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)$`).exec(raw.trim());
      if (m) {
        local = Number(m[1]);
        break;
      }
    }
    const line = local > 0 ? local + offset - 1 : offset;
    const lineText = (code.split("\n")[local > 0 ? local - 1 : 0] ?? "").trim().slice(0, 200);
    return { path, line, message, lineText };
  }
}

function inlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && !/^(text\/javascript|application\/javascript|module)$/.test(type)) continue;
    const before = html.slice(0, m.index + m[0].indexOf(">") + 1);
    out.push({ code: m[2], offset: before.split("\n").length });
  }
  return out;
}

const get = async (path) => {
  const r = await fetch(`${base}/play/${gameId}/${path}`);
  return r.ok ? await r.text() : null;
};

const index = await get("index.html");
if (index === null) {
  console.error(`抓不到 ${base}/play/${gameId}/index.html —— 作品要处于「已发布」状态才公开可读。`);
  process.exit(2);
}

// index.html 里 <script src> / <link href> 引到的自家文件，就是这部作品的代码
const refs = new Set();
for (const m of index.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) refs.add(m[1]);
const own = [...refs].filter((p) => !/^(https?:)?\/\//.test(p) && !p.startsWith("wgp."));

console.log(`=== ${gameId} 语法体检 ===`);
console.log(`index.html ${index.length} 字符，引了 ${own.length} 个脚本：${own.join("、") || "（无）"}`);

const problems = [];
const bad = checkFileSyntax("index.html", index);
if (bad) problems.push(bad);

for (const path of own) {
  const code = await get(path);
  if (code === null) {
    console.log(`  ! ${path} 取不到（404）——index.html 引了一个不存在的文件，这本身就是硬伤`);
    problems.push({ path, line: 0, message: "文件不存在（index.html 引用了它）", lineText: "" });
    continue;
  }
  const p = checkJs(path, code);
  console.log(`  ${p ? "✗" : "✓"} ${path}（${code.length} 字符）${p ? ` 第 ${p.line} 行：${p.message}` : ""}`);
  if (p) problems.push(p);
}

function checkFileSyntax(path, content) {
  if (/\.(js|mjs)$/i.test(path)) return checkJs(path, content);
  if (/\.html?$/i.test(path)) {
    for (const { code, offset } of inlineScripts(content)) {
      const p = checkJs(path, code, offset);
      if (p) return p;
    }
  }
  return null;
}

if (problems.length === 0) {
  console.log("\n结论：所有代码都能解析——黑屏的话就不是语法问题，去看运行时报错。");
  process.exit(0);
}

console.log(`\n结论：${problems.length} 处语法错误，玩家打开就是黑屏。`);
for (const p of problems) {
  console.log(`\n${p.path} 第 ${p.line} 行：${p.message}`);
  if (p.lineText) console.log(`    ${p.lineText}`);
}
process.exit(1);
