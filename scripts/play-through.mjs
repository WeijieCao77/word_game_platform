/**
 * 像玩家那样从头玩一遍，**每个选项都试**。
 *
 * 起因是老板的一句「游戏库里的 val manager 根本就玩不了」，而平台自己的
 * 试玩体检连跑两次都报「走 13 步 · 到主界面 · 导航 11 项 · 路上无坏钮」。
 * 两边不可能都对，差别在**判据的强度**上：
 *
 *   平台走查每一屏是「按顺序点，点到一个有反应的就往下走」。
 *   所以「路上无坏钮」的真实含义是 **「我点过的那几个都好使」**，
 *   不是「每个都好使」。一屏 78 支战队，它点第一支能进就走了，
 *   剩下 77 支一支都没碰过——而玩家偏偏可能点第 40 支。
 *
 * 这个脚本补的就是那 77 支：走到一屏之后，**把这一屏的选项一个个单独试**
 * （每试一个都从头重放一遍前面的步骤，保证起点一样），报出哪些点了没反应。
 *
 * 另外两处刻意跟平台走查不一样，都是为了贴近老板的处境：
 *   - **不带 cookie**：玩家是匿名的，看的是已发布的那一版，不是作者草稿。
 *   - **每一屏原样打出来**：结论要能被人复核，不是只给一个「通过/不通过」。
 *
 * 用法：node scripts/play-through.mjs <BASE> <gameId> [每屏最多试几个=10]
 */
import { chromium } from "playwright";

const base = (process.argv[2] || "").replace(/\/+$/, "");
const gameId = process.argv[3] || "";
const MAX_TRY_PER_SCREEN = Number(process.argv[4] || 10);
if (!base || !gameId) {
  console.error("用法：node scripts/play-through.mjs <BASE> <gameId> [每屏最多试几个]");
  process.exit(2);
}

const CHROME = process.env.CHROME_PATH || "";
const CLICKABLE =
  "button:visible, [role=button]:visible, a[href]:visible, .btn:visible, " +
  "[data-screen]:visible, [data-action]:visible, li[data-id]:visible, " +
  "input[type=submit]:visible, input[type=button]:visible";
/** 走到第几步就认为「进主界面了」：一屏上有这么多导航项 */
const NAV_HINT = 6;
const MAX_STEPS = 14;
const SETTLE = 1200;

const browser = await chromium.launch(
  CHROME ? { executablePath: CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] }
);

/** 开一个**匿名**页面（玩家的处境），返回 page + 沙箱 frame + 收集到的报错 */
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text().slice(0, 200));
  });
  await page.goto(`${base}/p/${gameId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  const frame = page.frames().find((f) => f.url().includes(`/play/${gameId}`)) || page.mainFrame();
  return { ctx, page, frame, errs };
}

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

async function screen(frame) {
  const text = clean(await frame.locator("body").innerText().catch(() => ""));
  const els = frame.locator(CLICKABLE);
  const n = await els.count().catch(() => 0);
  const labels = [];
  for (let i = 0; i < Math.min(n, 60); i++) {
    labels.push(clean(await els.nth(i).innerText().catch(() => "")).slice(0, 34) || `（第${i + 1}个没有文字）`);
  }
  return { text, count: n, labels };
}

/** 输入框照填——玩家也会填。不填的话第一屏就永远过不去，量不到后面 */
async function fillAll(frame) {
  const filled = [];
  const ins = frame.locator("input:visible, textarea:visible");
  const n = await ins.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 6); i++) {
    const el = ins.nth(i);
    const type = (await el.getAttribute("type").catch(() => "")) || "text";
    if (["checkbox", "radio", "submit", "button", "range", "file"].includes(type)) continue;
    const before = await el.inputValue().catch(() => "");
    if (before.trim()) continue;
    await el.fill(type === "number" ? "1" : "测试玩家", { timeout: 1500 }).catch(() => {});
    filled.push(clean(await el.getAttribute("name").catch(() => "")) || `第${i + 1}个输入框`);
  }
  return filled;
}

/** 点一个带这个文字的元素，回「页面变没变」 */
async function clickLabel(frame, label) {
  const els = frame.locator(CLICKABLE);
  const n = await els.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const t = clean(await els.nth(i).innerText().catch(() => "")).slice(0, 34);
    if (t !== label) continue;
    const before = (await frame.locator("body").innerText().catch(() => "")).slice(0, 4000);
    await els.nth(i).click({ timeout: 4000 }).catch(() => {});
    await frame.page().waitForTimeout(SETTLE);
    const after = (await frame.locator("body").innerText().catch(() => "")).slice(0, 4000);
    return { found: true, changed: before !== after };
  }
  return { found: false, changed: false };
}

/** 把一串已知走得通的步骤重放一遍，让每次试选项的起点都一样 */
async function replay(frame, path) {
  for (const label of path) {
    await fillAll(frame);
    const r = await clickLabel(frame, label);
    if (!r.found) return false;
  }
  await fillAll(frame);
  return true;
}

console.log(`匿名玩一遍：${base}/p/${gameId}\n`);

// ── 第一趟：往前走，把每一屏原样打出来 ─────────────────────────
const first = await open();
const path = [];
let arrived = false;
let lastScreen = null;

for (let step = 1; step <= MAX_STEPS; step++) {
  const filled = await fillAll(first.frame);
  const s = await screen(first.frame);
  lastScreen = s;
  console.log(`第 ${step} 屏　正文 ${s.text.length} 字　可点 ${s.count} 处${filled.length ? `　填了：${filled.join("、")}` : ""}`);
  console.log(`  ${s.text.slice(0, 220)}`);
  if (s.count >= NAV_HINT && step > 1) {
    console.log(`  →→ 这一屏有 ${s.count} 个可点的，当作主界面\n`);
    arrived = true;
    break;
  }
  if (s.count === 0) {
    console.log(`  ✗ 一个能点的都没有——走不下去了\n`);
    break;
  }
  console.log(`  可点：${s.labels.slice(0, 12).join(" ｜ ")}`);

  // 像玩家一样：挨个试，直到有一个真的把页面推进了
  let moved = false;
  for (const label of s.labels) {
    const r = await clickLabel(first.frame, label);
    if (r.changed) {
      console.log(`  点「${label}」→ 进下一屏\n`);
      path.push(label);
      moved = true;
      break;
    }
    console.log(`  点「${label}」→ ✗ 页面没变`);
  }
  if (!moved) {
    console.log(`  ✗ 这一屏所有 ${s.labels.length} 个都点了，一个都没反应——玩家在这儿卡死\n`);
    break;
  }
}

if (first.errs.length) {
  console.log("控制台报错：");
  for (const e of [...new Set(first.errs)].slice(0, 6)) console.log(`  ${e}`);
  console.log("");
}

// ── 第二趟：把「走到主界面之前」每一屏的选项一个个单独试 ─────────
// 这是平台走查漏掉的那一层：它一屏点通一个就走，剩下的从没碰过。
console.log("──────────────────────────────────────────────");
console.log("逐个选项试（平台走查漏掉的那一层）");
console.log("──────────────────────────────────────────────\n");

for (let depth = 0; depth < path.length; depth++) {
  const prefix = path.slice(0, depth);
  const probe = await open();
  const ok = await replay(probe.frame, prefix);
  if (!ok) {
    console.log(`第 ${depth + 1} 屏：重放前面的步骤没成功，跳过`);
    await probe.ctx.close();
    continue;
  }
  const s = await screen(probe.frame);
  await probe.ctx.close();
  const sample = s.labels.slice(0, MAX_TRY_PER_SCREEN);
  console.log(`第 ${depth + 1} 屏（走到这儿要点：${prefix.join(" → ") || "（开局）"}）`);
  console.log(`  这一屏 ${s.count} 个选项，试前 ${sample.length} 个：`);

  const dead = [];
  for (const label of sample) {
    const t = await open();
    const replayed = await replay(t.frame, prefix);
    if (!replayed) {
      await t.ctx.close();
      continue;
    }
    const r = await clickLabel(t.frame, label);
    await t.ctx.close();
    if (!r.found) console.log(`    「${label}」　找不到了（可能是随机渲染的）`);
    else if (r.changed) console.log(`    「${label}」　✓`);
    else {
      console.log(`    「${label}」　✗ 点了没反应`);
      dead.push(label);
    }
  }
  if (dead.length) {
    console.log(`  ⚠ 这一屏有 ${dead.length}/${sample.length} 个点了没反应：${dead.join("、")}`);
  }
  console.log("");
}

// ── 第三趟：主界面的每个页签都点一遍 ────────────────────────────
if (arrived && lastScreen) {
  console.log("──────────────────────────────────────────────");
  console.log("主界面每个页签都点一遍");
  console.log("──────────────────────────────────────────────\n");
  const navProbe = await open();
  await replay(navProbe.frame, path);
  const nav = await screen(navProbe.frame);
  const bad = [];
  for (const label of nav.labels.slice(0, 20)) {
    const before = clean(await navProbe.frame.locator("body").innerText().catch(() => ""));
    const r = await clickLabel(navProbe.frame, label);
    const after = clean(await navProbe.frame.locator("body").innerText().catch(() => ""));
    if (!r.found) continue;
    const mark = r.changed ? "✓" : after === before ? "✗ 点了没反应" : "✓";
    console.log(`  「${label}」　${mark}　正文 ${after.length} 字`);
    if (!r.changed && after === before) bad.push(label);
    if (after.length < 60) console.log(`      ⚠ 这一页几乎是空的：${after.slice(0, 80)}`);
  }
  if (bad.length) console.log(`\n  ⚠ 点了没反应的页签：${bad.join("、")}`);
  if (navProbe.errs.length) {
    console.log("\n  这一段的控制台报错：");
    for (const e of [...new Set(navProbe.errs)].slice(0, 6)) console.log(`    ${e}`);
  }
  await navProbe.ctx.close();
}

await first.ctx.close();
await browser.close();
console.log("\n完。判据说明：这个脚本只报事实（点了变没变、正文多少字），不下「能玩/不能玩」的总结论——");
console.log("那一句要人看着上面的记录自己下，免得又多一把互相打架的尺子。");
