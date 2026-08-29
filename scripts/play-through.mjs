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
/**
 * 「这一屏的主动作」。
 *
 * 第一版没有这个，于是在天赋加点那一屏上，走查按 DOM 顺序点到第一个 `−`
 * 就算「页面变了」，在 ± 上来回打转，**根本没走到真正的主界面**——
 * 却因为那一屏可点的有 17 个，把它当成主界面报了一堆假的「坏页签」。
 * 这跟 PITFALLS 17.8 是同一族错（把中途某一屏当成主导航），我自己又犯了一次。
 *
 * 玩家不会在 ± 上打转，他会去找那个「确定/开始/下一步」。所以候选排序时
 * 把这类词排到最前面。
 */
const PRIMARY = /(确定|确认|开始|下一步|继续|进入|执教|出发|完成|接受|签下|就他|选好)/;
/** 一屏上可点的到了这个数，就值得把每一个都单独试一遍（导航条长这样） */
const NAV_HINT = 6;
const MAX_STEPS = 14;
const SETTLE = 1200;
/**
 * 逐项试是要开新浏览器重放的，很贵。给个总预算，免得一部大作品跑到天荒地老。
 * 自测那一版没有这条：走进主界面之后每点一个页签都被当成「又进了一屏」，
 * 于是排出十几屏、每屏十几项，两百多次重放，跑了十分钟一个字都没吐出来。
 */
const PROBE_BUDGET = 60;

/**
 * 两屏「可点的东西」像不像。
 *
 * 用来分辨**「进了下一屏」**和**「还在这一屏，只是换了个页签」**——
 * 主界面点「阵容」，正文变了，可那一条导航还是原来那 15 项。
 * 不认这一条，走查会在主界面里一路点到步数用光，
 * 而且把每一次换页签都排成「新的一屏」，逐项试的开销当场爆掉。
 */
function alike(a, b) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a), B = new Set(b);
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / Math.max(A.size, B.size);
}

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
  // 主动作排前面（理由见 PRIMARY 的注释）；其余保持 DOM 顺序
  const ordered = [...labels.filter((l) => PRIMARY.test(l)), ...labels.filter((l) => !PRIMARY.test(l))];
  return { text, count: n, labels: ordered, domOrder: labels };
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

// ── 第一趟：一直往前走，把每一屏原样打出来 ─────────────────────
//
// 关键的一条：**不要走到「可点的多」那一屏就停下来当主界面**。
// 第一版就是那么干的，结果在天赋加点那一屏（17 个 ± 按钮）停住，
// 报了一堆假的「坏页签」，真正的主界面一眼都没看到。
// 停下来的唯一条件是：这一屏所有东西都点过了，没有一个能把页面推进。
const first = await open();
const path = [];
const seen = new Set();
let prevLabels = null;

for (let step = 1; step <= MAX_STEPS; step++) {
  const filled = await fillAll(first.frame);
  const s = await screen(first.frame);
  const sig = `${s.text.length}|${s.text.slice(0, 120)}`;
  // 一整条导航还是原来那些项 = 还在这一屏，只是换了个页签。到此为止。
  if (prevLabels && alike(s.labels, prevLabels) >= 0.8) {
    // **不要把最后那一步从 path 里弹掉。**
    //
    // 自测逮到的：确认页（导航条摆在那儿但一项都不响应）和真主界面（导航活了）
    // 上面的**文字一模一样**，alike 只看文字，分不出来——它们的差别在行为上。
    // 弹掉最后一步，逐项试就只试到确认页，**真主界面一项都没测**，
    // 而那恰恰是最该测的一屏。宁可多试一屏，也不能把它漏掉。
    console.log(`第 ${step} 屏　可点的跟上一屏基本一样——多半是同一屏在换页签，不再往前走。\n`);
    break;
  }
  prevLabels = s.labels;
  console.log(
    `第 ${step} 屏　正文 ${s.text.length} 字　可点 ${s.count} 处${filled.length ? `　填了：${filled.join("、")}` : ""}`
  );
  console.log(`  ${s.text.slice(0, 220)}`);
  if (s.count === 0) {
    console.log(`  ✗ 一个能点的都没有——走不下去了\n`);
    break;
  }
  console.log(`  可点：${s.labels.slice(0, 14).join(" ｜ ")}`);

  let moved = false;
  for (const label of s.labels) {
    const r = await clickLabel(first.frame, label);
    if (!r.changed) continue;
    // 变了但变回一个见过的样子，不算前进（± 那种来回切最容易骗过走查）
    const now = await screen(first.frame);
    const nowSig = `${now.text.length}|${now.text.slice(0, 120)}`;
    if (seen.has(nowSig)) {
      console.log(`  点「${label}」→ 页面变了，但回到了走过的样子，不算前进`);
      continue;
    }
    seen.add(sig);
    console.log(`  点「${label}」→ 进下一屏\n`);
    path.push(label);
    moved = true;
    break;
  }
  if (!moved) {
    console.log(`  ✗ 这一屏 ${s.labels.length} 个全点过了，没有一个能往前走——玩家在这儿卡死\n`);
    break;
  }
}

if (first.errs.length) {
  console.log("控制台报错：");
  for (const e of [...new Set(first.errs)].slice(0, 6)) console.log(`  ${e}`);
  console.log("");
}
await first.ctx.close();

// ── 第二趟：路上每一屏的选项，一个个单独试 ──────────────────────
//
// 这就是平台走查漏掉的那一层。它每一屏点通一个就走，
// 所以「路上无坏钮」的真实含义是「我点过的那几个都好使」。
console.log("──────────────────────────────────────────────");
console.log("逐个选项试（平台走查漏掉的那一层）");
console.log("──────────────────────────────────────────────\n");

let spent = 0;
for (let depth = 0; depth <= path.length; depth++) {
  if (spent >= PROBE_BUDGET) {
    console.log(`（逐项试的预算 ${PROBE_BUDGET} 次用完了，后面的屏没试。分母就是这么多，别当成全通。）`);
    break;
  }
  const prefix = path.slice(0, depth);
  const probe = await open();
  if (!(await replay(probe.frame, prefix))) {
    console.log(`第 ${depth + 1} 屏：重放前面的步骤没成功，跳过（多半是随机渲染的选项）\n`);
    await probe.ctx.close();
    continue;
  }
  const s = await screen(probe.frame);
  await probe.ctx.close();
  if (!s.count) continue;

  // 导航条那种一屏十几项的，全试；普通选择屏按参数抽样
  const budget = s.count >= NAV_HINT ? Math.max(MAX_TRY_PER_SCREEN, 20) : MAX_TRY_PER_SCREEN;
  const sample = s.domOrder.slice(0, Math.min(budget, PROBE_BUDGET - spent));
  spent += sample.length;
  console.log(`第 ${depth + 1} 屏（走到这儿要点：${prefix.join(" → ") || "（开局）"}）`);
  console.log(`  这一屏 ${s.count} 个可点的，试 ${sample.length} 个：`);

  const dead = [];
  const alive = [];
  for (const label of sample) {
    const t = await open();
    if (!(await replay(t.frame, prefix))) {
      await t.ctx.close();
      continue;
    }
    const r = await clickLabel(t.frame, label);
    await t.ctx.close();
    if (!r.found) console.log(`    「${label}」　找不到了（多半是随机渲染的）`);
    else if (r.changed) {
      console.log(`    「${label}」　✓`);
      alive.push(label);
    } else {
      console.log(`    「${label}」　✗ 点了没反应`);
      dead.push(label);
    }
  }
  // 分母写出来。「N 项里 N 项通过」和「点过的那几项通过」是两句话（PITFALLS 17.17）
  console.log(`  小结：试了 ${dead.length + alive.length} 个，${alive.length} 个有反应，${dead.length} 个没反应`);
  if (dead.length) console.log(`  ⚠ 点了没反应：${dead.join("、")}`);
  if (dead.length >= 5 && alive.length <= 2) {
    console.log(
      `  ⚠⚠ 这一屏摆着 ${s.count} 个看着能点的，实际只有 ${alive.length} 个有用——` +
        `玩家点哪个都没反应，会直接判定「这游戏坏了」，哪怕代码是「按设计工作」的。`
    );
  }
  console.log("");
}

await browser.close();
console.log("判据说明：这个脚本只报事实（点了变没变、正文多少字、分母是多少），");
console.log("不下「能玩/不能玩」的总结论——那一句要人看着上面的记录自己下，");
console.log("免得平台又多一把互相打架的尺子。");
