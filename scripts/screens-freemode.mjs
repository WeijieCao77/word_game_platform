// 界面体检：一部自由模式作品的每一个界面，到底画出东西了没有。
//
// 为什么光看源码不够：验收标准是「功能和 UI 完全一样」，而源码里出现「阵容」两个字
// 太容易了——写一个导航按钮就有了。真正要问的是**点进去之后有没有东西**。
// 这个脚本就干这件事：把顶部导航一个个点过去，每一页记下
// 字数、可点元素、表格行数、有没有报错，然后判断它是「真页面」还是「占位页」。
//
// 用法：node scripts/screens-freemode.mjs <baseUrl> <gameId> [editKey]
// 退出码 0 = 每个界面都有内容，1 = 有占位页或报错页。

const pw = await import("playwright").catch(async () => {
  const g = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.js";
  return import(g).catch(() => {
    console.error("找不到 playwright。装一个：npm i -g playwright，或用 PLAYWRIGHT_MODULE 指到它的路径。");
    process.exit(2);
  });
});
const chromium = pw.chromium ?? pw.default?.chromium;

const [base, gameId, editKey] = process.argv.slice(2);
if (!base || !gameId) {
  console.error("用法: node scripts/screens-freemode.mjs <baseUrl> <gameId> [editKey]");
  process.exit(2);
}

const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/**
 * 什么叫「这一页有真东西」。
 *
 * 一开始只数字数，结果一张五行的首发名单表（九十几个字）被判成占位——
 * 表格本来就是密的，选手 ID 也短。所以改成看**实质**：
 * 一页只要有表格行、或有自己的可交互元素、或字够多，就算做出来了；
 * 三样一样都没有才是占位（那种「施工中」的页面）。
 */
const THIN_TEXT = 70;
function hasSubstance(r) {
  return r.tableRows > 0 || r.own > 0 || r.chars >= THIN_TEXT;
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 120));
});

if (editKey) {
  await page.addInitScript(([g, k]) => {
    try {
      localStorage.setItem(`wgp_key_${g}`, k);
    } catch {
      /* 沙箱里的 frame 读不到，正常 */
    }
  }, [gameId, editKey]);
}

await page.goto(`${base}/p/${gameId}`, { waitUntil: "networkidle" });
const frame = page.frameLocator("iframe.embed-frame");
const body = frame.locator("body");

/** 等页面自己安静下来（打字机、渲染都可能还在跑） */
async function settle(maxMs = 12000) {
  const started = Date.now();
  let last = "";
  let stableSince = Date.now();
  while (Date.now() - started < maxMs) {
    const now = (await body.innerText().catch(() => "")).trim();
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 900) return last;
    await page.waitForTimeout(250);
  }
  return last;
}

await settle();

// 导航条：运行库给的是 .wgp-nav-item；作者自己写的导航也认一下常见写法
const navSel = ".wgp-nav-item, nav button, [role=tablist] button, .nav button, .tabs button";
const nav = frame.locator(navSel);
const navCount = await nav.count();

if (navCount === 0) {
  const text = await settle();
  console.log("— 界面体检 —");
  console.log(`  ✗ 找不到任何导航——这部作品只有一屏（${text.length} 字符）`);
  console.log("结论：还没有多界面结构。");
  await browser.close();
  process.exit(1);
}

const labels = [];
for (let i = 0; i < navCount; i++) {
  labels.push(((await nav.nth(i).innerText().catch(() => "")) || `第${i + 1}项`).trim().slice(0, 12));
}

const rows = [];
for (let i = 0; i < navCount; i++) {
  errors.length = 0;
  let text = "";
  let clickable = 0;
  let tableRows = 0;
  try {
    await nav.nth(i).click({ timeout: 5000 });
    text = await settle(10000);
    clickable = await frame
      .locator('button, [role=button], a[href], [onclick], tr.clickable, [tabindex="0"]')
      .count()
      .catch(() => 0);
    tableRows = await frame.locator("table tbody tr").count().catch(() => 0);
  } catch (e) {
    errors.push(`点不动：${String(e).slice(0, 80)}`);
  }
  // 导航自己也算可点元素，扣掉才是这一页真正的交互
  const own = Math.max(0, clickable - navCount);
  rows.push({ label: labels[i], chars: text.length, own, tableRows, errs: [...new Set(errors)] });
}

await browser.close();

console.log("— 界面体检 —");
console.log(`  导航有 ${navCount} 个界面：${labels.join(" / ")}\n`);
let thin = 0;
let broken = 0;
for (const r of rows) {
  const flags = [];
  if (r.errs.length) {
    flags.push("报错");
    broken += 1;
  } else if (!hasSubstance(r)) {
    flags.push("占位");
    thin += 1;
  }
  const mark = flags.length ? "✗" : "✓";
  const extra = [
    `${r.chars} 字`,
    `${r.own} 个可点`,
    r.tableRows ? `表格 ${r.tableRows} 行` : null,
    flags.join("/") || null,
  ]
    .filter(Boolean)
    .join(" · ");
  console.log(`  ${mark} ${r.label.padEnd(8)} ${extra}`);
  for (const e of r.errs.slice(0, 2)) console.log(`      ${e}`);
}

const good = rows.length - thin - broken;
console.log(`\n有内容的界面 ${good} / ${rows.length}（占位 ${thin}，报错 ${broken}）`);
console.log(good === rows.length ? "结论：每个界面都有真东西。" : "结论：还有界面是空的或坏的。");
process.exit(good === rows.length ? 0 : 1);
