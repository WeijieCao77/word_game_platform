// 体检器自己的体检：拿一份**我们自己写的、已知能走通**的假作品，看走查走不走得到主界面。
//
// 为什么要有这一层：`tests/playcheck.test.ts` 量的是服务端那一半（收报告、措辞），
// 真正去点的那段（`sweep.ts` 注入浏览器的脚本）没有任何自动检查——
// 它坏了没人知道，而它一坏，平台就是瞎的，AI 拿到的每一条结论都不算数。
//
// 这个假作品照着线上那部作品的形状搭，专门踩两个坑：
//
//   1. **整片重画**：每一屏都是 innerHTML 全量替换（绝大多数自由模式作品都这么写）。
//      走查如果拿着点击前采集的那张候选名单往下试，重画之后那批元素全成了游离节点，
//      剩下的候选会被 document.contains() 一个不落地跳掉——「一步试 10 个」名存实亡。
//   2. **打转的页签**：挑东家那一屏有四个赛区页签，点哪个都换一批战队，
//      每一下正文都真的变了。走查如果把「界面变了」当成「往前走了」，
//      就会在四个页签之间来回点到步数用光，一次都点不到真正的出口（战队卡片）。
//
// 这两个坑都是线上真踩过的：对账那一轮，平台走查 3/3 次走满 14 步没走到主界面，
// 而另一个走查器 5 步就进了 11 项主导航。
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

/** 假作品：起名字 → 挑东家（4 个打转页签 + 战队卡片才是出口）→ 11 项主导航 */
const PAGE = `<!doctype html><meta charset="utf-8"><body>
<div id="app"></div>
<script>
window.__pc = null;
window.addEventListener("message", function(e){
  var d = e.data || {};
  if (d.type === "wgp:playcheck") window.__pc = d.data;
});
</script>
<script>
var screen = 1, region = "Americas", picked = null;
var REGIONS = ["Americas","EMEA","Pacific","China"];
var TEAMS = {
  Americas:["Sentinels","100 Thieves","NRG"], EMEA:["Fnatic","Team Liquid","Karmine Corp"],
  Pacific:["DRX","Gen.G","T1"], China:["EDG","Bilibili Gaming","WBG Weibo Gaming"]
};
var NAV = ${JSON.stringify(NAV)};
function render(){
  var h = "";
  if (screen === 1){
    h = "<h1>先把自己捏出来</h1><label>你的名字</label><input id=nm>" +
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
    h = "<nav>" + NAV.map(function(n){
          return "<button onclick='document.getElementById(\\"body\\").textContent=\\"" + n +
                 " 这一页的内容，写得足够长，免得被当成空壳页面，这里再多写一些字凑够篇幅。\\"'>" + n + "</button>";
        }).join("") + "</nav><div id=body>欢迎来到 " + picked + "。这是主界面，能看到这句话就说明开局这条路走通了。</div>";
  }
  document.getElementById("app").innerHTML = h;
}
render();
</script></body>`;

const browser = await chromium.launch(
  CHROME ? { executablePath: CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] }
);
let report = null;
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 820 } });
  page.on("pageerror", (e) => console.log("  [页面报错]", String(e).slice(0, 200)));
  await page.setContent(PAGE + loadSweep(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__pc", null, { timeout: 40000 }).catch(() => {});
  report = await page.evaluate("window.__pc").catch(() => null);
} finally {
  await browser.close().catch(() => {});
}

if (!report) {
  console.log("✗ 走查一份报告都没发回来——注入的那段脚本自己坏了。");
  process.exit(1);
}

console.log(`走了 ${report.walked} 步 · 走到主界面 = ${report.arrived} · 导航 ${report.nav.length} 项`);
console.log("脚印：" + report.steps.map((s) => s.label + (s.dead.length ? `(先点空了 ${s.dead.length} 下)` : "")).join("  "));
if (report.stuck) console.log(`卡住：第 ${report.stuck.step} 步（${report.stuck.why}），点过：${report.stuck.tried.join("、")}`);

const problems = [];
if (!report.arrived) problems.push("没走到主界面——十有八九又在开局那几屏打转");
if (report.stuck) problems.push(`半路卡住了（第 ${report.stuck.step} 步）`);
if (report.nav.length !== NAV.length) problems.push(`导航应该扫到 ${NAV.length} 项，实际 ${report.nav.length} 项`);
const deadNav = report.nav.filter((n) => !n.changed && !n.already).map((n) => n.label);
if (deadNav.length) problems.push(`这些导航项被冤枉成点不动：${deadNav.join("、")}`);

if (problems.length) {
  console.log("\n✗ 体检器自己有问题：");
  for (const p of problems) console.log("   · " + p);
  console.log("\n这份假作品是**已知能走通**的。走不通就是走查坏了，不是作品坏了。");
  process.exit(1);
}
console.log("\n✓ 走查穿过了打转的页签，走到主界面，把 11 项导航都点了一遍。");
