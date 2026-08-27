// 体检器自己的体检：拿几份**我们自己写的、已知结论**的假作品，看走查报得对不对。
//
// 为什么要有这一层：`tests/playcheck.test.ts` 量的是服务端那一半（收报告、措辞），
// 真正去点的那段（`sweep.ts` 注入浏览器的脚本）没有任何自动检查——
// 它坏了没人知道，而它一坏，平台就是瞎的，AI 拿到的每一条结论都不算数。
// 它连着瞎了四次都没人发现，就是因为没人看着它。
//
// **两头都要量**：
//
//   - 好作品报成坏的（假阳性）→ AI 会去「修」一个根本没坏的东西。这不是纸面上的：
//     线上真有一轮 AI 照着「Americas 点了没反应」把「点已选中的页签」改成强制重绘。
//   - 坏作品报成好的（假阴性）→ 平台是瞎的，验收标准形同虚设。
//
// 所以这里跑两份假作品：一份**一个毛病都没有**，一份**有且只有一个坏导航项**。
// 前者报出任何问题都算走查有毛病；后者必须**不多不少**正好逮到那一项。
//
// 假作品照着线上那部作品的形状搭，专门踩四个坑（都是线上真踩过的）：
//
//   1. **整片重画**：每一屏都是 innerHTML 全量替换（绝大多数自由模式作品都这么写）。
//      走查如果拿着点击前采集的那张候选名单往下试，重画之后那批元素全成了游离节点，
//      剩下的候选会被 document.contains() 一个不落地跳掉——「一步试 10 个」名存实亡。
//   2. **打转的页签**：挑东家那一屏有四个赛区页签，点哪个都换一批战队，
//      每一下正文都真的变了。走查如果把「界面变了」当成「往前走了」，
//      就会在四个页签之间来回点到步数用光，一次都点不到真正的出口（战队卡片）。
//   3. **一进去就停在当前页签**：走查一到挑东家那屏就在 Americas 赛区，
//      点一下「Americas」自然不变——那不是坏按钮，是玩家点了自己已经在的那一页。
//   4. **主界面默认停在第一项**：一进主界面就在总览页，点「总览」当然不变。
//      跟第 3 条同一个毛病，只是换到了导航扫描那一段。线上真报过「总览点不动」。
//
// 用法：node scripts/playcheck-selftest.mjs
// 环境：CHROME_PATH=<chromium 可执行文件>（不给就用 playwright 自带的）

import { readFileSync } from "node:fs";

const pw = await import("playwright").catch(() => null);
if (!pw) {
  console.error("需要 playwright：npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}
const chromium = pw.chromium ?? pw.default?.chromium;
const CHROME = process.env.CHROME_PATH ?? undefined;

/**
 * 把 `sweep.ts` 里那段注入脚本原样抠出来。
 *
 * 故意不另写一份：测的必须是线上真跑的那一份，重写一份等于测了个寂寞。
 */
function loadSweep() {
  const src = readFileSync(new URL("../src/lib/playcheck/sweep.ts", import.meta.url), "utf-8");
  const m = /const SWEEP = `([\s\S]*?)`;\n/.exec(src);
  if (!m) throw new Error("没从 sweep.ts 里找到 SWEEP 那段——文件结构变了？");

  const consts = {};
  for (const [, k, v] of src.matchAll(/^const (BUDGET_MS|MAX_STEPS|MAX_TRY|MAX_NAV|SETTLE_MS) = (\d+);/gm)) {
    consts[k] = v;
  }
  // TS 模板字符串还原成真正注入的那段 JS：先解转义，再把 ${常量} 换成实际值
  return m[1]
    .replace(/\\`/g, "`")
    .replace(/\\\\/g, "\\")
    .replace(/\$\{(\w+)\}/g, (_, k) => {
      if (!(k in consts)) throw new Error("模板里有没预料到的插值 ${" + k + "}");
      return consts[k];
    });
}

const NAV = ["总览", "俱乐部", "阵容", "赛程", "转会", "训练", "财务", "青训", "数据", "荣誉", "设置"];

/**
 * 假作品：起名字 → 挑东家（4 个打转页签，战队卡片才是出口）→ 11 项主导航。
 *
 * `brokenNav` 给一个导航项的名字，那一项就**真的点不动**（onclick 什么都不做）。
 */
function makePage(brokenNav) {
  return `<!doctype html><meta charset="utf-8"><body>
<div id="app"></div>
<script>
window.__pc = null;
window.addEventListener("message", function(e){
  var d = e.data || {};
  if (d.type === "wgp:playcheck") window.__pc = d.data;
});
</script>
<script>
var screen = 1, region = "Americas", picked = null, page = "总览";
var BROKEN = ${JSON.stringify(brokenNav ?? null)};
var REGIONS = ["Americas","EMEA","Pacific","China"];
var TEAMS = {
  Americas:["Sentinels","100 Thieves","NRG"], EMEA:["Fnatic","Team Liquid","Karmine Corp"],
  Pacific:["DRX","Gen.G","T1"], China:["EDG","Bilibili Gaming","WBG Weibo Gaming"]
};
var NAV = ${JSON.stringify(NAV)};
function goPage(n){
  // 坏掉的那一项：点了什么都不做（这就是老板投诉的「这一排里面很多都点不了」）
  if (n === BROKEN) return;
  page = n; render();
}
function render(){
  var h = "";
  if (screen === 1){
    h = "<h1>先把自己捏出来</h1><p>年龄换声望，声望换一份更好的第一份工作，代价是成长变慢。" +
        "先填个名字，再挑一支愿意要你的战队——这一屏的字数要够，免得被当成白屏。</p>" +
        "<label>你的名字</label><input id=nm>" +
        "<button onclick='if(document.getElementById(\\"nm\\").value){screen=2;render()}'>下一步：挑东家</button>";
  } else if (screen === 2){
    h = "<h1>挑一支战队</h1><div class='region-tabs'>" +
      REGIONS.map(function(r){
        return "<button class='tab' onclick='region=\\"" + r + "\\";render()'>" + r + "</button>";
      }).join("") +
      "</div><div class=list>" +
      TEAMS[region].map(function(t){
        return "<div class='card' onclick='picked=\\"" + t + "\\";screen=3;render()'>" + t +
               "<span> · " + region + " 赛区的老牌强队，正在找新教练。</span></div>";
      }).join("") + "</div>";
  } else {
    // 主界面**默认停在第一项**（总览），跟真作品一样
    h = "<nav>" + NAV.map(function(n){
          return "<button class='" + (page === n ? "active" : "") +
                 "' onclick='goPage(\\"" + n + "\\")'>" + n + "</button>";
        }).join("") + "</nav><div id=body>" + page +
        " 这一页的内容，写得足够长，免得被当成空壳页面，这里再多写一些字凑够篇幅。" +
        "教练是 " + picked + "。</div>";
  }
  document.getElementById("app").innerHTML = h;
}
render();
</script></body>`;
}

const SWEEP = loadSweep();

/** 把一份假作品交给走查跑一遍，拿回报告 */
async function run(browser, brokenNav) {
  const page = await browser.newPage({ viewport: { width: 420, height: 820 } });
  page.on("pageerror", (e) => console.log("  [页面报错]", String(e).slice(0, 200)));
  try {
    await page.setContent(makePage(brokenNav) + SWEEP, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("window.__pc", null, { timeout: 40000 }).catch(() => {});
    return await page.evaluate("window.__pc").catch(() => null);
  } finally {
    await page.close().catch(() => {});
  }
}

const deadNavOf = (r) => r.nav.filter((n) => !n.changed && !n.already).map((n) => n.label);
const deadOnPathOf = (r) => r.steps.flatMap((s) => s.dead);

function show(r) {
  console.log(`  走了 ${r.walked} 步 · 走到主界面 = ${r.arrived} · 导航 ${r.nav.length} 项`);
  console.log(
    "  脚印：" + r.steps.map((s) => s.label + (s.dead.length ? `(先点空了 ${s.dead.length} 下)` : "")).join("  ")
  );
  if (r.stuck) console.log(`  卡住：第 ${r.stuck.step} 步（${r.stuck.why}），点过：${r.stuck.tried.join("、")}`);
}

const browser = await chromium.launch(
  CHROME ? { executablePath: CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] }
);
const problems = [];
try {
  // ── 一、好作品：一个毛病都不该报 ──────────────────────────────
  console.log("① 一个毛病都没有的作品");
  const good = await run(browser, null);
  if (!good) {
    problems.push("走查一份报告都没发回来——注入的那段脚本自己坏了");
  } else {
    show(good);
    if (!good.arrived) problems.push("好作品：没走到主界面——十有八九又在开局那几屏打转");
    if (good.stuck) problems.push(`好作品：半路卡住了（第 ${good.stuck.step} 步）`);
    if (good.nav.length !== NAV.length) {
      problems.push(`好作品：导航应该扫到 ${NAV.length} 项，实际 ${good.nav.length} 项`);
    }
    const dn = deadNavOf(good);
    if (dn.length) problems.push(`好作品：这些导航项被冤枉成点不动：${dn.join("、")}`);
    const dp = deadOnPathOf(good);
    if (dp.length) problems.push(`好作品：这些按钮被冤枉成点了没反应：${dp.join("、")}`);
  }

  // ── 二、坏作品：必须不多不少逮到那一项 ────────────────────────
  //
  // 这一半是防「治假阳性治过头」的：把「点了没反应」的判据放宽之后，
  // 真坏的那一项也可能一起被放过去——那平台就从「冤枉好人」变成「放走坏人」，
  // 更糟。所以每次都两头量。
  const BROKEN = "赛程";
  console.log(`\n② 有且只有一个坏导航项（${BROKEN} 点了什么都不做）`);
  const bad = await run(browser, BROKEN);
  if (!bad) {
    problems.push("坏作品：走查一份报告都没发回来");
  } else {
    show(bad);
    const dn = deadNavOf(bad);
    console.log(`  报出来点不动的：${dn.join("、") || "（一个都没报）"}`);
    if (!dn.includes(BROKEN)) {
      problems.push(`坏作品：${BROKEN} 真的点不动，走查却没报出来——放走了坏人`);
    }
    const extra = dn.filter((x) => x !== BROKEN);
    if (extra.length) problems.push(`坏作品：除了 ${BROKEN} 还多报了：${extra.join("、")}`);
  }
} finally {
  await browser.close().catch(() => {});
}

if (problems.length) {
  console.log("\n✗ 体检器自己有问题：");
  for (const p of problems) console.log("   · " + p);
  console.log("\n这两份假作品的结论都是**已知的**。对不上就是走查坏了，不是作品坏了。");
  process.exit(1);
}
console.log("\n✓ 好作品一个毛病没报，坏作品不多不少逮到了那一项。");
