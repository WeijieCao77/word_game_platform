// 自由模式作品的冒烟检查：真在浏览器里跑一遍，回答「它到底能不能玩」。
//
// 为什么要有这个：快速模式有三级校验 + 600 局模拟兜底，自由模式一样都用不上——
// 它是作者自己的代码，平台只能像玩家一样去点。所以这里做的就是玩家会做的事：
// 打开、看有没有东西、点几下、刷新看存档、换成手机视口看排不排得下。
//
// 用法：node scripts/smoke-freemode.mjs <baseUrl> <gameId> [editKey]
//   node scripts/smoke-freemode.mjs http://127.0.0.1:3100 abc123 <key>
// 退出码 0 = 过，1 = 有硬伤。

// playwright 不是这个项目的依赖（本地跑验收用的工具，不进 package.json）——
// 先按项目内解析，找不到就退到全局安装的那份。
const pw = await import("playwright").catch(async () => {
  const g = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.js";
  return import(g).catch(() => {
    console.error("找不到 playwright。装一个：npm i -g playwright，或用 PLAYWRIGHT_MODULE 指到它的路径。");
    process.exit(2);
  });
});
// 全局那份是 CommonJS，具名导出挂在 default 上
const chromium = pw.chromium ?? pw.default?.chromium;

const [base, gameId, editKey] = process.argv.slice(2);
if (!base || !gameId) {
  console.error("用法: node scripts/smoke-freemode.mjs <baseUrl> <gameId> [editKey]");
  process.exit(2);
}

const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const problems = [];
const notes = [];

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });

const failedRequests = [];
page.on("response", (r) => {
  if (r.url().includes(`/play/${gameId}`) && r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
});
page.on("pageerror", (e) => problems.push(`页面报错: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`控制台报错: ${m.text().slice(0, 160)}`);
});

if (editKey) {
  await page.addInitScript(([g, k]) => {
    try {
      localStorage.setItem(`wgp_key_${g}`, k);
    } catch {
      /* 沙箱里的 frame 读不到 localStorage，正常 */
    }
  }, [gameId, editKey]);
}

await page.goto(`${base}/p/${gameId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const frame = page.frameLocator("iframe.embed-frame");
const body = frame.locator("body");

// 1. 打得开：页面上得有字
const text = (await body.innerText().catch(() => "")).trim();
if (text.length < 30) problems.push(`打开后几乎没有内容（只有 ${text.length} 个字符）——多半是白屏`);
else notes.push(`开场有 ${text.length} 个字符`);

// 2. 有得点：按钮/链接一类的可交互元素
const clickable = frame.locator("button, [role=button], a[href], .choice, li[onclick]");
const clickCount = await clickable.count();
if (clickCount === 0) problems.push("没有任何可点的东西——玩家进来就卡住了");
else notes.push(`可点元素 ${clickCount} 个`);

// 3. 点得动：点一下，内容要变
let advanced = false;
if (clickCount > 0) {
  const before = text;
  for (let i = 0; i < Math.min(clickCount, 3) && !advanced; i++) {
    try {
      await clickable.nth(i).click({ timeout: 4000 });
      await page.waitForTimeout(1200);
      const after = (await body.innerText().catch(() => "")).trim();
      if (after !== before) advanced = true;
    } catch {
      /* 这个点不动就试下一个 */
    }
  }
  if (!advanced) problems.push("点了几下内容都没变化——玩家推进不下去");
  else notes.push("点击能推进剧情");
}

// 4. 存档能续：刷新之后进度还在（作品用了存档桥才检；没用不算错）
const saved = await page.evaluate((k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}, `wgp_codesave_${gameId}`);
if (saved) {
  const beforeReload = (await body.innerText().catch(() => "")).trim();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const after = (await page.frameLocator("iframe.embed-frame").locator("body").innerText().catch(() => "")).trim();
  if (after === beforeReload) notes.push("刷新后进度接上了");
  else notes.push("刷新后画面变了（可能是从头开始——作者若想续玩要检查存档恢复）");
} else {
  notes.push("这部作品没用存档桥（短篇可以不用）");
}

// 5. 手机上排得下：横向不该出现滚动条
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(800);
const overflow = await body.evaluate((el) => el.scrollWidth - el.clientWidth).catch(() => 0);
if (overflow > 8) problems.push(`手机视口横向溢出 ${overflow}px——手机上会左右乱晃`);
else notes.push("手机视口不横向溢出");

if (failedRequests.length) problems.push(`有取不到的文件：${failedRequests.slice(0, 3).join(" / ")}`);

await browser.close();

console.log("— 冒烟检查 —");
for (const n of notes) console.log(`  ✓ ${n}`);
for (const p of problems) console.log(`  ✗ ${p}`);
console.log(problems.length === 0 ? "结论：能玩。" : `结论：有 ${problems.length} 处硬伤。`);
process.exit(problems.length === 0 ? 0 : 1);
