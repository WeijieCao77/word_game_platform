// 发布门槛的端到端自测：**真起一个服务、真建一部作品、真去点一遍**，
// 看每一道关拦不拦得住、该放的放不放得过；后三关量的是「发布拆成三件事」拆干净没有。
//
// 为什么光有单元测试不够：`tests/publish-gate.test.ts` 喂的是我自己捏的样例，
// 而这道门槛最先撞上的那个 bug 只有真作品才会露出来——平台自己的空白模板
// index.html 引的是 wgp.css / wgp.js（/play 那一层虚拟出来的运行库），
// 接线体检把它们当成缺失文件，于是门槛一接上去就**把平台自己发的模板拦在了发布之外**。
// 假样例永远测不出这种事。（那一条现在也补进单元测试了，用的是真模板。）
//
// **只对本机跑。** 它会注册账号、建作品、发布——别指向线上。
//
// 用法：
//   DATA_DIR=/tmp/gate PORT=3110 npm start &
//   node scripts/publish-gate-e2e.mjs http://127.0.0.1:3110
// 环境：CHROME_PATH=<chromium 可执行文件>（不给就用 playwright 自带的）
import { readFileSync } from "node:fs";

/**
 * 一份**已知能走通**的假作品，跟 `playcheck-selftest.mjs` 用的是同一份——
 * 从那个脚本里现取，免得两处各写一份、改了一处忘了另一处。
 */
function loadFakeGame() {
  const src = readFileSync(new URL("./playcheck-selftest.mjs", import.meta.url), "utf-8");
  const m = /return `(<!doctype html>[\s\S]*?)`;\n\}/.exec(src);
  if (!m) throw new Error("没从 playcheck-selftest.mjs 里取到那份假作品——文件结构变了？");
  const NAV = ["总览","俱乐部","阵容","赛程","转会","训练","财务","青训","数据","荣誉","设置"];
  return m[1]
    .replace(/\\`/g, "`")
    .replace(/\\\\/g, "\\")
    .replace(/\$\{JSON\.stringify\(brokenNav \?\? null\)\}/g, "null")
    .replace(/\$\{JSON\.stringify\(NAV\)\}/g, JSON.stringify(NAV));
}
const FAKE_GAME = loadFakeGame();
const pw = await import("playwright").catch(() => null);
if (!pw) {
  console.error("需要 playwright：npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}
const chromium = pw.chromium ?? pw.default?.chromium;

const B = process.argv[2] ?? "http://127.0.0.1:3110";
const CHROME = process.env.CHROME_PATH ?? undefined;

// 保险丝：这个脚本会注册账号、建作品、发布，指向线上就是在往生产库里灌垃圾
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(B)) {
  console.error(`拒绝对 ${B} 跑：这个脚本只对本机跑，它会真的注册账号、建作品、发布。`);
  process.exit(2);
}

// 账号名带上时间戳：同一个 DATA_DIR 上重复跑不会撞车
const stamp = String(Date.now()).slice(-8);

const reg = await fetch(`${B}/api/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: `gate-${stamp}`, password: `gate-${stamp}-pw` }),
});
const cookie = (reg.headers.get("set-cookie") || "").split(";")[0];
const H = { "content-type": "application/json", cookie };

const g = await (
  await fetch(`${B}/api/games`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ title: "发布门槛自测", author: "平台自测", template: "blank-code" }),
  })
).json();
console.log("作品:", g.id);

const write = async (path, content) =>
  (await fetch(`${B}/api/games/${g.id}/files`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ path, content }),
  })).status;

const del = async (path) =>
  (await fetch(`${B}/api/games/${g.id}/files?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
    headers: { cookie },
  })).status;

/** 发布接口现在收三件事；不给参数就是老写法 { published: true } = 三件一起做 */
const publish = async (what = { published: true }) => {
  const r = await fetch(`${B}/api/games/${g.id}/publish`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(what),
  });
  const b = await r.json().catch(() => ({}));
  return {
    status: r.status,
    error: b.error,
    issues: b.issues ?? [],
    version: b.version,
    published: b.published,
    listed: b.listed,
  };
};

/** 拿一个匿名浏览器（没有 cookie）去够玩家页，看链接通不通 */
const linkWorksAnonymously = async () => {
  const r = await fetch(`${B}/play/${g.id}/index.html`);
  return r.status === 200;
};

/** 这部作品在公开库里列出来了没有 */
const inLibrary = async () => {
  const b = await (await fetch(`${B}/api/games`)).json().catch(() => ({}));
  return (b.games ?? []).some((x) => x.id === g.id);
};

/** 跑一次平台自己的试玩体检，并把报告交回服务端 */
const runCheck = async () => {
  const browser = await chromium.launch(
      CHROME ? { executablePath: CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] }
    );
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 820 } });
    const eq = cookie.indexOf("=");
    await ctx.addCookies([{ name: cookie.slice(0, eq), value: cookie.slice(eq + 1), url: B }]);
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__pc = null;
      window.addEventListener("message", (e) => {
        const d = e.data || {};
        if (d.type === "wgp:playcheck") window.__pc = d.data;
        if (d.type === "wgp:load") window.postMessage({ type: "wgp:loaded", data: null }, "*");
      });
    });
    await page.goto(`${B}/play/${g.id}/index.html?wgpcheck=1&t=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction("window.__pc", null, { timeout: 40000 }).catch(() => {});
    const report = await page.evaluate("window.__pc").catch(() => null);
    if (!report) return "（体检没跑出结果）";
    const r = await fetch(`${B}/api/games/${g.id}/playcheck`, {
      method: "POST",
      headers: H,
      body: JSON.stringify(report),
    });
    return (await r.json()).summary;
  } finally {
    await browser.close().catch(() => {});
  }
};

const line = (t) => console.log(`\n──── ${t} ────`);
const fails = [];
const expectBlocked = (label, res, needle) => {
  const ok = res.status === 400 && String(res.error).includes(needle);
  console.log(`${ok ? "✓" : "✗"} ${label} → HTTP ${res.status}`);
  console.log(`   ${String(res.error ?? "(无 error)").split("\n").slice(0, 3).join(" / ")}`);
  if (!ok) fails.push(`${label}：本该被拦住并提到「${needle}」`);
};

// ① 刚建的作品：模板自带 index.html + game.js，但从没体检过
line("① 从没体检过");
expectBlocked("发布", await publish(), "还没做过试玩体检");

// ② 调了一个谁都没定义的名字（那部死掉的 val manager 就是这么上线的）
line("② 调了没定义的名字");
await write("game.js", "registerSetup({ id: 1 });\n");
expectBlocked("发布", await publish(), "registerSetup");

// ③ 语法错
line("③ 语法错");
await write("game.js", "function start(){ \n");
expectBlocked("发布", await publish(), "");

// ④ 换成一份真能玩的，但还没体检
line("④ 能玩，但还没体检");
await del("game.js");
await write("index.html", FAKE_GAME);
expectBlocked("发布", await publish(), "还没做过试玩体检");

// ⑤ 体检通过之后再发
line("⑤ 体检过了再发");
console.log("   体检结论：", await runCheck());
const okRes = await publish();
console.log(`${okRes.status === 200 ? "✓" : "✗"} 发布 → HTTP ${okRes.status}　第 ${okRes.version} 版`);
if (okRes.status !== 200) {
  fails.push("体检过了却发不出去");
  console.log("   ", String(okRes.error).split("\n").slice(0, 4).join(" / "));
}

// ⑥ 改完文件不重新体检就发 —— 那是拿上一版的结论给这一版背书
line("⑥ 改完文件不重新体检");
await write("index.html", FAKE_GAME + "\n<!-- 又改了一下 -->");
expectBlocked("发布", await publish(), "改文件之前");

// ⑦ 重新体检之后又能发了
line("⑦ 重新体检");
console.log("   体检结论：", await runCheck());
const again = await publish();
console.log(`${again.status === 200 ? "✓" : "✗"} 发布 → HTTP ${again.status}　第 ${again.version} 版`);
if (again.status !== 200) fails.push("重新体检之后还是发不出去");

// ⑧⑨⑩ 三件事拆开了没有
line("⑧ 老写法 { published:true } 照旧三件一起做");
console.log(`   链接可达=${again.published} 挂公开库=${again.listed}`);
if (!again.published || !again.listed) fails.push("老写法应该三件一起做");
if (!(await linkWorksAnonymously())) fails.push("链接开着，匿名却打不开");
if (!(await inLibrary())) fails.push("挂着牌，公开库里却没有");

line("⑨ 从公开库撤下 —— 链接必须还活着（这条就是拆分的理由）");
const down = await publish({ listed: false });
console.log(`   撤下后：链接可达=${down.published} 挂公开库=${down.listed}`);
const aliveAfterTakedown = await linkWorksAnonymously();
console.log(`   ${aliveAfterTakedown ? "✓" : "✗"} 匿名还打得开链接`);
if (!aliveAfterTakedown) fails.push("从公开库撤下之后链接死了——作者和测试者会一起被挡在门外");
if (await inLibrary()) fails.push("已经撤下了，公开库里还列着");

line("⑩ 已发布的作品，接着发新版本（不用先取消发布）");
await write("index.html", FAKE_GAME + "\n<!-- 第三版 -->");
console.log("   体检结论：", await runCheck());
const v3 = await publish({ publishVersion: true });
console.log(`${v3.status === 200 ? "✓" : "✗"} 发新版本 → HTTP ${v3.status}　第 ${v3.version} 版`);
if (v3.status !== 200) {
  fails.push("已发布的作品发不了新版本");
  console.log("   ", String(v3.error).split("\n").slice(0, 3).join(" / "));
}
if (!(await linkWorksAnonymously())) fails.push("发新版本把链接弄没了");

console.log("");
if (fails.length) {
  console.log("✗ 有对不上的：");
  for (const f of fails) console.log("   · " + f);
  process.exit(1);
}
console.log("✓ 十道关全部如预期");
