/**
 * 逐项走查自己的体检。
 *
 * 为什么非要有这一层：**这个走查器第一版就是坏的，而且是我刚写完就坏。**
 * 它在天赋加点那一屏（17 个 ± 按钮）停下来当成主界面，报了一堆假的「坏页签」，
 * 真正的 11 项导航一眼都没看到——跟 PITFALLS 17.8 一模一样的错，我又犯了一次。
 * 走查器坏了没人知道，而它一坏，拿它得出的每一条结论都不算数。
 *
 * 所以拿一份**我们自己写的、已知答案**的假作品量它。假作品照着线上那两部
 * VAL MANAGER 的真实形状搭，四屏专门踩四个坑：
 *
 *   1. 第一屏要**填名字**才走得动（不填只回一句「先给自己起个名字」）
 *      —— 只会点不会填的走查会在这儿判「卡死」，那是假阳性。
 *   2. 第二屏是**天赋加点**：8 组 ± 共 16 个按钮 + 一个「确定」。
 *      按 DOM 顺序点就在 ± 上来回打转，永远点不到「确定」。
 *      这一屏必须走过去，不许当成主界面。
 *   3. 第三屏是**确认页**：摆着一整条 15 项导航条，可**一项都不响应**，
 *      只有底下的「开始执教」能进。走查必须①走过去②把那 14 项如实报出来。
 *   4. 第四屏才是**真主界面**：导航项点了都换内容。这一屏不许报坏。
 *
 * 用法：node scripts/play-through-selftest.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const GAME = `<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width, initial-scale=1">
<body><div id=app></div><script>
var name_ = "", started = false;
var NAV = ["总览","阵容","战术","训练","经营","转会","商务","财务","赛事","赛程","积分榜","生涯","经理","系统","存档"];
function el(h){ document.getElementById("app").innerHTML = h; }
function s1(msg){
  el("<h2>先把自己捏出来 第 1 步 / 4</h2><label>你的名字</label>"
    + "<input id=nm value='" + name_ + "'>"
    + "<p>" + (msg || "年龄是唯一的取舍：岁数换声望。") + "</p>"
    + "<button onclick='go1()'>下一步：出身</button>");
}
function go1(){
  name_ = (document.getElementById("nm")||{}).value || "";
  if (!name_.trim()) return s1("先给自己起个名字");
  s2();
}
var pts = [50,50,50,50,50,50,50,50];
function s2(){
  var h = "<h2>第 3 步 / 4：天赋加点</h2><p>八项能力，8 点，每点 +5。</p>";
  for (var i=0;i<8;i++)
    h += "<button onclick='bump(" + i + ",-5)'>&minus;</button> 能力" + i + " " + pts[i]
       + " <button onclick='bump(" + i + ",5)'>+</button><br>";
  h += "<button onclick='s3()'>确定，挑东家</button>";
  el(h);
}
// ± 必须真的会动。它们要是死的，这一屏就只测到「该报的报没报」，
// 测不到**「不该报的有没有被冤枉」**——而平台栽的跟头里，假阳性那一半更贵：
// 线上真有一轮 AI 照着一条假的「点了没反应」去改一个根本没坏的东西。
function bump(i, d){ pts[i] = Math.max(35, Math.min(95, pts[i] + d)); s2(); }
function s3(){
  // 确认页：整条导航条摆在那儿，可一项都不响应——线上那部 dlezoceb 就是这样
  var h = "<div>";
  for (var i=0;i<NAV.length;i++) h += "<button>" + NAV[i] + "</button> ";
  h += "</div><h2>G2 Esports</h2><p>预算 3,964,616　周薪支出 2,211,000。首发阵容五人。</p>"
    + "<button onclick='s4()'>开始执教</button>";
  el(h);
}
function s4(){
  started = true;
  var h = "<div>";
  for (var i=0;i<NAV.length;i++) h += "<button onclick='tab(" + i + ")'>" + NAV[i] + "</button> ";
  el(h + "</div><div id=pane>总览：第 0 天，赛段 季前准备。</div>");
}
function tab(i){ document.getElementById("pane").innerHTML = NAV[i] + "：这一页有 " + (i*37+120) + " 条内容。"; }
window.addEventListener("load", function(){ s1(); });
</script>`;

const SHELL = (id) =>
  `<!doctype html><meta charset=utf-8><body style="margin:0">` +
  `<iframe src="/play/${id}/index.html" style="width:100%;height:100vh;border:0"></iframe>`;

const server = createServer((req, res) => {
  const url = req.url || "/";
  if (url.startsWith("/play/")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(GAME);
  }
  if (url.startsWith("/p/")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(SHELL(url.slice(3).split("/")[0]));
  }
  res.writeHead(404).end("no");
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
console.log(`假作品跑在 ${base}\n`);

const out = await new Promise((resolve) => {
  const p = spawn(process.execPath, ["scripts/play-through.mjs", base, "fake", "20"], {
    env: { ...process.env },
  });
  let buf = "";
  p.stdout.on("data", (d) => { buf += d; process.stdout.write(d); });
  p.stderr.on("data", (d) => process.stderr.write(d));
  p.on("close", () => resolve(buf));
});
server.close();

// ── 判卷 ─────────────────────────────────────────────────────
const fail = [];
// ① 填了名字才走得动：不能在第一屏判卡死
if (/第 1 屏[\s\S]*?卡死/.test(out)) fail.push("第一屏被判成卡死了——它只是要先填名字");
// ② 天赋加点那一屏必须走过去，不许停在那儿当主界面
if (!/确定，挑东家/.test(out)) fail.push("没点到「确定，挑东家」——又在 ± 上打转了");
// ③ 确认页那 14 项死导航必须如实报出来
const reportedDead = /点了没反应：[^\n]*总览[^\n]*阵容[^\n]*战术/.test(out);
if (!reportedDead) fail.push("确认页那一整条不响应的导航没报出来（该报的没报＝平台是瞎的）");
// ④ 真主界面不许报坏：s4 之后每一项都换内容
if (!/开始执教/.test(out)) fail.push("没走到真正的主界面（开始执教那一步没迈过去）");
// ⑤ **不许冤枉好按钮**：天赋加点那一屏 17 个全是活的，一个都不该被报成坏的。
//    假阳性比漏报更贵——AI 会拿着一条假线索去改一个根本没坏的东西，一轮几十万 token。
const talent = out.split("第 2 屏（")[1] || "";
const talentBlock = talent.split("第 3 屏（")[0];
if (/✗ 点了没反应/.test(talentBlock)) {
  fail.push("天赋加点那一屏的 ± 全是活的，却被报成坏按钮了（假阳性）");
}

console.log("\n──────────── 判卷 ────────────");
if (fail.length) {
  for (const f of fail) console.log(`✗ ${f}`);
  process.exit(1);
}
console.log("✓ 名字要填的第一屏没被冤枉；± 那一屏走过去了；");
console.log("✓ 确认页那 14 项死导航如实报出来了；真主界面走到了。");
