// 让**平台的 AI**去修一部打不开的作品——不是我去改它的代码。
//
// 老板的铁律：游戏的每一行代码都必须是线上 AI 写进去的。所以一部作品死在线上时，
// 正确的处置不是我手工补一行，而是**把它交回平台的那条通路**：
//   真浏览器打开 → 抓到报错（顺带落进 game_errors）→ 让 AI 修 → 发布 → 再打开看好没好。
// 修不好就再来一轮，最多 max_rounds 轮。
//
// 这同时是今晚那套修复的实战检验：报错现在会自动贴进 AI 每一轮的【运行报错】，
// 它不该再需要谁来提醒。所以这里发给 AI 的话故意写得很短——
// 要是它自己看不见报错，那说明那套东西没起作用。
//
// 用法：node scripts/fix-game.mjs <baseUrl> <gameId> [最多几轮]
// 环境：COOKIE=<会话 cookie>（作品要归这个账号所有）

const pw = await import("playwright").catch(async () => {
  const g = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.js";
  return import(g);
});
const chromium = pw.chromium ?? pw.default?.chromium;

const base = process.argv[2];
const gameId = process.argv[3];
const maxRounds = Math.max(1, Number(process.argv[4] || 3));
const COOKIE = process.env.COOKIE ?? "";
if (!base || !gameId) {
  console.error("用法: node scripts/fix-game.mjs <baseUrl> <gameId> [最多几轮]");
  process.exit(2);
}
const H = { "content-type": "application/json", cookie: COOKIE };
const CHROME = process.env.CHROME_PATH ?? undefined;

/** 像玩家一样打开一遍，回来报「能不能玩 + 报了什么」 */
async function boot(label) {
  const browser = await chromium.launch(
    CHROME ? { executablePath: CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] }
  );
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text().slice(0, 200));
  });
  let banner = "";
  let text = "";
  let clickable = 0;
  try {
    await page.goto(`${base}/p/${gameId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    // 等久一点：兜底脚本要把报错重发几次给外壳，外壳再送回服务端
    await page.waitForTimeout(9000);
    const frame = page.frames().find((f) => f.url().includes(`/play/${gameId}`));
    if (frame) {
      banner = (await frame.locator("[data-wgp-error]").first().textContent({ timeout: 2000 }).catch(() => "")) ?? "";
      text = (await frame.locator("body").innerText().catch(() => "")).trim();
      clickable = await frame.locator("button, a, [role=button], .btn").count().catch(() => 0);
    }
  } catch (e) {
    errs.push(`打开失败: ${String(e).slice(0, 160)}`);
  }
  await browser.close();
  const bar = banner.replace(/\s+/g, " ").trim();
  const broken = Boolean(bar) || errs.length > 0 || text.length < 80;
  console.log(`\n【${label}】${broken ? "✗ 还是打不开" : "✓ 打得开"}　正文 ${text.length} 字　可点 ${clickable} 处`);
  if (bar) console.log(`  横幅：${bar}`);
  for (const e of [...new Set(errs)].slice(0, 4)) console.log(`  报错：${e}`);
  if (!broken) console.log(`  首屏：${text.replace(/\s+/g, " ").slice(0, 200)}`);
  return { broken, bar, errs: [...new Set(errs)], text };
}

/** 跑一轮 AI（走异步任务那条路，跟作者在工作台里走的是同一条） */
async function ask(message) {
  const r = await fetch(`${base}/api/games/${gameId}/assistant`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ messages: [{ role: "user", content: message }], async: true, rounds: 1 }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`assistant ${r.status}：${JSON.stringify(body).slice(0, 300)}`);
  const job = body.jobId;
  if (!job) return body;
  const deadline = Date.now() + 20 * 60 * 1000;
  let note = "";
  while (Date.now() < deadline) {
    await new Promise((s) => setTimeout(s, 5000));
    const jr = await fetch(`${base}/api/games/${gameId}/assistant?job=${job}`, { headers: { cookie: COOKIE } })
      .then((x) => x.json())
      .catch(() => null);
    const j = jr?.job;
    if (!j) continue;
    if (j.note && j.note !== note) {
      note = j.note;
      console.log(`  · ${note}`);
    }
    if (j.status === "done") return jr;
    if (j.status === "error") throw new Error(j.error || "这一轮失败了");
  }
  throw new Error("等了 20 分钟还没跑完");
}

async function publish() {
  const r = await fetch(`${base}/api/games/${gameId}/publish`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ published: true, note: "修好开局崩溃" }),
  });
  const b = await r.json();
  console.log(`  发布：${r.ok ? `第 ${b.version} 版已上线` : JSON.stringify(b).slice(0, 200)}`);
}

// ── 开工 ───────────────────────────────────────────────────────────
let state = await boot("修之前");
if (!state.broken) {
  console.log("\n这部作品本来就打得开，不用修。");
  process.exit(0);
}

for (let round = 1; round <= maxRounds; round++) {
  console.log(`\n──────── 第 ${round}/${maxRounds} 轮：交给 AI ────────`);
  // 故意只说一句话。报错应该已经自动摆在它的【运行报错】里了——
  // 要是还得我把报错抄给它，说明那条链路没通。
  const res = await ask(
    "玩家打开这部作品是打不开的。看一眼【运行报错】，把它修好；" +
      "修完把开局那条路径从头走一遍确认不会再抛，再用 read_errors 带 clear: true 清掉记录。"
  );
  const reply = String(res?.job?.result?.reply ?? res?.reply ?? "").replace(/\s+/g, " ");
  console.log(`  AI：${reply.slice(0, 400)}`);
  await publish();
  state = await boot(`第 ${round} 轮之后`);
  if (!state.broken) {
    console.log(`\n✓ 修好了（用了 ${round} 轮）。`);
    process.exit(0);
  }
}

console.log("\n✗ 跑满了还是没修好。上面每一轮的报错原文就是线索。");
process.exit(1);
