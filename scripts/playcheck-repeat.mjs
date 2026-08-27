// 同一份代码连跑 N 次试玩体检，看结论稳不稳。
//
// 起因是一次真事故：run 13 里，**中间一个游戏文件都没改**，两次检查却给了相反的结论——
// 第 1 轮后报「开局第 4 步点下去页面一个字都没变，走不下去了」，
// 第 2 轮后报「开局走了 4 步，进到有导航的界面，导航 11 项里 1 项坏」。
// 我据此判了「上一轮把第 4 步改坏了」，还把这个错误结论喂给了 AI 去修。
//
// **不可复现的检查器比没有检查器更坏**：它不但自己不算数，还会把人和 AI 一起带偏。
// 所以在信任任何「修好没修好」的结论之前，先量这一条：同一份代码连跑 N 次，
// 结论一致吗？不一致的话，差在哪一步。
//
// 怀疑点（跑之前先写下来，免得看到结果再编理由）：
//   1. 作品要装 3 张 CSV 数据表，点「选东家」时列表可能还没填好 → 点了等于没点
//   2. 点完固定等 350 毫秒就判「界面变没变」，重的渲染赶不上
//
// 用法：node scripts/playcheck-repeat.mjs <baseUrl> <gameId> [次数]
// 环境：COOKIE=<会话 cookie>（作品要归这个账号所有）

const pw = await import("playwright").catch(async () => {
  console.error("需要 playwright：npm i -D playwright && npx playwright install chromium");
  process.exit(2);
});
const chromium = pw.chromium ?? pw.default?.chromium;

const base = process.argv[2];
const gameId = process.argv[3];
const times = Math.max(2, Number(process.argv[4] || 5));
const COOKIE = process.env.COOKIE ?? "";
const CHROME = process.env.CHROME_PATH ?? undefined;

if (!base || !gameId) {
  console.error("用法: node scripts/playcheck-repeat.mjs <baseUrl> <gameId> [次数]");
  process.exit(2);
}

/**
 * 跑一次平台自己的试玩体检。
 *
 * 这里只当浏览器司机——真正去点的那段代码是平台在出口注入的（src/lib/playcheck/sweep.ts）。
 * 顶层打开时 parent === self，体检脚本 postMessage 给 parent 就落在这一页上。
 */
async function once() {
  const browser = await chromium.launch(
    CHROME ? { executablePath: CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] }
  );
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 820 } });
    const eq = COOKIE.indexOf("=");
    if (eq > 0) {
      await ctx.addCookies([{ name: COOKIE.slice(0, eq), value: COOKIE.slice(eq + 1), url: base }]);
    }
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__pc = null;
      window.addEventListener("message", (e) => {
        const d = e.data || {};
        if (d.type === "wgp:playcheck") window.__pc = d.data;
        // 体检要从开局走，存档一律回空
        if (d.type === "wgp:load") window.postMessage({ type: "wgp:loaded", data: null }, "*");
      });
    });
    await page.goto(`${base}/play/${gameId}/index.html?wgpcheck=1&t=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction("window.__pc", null, { timeout: 45000 }).catch(() => {});
    return await page.evaluate("window.__pc").catch(() => null);
  } finally {
    await browser.close().catch(() => {});
  }
}

/** 把一份报告压成一行「指纹」：指纹一样 = 这一次和上一次结论相同 */
function fingerprint(r) {
  if (!r) return "（没跑出结果）";
  const stuck = r.stuck ? `卡第${r.stuck.step}步(${r.stuck.why})` : "没卡住";
  const dead = r.nav.filter((n) => !n.changed && !n.already).map((n) => n.label);
  const onPath = r.steps.flatMap((s) => s.dead);
  return [
    `走${r.steps.length}步`,
    stuck,
    `导航${r.nav.length}项`,
    dead.length ? `点不动[${dead.join(",")}]` : "导航全通",
    onPath.length ? `路上坏[${onPath.join(",")}]` : "路上无坏钮",
  ].join(" · ");
}

console.log(`同一份代码连跑 ${times} 次：${base}/p/${gameId}\n`);

const seen = new Map();
for (let i = 1; i <= times; i++) {
  const r = await once();
  const fp = fingerprint(r);
  seen.set(fp, (seen.get(fp) ?? 0) + 1);
  console.log(`第 ${i} 次：${fp}${r ? `　（${(r.ms / 1000).toFixed(1)} 秒）` : ""}`);
}

console.log("");
if (seen.size === 1) {
  console.log(`✓ ${times} 次结论完全一致——这个检查器在这部作品上是可复现的。`);
  process.exit(0);
}
console.log(`✗ ${times} 次出现了 ${seen.size} 种不同结论，这个检查器不可复现：`);
for (const [fp, n] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${n} 次：${fp}`);
}
console.log("\n在这条修好之前，任何「修好没修好」的结论都不算数。");
process.exit(1);
