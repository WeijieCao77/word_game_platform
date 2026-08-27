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

// fix-game.mjs 的 boot() 用的就是这一串
const CLICKABLE =
  "button:visible, [role=button]:visible, .btn:visible, a[href]:visible, " +
  "[onclick]:visible, [data-act]:visible, [data-screen]:visible, [tabindex]:visible, " +
  ".card:visible, .option:visible, .choice:visible, li[data-id]:visible";

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

/**
 * 一个**故意跟平台走查不一样**的参照走查器。
 *
 * 它原本是照抄 `fix-game.mjs` 里 `boot()` 那套走法的——那套现在已经删了
 * （平台只留一把「玩不玩得动」的尺子），所以这里留下的是**参照**，不是镜像：
 *
 *   - 每一步**只点 CLICKABLE 的最后一个**，不排序、不挑主按钮
 *   - 点完页面没变就**当场放弃**，不试别的
 *   - 看见任意一个 nav button / .wgp-nav-item / [data-screen] 就算到了导航
 *
 * 留着它是因为它当过一次有用的反证：平台走查报「走 14 步没到主界面」的那三轮，
 * 这套五步就进了 11 项主导航——**平台自己那只眼睛才是瞎的那个**。
 * 一个判据再自洽也可能整体跑偏，手边有个走法完全不同的参照能戳破这一点。
 *
 * 它只用来**对账**，从不参与任何地方的判定：谁对谁错要看脚印里带 ✗ 的那一下。
 */
async function bootWalk() {
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
    // 不带 wgpcheck：平台的走查会自己去点，带上就不是「同一个开局」了
    await page.addInitScript(() => {
      window.addEventListener("message", (e) => {
        if ((e.data || {}).type === "wgp:load") window.postMessage({ type: "wgp:loaded", data: null }, "*");
      });
    });
    await page.goto(`${base}/play/${gameId}/index.html?t=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2600);

    const body = async () => (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, "");
    const hasNav = async () =>
      (await page
        .locator("nav button:visible, .wgp-nav-item:visible, [data-screen]:visible")
        .count()
        .catch(() => 0)) > 0;

    const trail = [];
    let steps = 0;
    let quitAt = null;
    while (steps < 10 && !(await hasNav())) {
      const fields = page.locator("input:visible, textarea:visible");
      const fn = Math.min(await fields.count().catch(() => 0), 4);
      for (let i = 0; i < fn; i++) await fields.nth(i).fill("测试", { timeout: 1500 }).catch(() => {});

      const next = page.locator(CLICKABLE).last();
      if ((await next.count().catch(() => 0)) === 0) {
        quitAt = { step: steps + 1, why: "没得点" };
        break;
      }
      const name = (await next.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 16) || "（无字）";
      const was = await body();
      await next.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const now = await body();
      steps += 1;
      trail.push(`${steps}:${name}${now === was ? "✗" : "✓"}`);
      if (now === was) {
        quitAt = { step: steps, why: `点「${name}」页面没变，当场放弃` };
        break;
      }
    }
    const navN = await page
      .locator("nav button:visible, .wgp-nav-item:visible, [data-screen]:visible")
      .count()
      .catch(() => 0);
    return { steps, quitAt, navN, reachedNav: await hasNav(), trail };
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
    `走${r.walked ?? r.steps.length}步`,
    stuck,
    r.arrived ? "到主界面" : "没到主界面",
    `导航${r.nav.length}项`,
    dead.length ? `点不动[${dead.join(",")}]` : "导航全通",
    onPath.length ? `路上坏[${onPath.join(",")}]` : "路上无坏钮",
  ].join(" · ");
}

console.log(`同一份代码连跑 ${times} 次：${base}/p/${gameId}\n`);

const seen = new Map();
const bootSeen = new Map();
let disagreed = 0;

for (let i = 1; i <= times; i++) {
  const r = await once();
  const fp = fingerprint(r);
  seen.set(fp, (seen.get(fp) ?? 0) + 1);
  console.log(`第 ${i} 次`);
  console.log(`  平台走查：${fp}${r ? `　（${(r.ms / 1000).toFixed(1)} 秒）` : ""}`);

  // 紧接着用 fix-game 的 boot() 那套走法再走一遍**同一部作品**。
  // run 15 里这两边同一分钟给了相反结论，这就是来量那件事的。
  const b = await bootWalk();
  const bfp = b.quitAt
    ? `走${b.steps}步 · 第${b.quitAt.step}步放弃（${b.quitAt.why}）`
    : `走${b.steps}步 · ${b.reachedNav ? `看见导航${b.navN}项` : "走满 10 步也没看见导航"}`;
  bootSeen.set(bfp, (bootSeen.get(bfp) ?? 0) + 1);
  console.log(`  boot 走法：${bfp}`);
  console.log(`  boot 的脚印：${b.trail.join("  ") || "（一步都没走）"}`);

  // 两边「玩不玩得动」的口径对不上，就是 run 15 那一幕
  const sweepOk = !!r && !!r.arrived && !r.stuck;
  const bootOk = !b.quitAt && b.reachedNav;
  if (sweepOk !== bootOk) {
    disagreed += 1;
    console.log(`  ⚠ 两边打架：平台走查说${sweepOk ? "走得通" : "走不通"}，boot 说${bootOk ? "走得通" : "走不通"}`);
  }
}

console.log("");
console.log("── 平台走查（sweep.ts）──");
for (const [fp, n] of [...seen.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${n} 次：${fp}`);
console.log("── boot 走法（fix-game.mjs）──");
for (const [fp, n] of [...bootSeen.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${n} 次：${fp}`);

console.log("");
const stable = seen.size === 1 && bootSeen.size === 1;
if (!stable) {
  console.log(
    `✗ 不可复现：平台走查 ${seen.size} 种结论、boot 走法 ${bootSeen.size} 种。\n` +
      "在这条修好之前，任何「修好没修好」的结论都不算数。"
  );
  process.exit(1);
}
if (disagreed > 0) {
  console.log(
    `✗ 两边各自都稳定，但 ${disagreed}/${times} 次结论相反——**平台有两个判据在打架**。\n` +
      "看上面 boot 的脚印：带 ✗ 的那一下就是它放弃的地方。\n" +
      "boot 每一步只点最后一个可点元素、不变就放弃；平台走查会挑主按钮、一步试 10 个。\n" +
      "谁对谁错要看那个按钮该不该有反应——但两个判据同时存在本身就是个坑。"
  );
  process.exit(1);
}
console.log(`✓ ${times} 次结论完全一致，两个走查器也没打架。`);
process.exit(0);
