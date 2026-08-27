// 游戏库现场分诊：把线上**每一部已发布作品**当玩家一样打开一遍，回答两个问题——
//
//   1. 同名的几部里，**哪一部是真能玩的**？（老板实测撞到两部 VAL MANAGER）
//   2. 平台最近做出来的作品**是不是普遍打不开**？
//
// 为什么必须在 Actions 的 runner 上跑：容器出口够不到 railway.app。
// 为什么不能只看接口：作品能不能玩是**运行时**的事——语法全对照样可能一开局就抛异常，
// 只有真拿浏览器打开才看得见。平台注入的兜底横幅（data-wgp-error）就是现成的信号。
//
// 用法：node scripts/live-triage.mjs <baseUrl> [标题关键词]

const pw = await import("playwright").catch(async () => {
  const g = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.js";
  return import(g);
});
const chromium = pw.chromium ?? pw.default?.chromium;

const base = process.argv[2];
const filter = (process.argv[3] ?? "").trim();
if (!base) {
  console.error("用法: node scripts/live-triage.mjs <baseUrl> [标题关键词]");
  process.exit(2);
}

// 线上跑的是哪个版本——「代码改了线上没变」这类事故先看这一行
try {
  const h = await fetch(`${base}/api/health`).then((r) => r.json());
  console.log(`线上版本：commit ${h.build?.commit ?? "（这版还没有 build 段 = 很老的代码）"}  实例 ${h.build?.instance ?? "-"}\n`);
} catch (e) {
  console.log(`取不到 /api/health：${e}\n`);
}

const res = await fetch(`${base}/api/games`);
const all = (await res.json()).games ?? [];
const games = filter ? all.filter((g) => (g.title ?? "").toLowerCase().includes(filter.toLowerCase())) : all;

console.log(`公开库共 ${all.length} 部${filter ? `，匹配「${filter}」的 ${games.length} 部` : ""}\n`);

const CHROME = process.env.CHROME_PATH ?? undefined;
const browser = await chromium.launch(CHROME ? { executablePath: CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] });

const rows = [];
for (const g of games) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text().slice(0, 160));
  });
  let banner = "";
  let textLen = 0;
  let clickable = 0;
  let bytes = 0;
  let snippet = "";
  let clickedLabel = "";
  let afterBanner = "";
  let afterLen = 0;
  let afterSnippet = "";
  try {
    await page.goto(`${base}/p/${g.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    const frame = page.frames().find((f) => f.url().includes(`/play/${g.id}`));
    if (frame) {
      banner = await frame.locator("[data-wgp-error]").first().textContent({ timeout: 2000 }).catch(() => "");
      const t0 = await frame.locator("body").innerText().catch(() => "");
      textLen = t0.trim().length;
      snippet = t0.replace(/\s+/g, " ").trim().slice(0, 300);
      clickable = await frame.locator("button, a, [role=button], [data-screen], .btn").count().catch(() => 0);
      // 「打得开」不等于「玩得动」：真去点一下主按钮，再看有没有炸、页面有没有变。
      // 老板说的「玩不了」十有八九发生在这一步，光看首屏是量不出来的。
      const btn = frame.locator("button:visible, [role=button]:visible, .btn:visible").first();
      if ((await btn.count().catch(() => 0)) > 0) {
        clickedLabel = (await btn.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 30);
        await btn.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(2500);
        afterBanner = await frame.locator("[data-wgp-error]").first().textContent({ timeout: 1500 }).catch(() => "");
        const t1 = await frame.locator("body").innerText().catch(() => "");
        afterLen = t1.trim().length;
        afterSnippet = t1.replace(/\s+/g, " ").trim().slice(0, 300);
      }
    } else {
      // 快速模式没有沙箱 iframe，直接量外层
      textLen = await page.locator("body").innerText().then((t) => t.trim().length).catch(() => 0);
      clickable = await page.locator("button, a").count().catch(() => 0);
    }
    // 代码量：能取到 index.html 就量一下，半成品和完整版一眼分得开
    const idx = await fetch(`${base}/play/${g.id}/index.html`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    bytes = idx.length;
  } catch (e) {
    errs.push(`打开失败: ${String(e).slice(0, 120)}`);
  }
  await page.close();

  const bar = ((banner || afterBanner) ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const broken = Boolean(bar) || errs.length > 0 || textLen < 40;
  rows.push({ ...g, banner: bar, errs, textLen, clickable, bytes, broken, snippet, afterLen, afterSnippet, clickedLabel });

  console.log(`${broken ? "✗ 打不开/报错" : "✓ 打得开"}  ${g.id}  「${g.title}」  mode=${g.mode}  作者=${g.author ?? "-"}  更新=${g.updatedAt ?? "-"}`);
  console.log(`    正文 ${textLen} 字  可点 ${clickable} 处  index.html ${bytes} 字符`);
  console.log(`    首屏：${snippet || "（一个字都没有）"}`);
  if (clickedLabel) {
    console.log(`    点了「${clickedLabel}」之后：正文 ${afterLen} 字`);
    console.log(`    点后：${afterSnippet || "（一个字都没有）"}`);
  }
  if (bar) console.log(`    ⚠ 横幅：${bar}`);
  for (const e of errs.slice(0, 4)) console.log(`    ⚠ 报错：${e}`);
  console.log("");
}

await browser.close();

const bad = rows.filter((r) => r.broken);
console.log("=".repeat(70));
console.log(`小结：${rows.length} 部里 ${rows.length - bad.length} 部能玩，${bad.length} 部打不开或报错`);
if (bad.length) {
  console.log("\n打不开的：");
  for (const r of bad) console.log(`  - ${r.id} 「${r.title}」 ${r.banner || r.errs[0] || "页面几乎是空的"}`);
}
const byTitle = new Map();
for (const r of rows) {
  const k = (r.title ?? "").trim().toLowerCase();
  byTitle.set(k, [...(byTitle.get(k) ?? []), r]);
}
const dupes = [...byTitle.values()].filter((v) => v.length > 1);
if (dupes.length) {
  console.log("\n重名的（老板问的「哪个才是能玩的」）：");
  for (const v of dupes) {
    for (const r of v) {
      console.log(`  ${r.broken ? "✗" : "✓"} ${r.id} 「${r.title}」 index.html ${r.bytes} 字符 正文 ${r.textLen} 字 更新 ${r.updatedAt}`);
    }
  }
}
