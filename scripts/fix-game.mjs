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

/**
 * 什么算「能点的东西」。
 *
 * 这一条也是踩出来的：上一版只认 button / [role=button] / .btn，
 * 于是作品用 <div class="card" onclick=…> 做的「出身三张卡」在体检眼里
 * 等于不存在，报的是「这一屏一个能点的都没有」——**冤枉了作品**。
 * 今晚已经因为判据太浅漏掉三条投诉，不能再反过来错杀。
 * 所以放宽到：语义按钮 + 带 onclick/data-act/data-screen 的元素 + 常见卡片类名 +
 * 可聚焦元素（tabindex）。宁可多点几下，也不许把「有得点」说成「没得点」。
 */
const CLICKABLE =
  "button:visible, [role=button]:visible, .btn:visible, a[href]:visible, " +
  "[onclick]:visible, [data-act]:visible, [data-screen]:visible, [tabindex]:visible, " +
  ".card:visible, .option:visible, .choice:visible, li[data-id]:visible";

/**
 * 打开作品，只回答一件事：**打不打得开**。
 *
 * 查的是「玩之前就露馅」的那几样：白屏、报错横幅、JS 异常、没发布被 403 挡在外面、
 * 以及「有标签没控件」——`<label>你的名字</label>` 却没有对应的输入框。
 * 最后这条是老板撞见的那个坑：页面渲染得好好的、一个 JS 错误都没有，
 * 可名字没地方填，点「下一步」弹一句提示然后原地不动。
 *
 * **玩不玩得动不在这里判**，那是 `platformCheck()` 的活（理由见函数体里那段注释）。
 *
 * `asPlayer=false`（默认）**带着会话 cookie**——回炉验的是草稿，也就是 AI 刚改完的那一版。
 * 这一条是被自己的错逼出来的：上一版 boot() 开的是一个**没有 cookie 的匿名浏览器**，
 * 而那部作品当时已经从公开库撤下（published=false），于是 /play 一律回 403，
 * 首屏只有「not published」13 个字。脚本据此判「✗ 玩不了」，三轮全废——
 * 而平台自己的试玩体检（带 cookie，看草稿）第 1 轮之后就报了「试玩通过」。
 * 我还在 PR 里写了「boot() 带着会话 cookie」，那句话是错的，现在把它做成真的。
 *
 * `asPlayer=true` 才开匿名浏览器——那是最后发布完确认玩家侧真的能玩，用途完全不同。
 */
async function boot(label, asPlayer = false) {
  const browser = await chromium.launch(
    CHROME ? { executablePath: CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] }
  );
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const eq = COOKIE.indexOf("=");
  if (!asPlayer && eq > 0) {
    await ctx.addCookies([{ name: COOKIE.slice(0, eq), value: COOKIE.slice(eq + 1), url: base }]);
  }
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text().slice(0, 200));
  });
  let banner = "";
  let text = "";
  let clickable = 0;
  const flaws = [];
  try {
    await page.goto(`${base}/p/${gameId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    // 等久一点：兜底脚本要把报错重发几次给外壳，外壳再送回服务端
    await page.waitForTimeout(9000);
    const frame = page.frames().find((f) => f.url().includes(`/play/${gameId}`));
    if (frame) {
      banner = (await frame.locator("[data-wgp-error]").first().textContent({ timeout: 2000 }).catch(() => "")) ?? "";
      text = (await frame.locator("body").innerText().catch(() => "")).trim();
      clickable = await frame.locator(CLICKABLE).count().catch(() => 0);

      // 有标签没控件：`<label>你的名字</label>` 却没有对应的 input/select/textarea
      const labels = await frame.locator("label").count().catch(() => 0);
      const fields = await frame
        .locator("input:visible, select:visible, textarea:visible, [contenteditable=true]:visible")
        .count()
        .catch(() => 0);
      if (labels > fields) {
        flaws.push(`页面上有 ${labels} 个标签却只有 ${fields} 个能填的控件——有字段渲染不出来（玩家看得到「填什么」，却没地方填）`);
      }

      // 走开局、点导航这些**不在这里做**了——那是平台自己的试玩体检的活。
      //
      // 原来这里手搓了一套走查：每一步只点 CLICKABLE 的最后一个，点了页面不变就
      // 当场放弃。于是平台有了**两个**「玩不玩得动」的判据，而且给过相反的结论：
      // 对账那一轮 3 次里 2 次这套说「走 5 步看见导航 11 项」，平台走查说「走 14 步
      // 没到主界面」；另外 1 次这套自己说「第 5 步走不下去」。
      //
      // 两个判据打架的时候，实测的退出码只认这一套——**等于在拿一把平台自己都
      // 看不见的尺子给 AI 打分**。AI 手里只有 play_check（平台走查）那把尺子，
      // 它照着量出「通过」，实测却红着退出，那这一轮就白跑了。
      //
      // 所以这里只留这一套**独有**的东西——「打不打得开」：白屏、报错横幅、
      // JS 异常、没发布被 403 挡住、有标签没控件。玩不玩得动交给 platformCheck()。
      // 走查本身有没有坏，由 scripts/playcheck-selftest.mjs 用一份已知能走通的
      // 假作品盯着，不再靠另搓一个走查器来互相验。
    }
  } catch (e) {
    errs.push(`打开失败: ${String(e).slice(0, 160)}`);
  }
  await browser.close();
  const bar = banner.replace(/\s+/g, " ").trim();
  // 「没发布」不是「作品坏了」——分开说，不然三轮都在跟一句 403 较劲。
  const notPublished = /not published/i.test(text) && text.length < 40;
  // 只回答一件事：**打不打得开**。玩不玩得动是 platformCheck() 的活。
  const broken =
    notPublished ||
    Boolean(bar) || errs.length > 0 || text.length < 80 || flaws.length > 0;
  console.log(
    `\n【${label}】${broken ? "✗ 打不开" : "✓ 打得开"}　正文 ${text.length} 字　可点 ${clickable} 处`
  );
  if (notPublished) {
    console.log(
      `  这不是作品的毛病：它现在没发布，${asPlayer ? "玩家" : "这次打开"}被 /play 挡在 403 外面。`
    );
  }
  if (bar) console.log(`  横幅：${bar}`);
  for (const e of [...new Set(errs)].slice(0, 4)) console.log(`  报错：${e}`);
  for (const f of flaws) console.log(`  毛病：${f}`);
  console.log(`  首屏：${text.replace(/\s+/g, " ").slice(0, 240)}`);
  return { broken, notPublished, bar, errs: [...new Set(errs)], flaws, text };
}

/**
 * 跑一轮 AI（走异步任务那条路，跟作者在工作台里走的是同一条）。
 *
 * 容器重启会把跑到一半的那一轮打死——服务端自己给的提示就是
 * 「把刚才那句话再发一次就行」。这种情况自动重发一次，不要让整条流水线红着退出：
 * 实测里两次都是我一边改环境变量（会触发重新部署）一边派活，自己把自己掐了。
 */
async function ask(message, retried = false) {
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
  let checking = false;
  while (Date.now() < deadline) {
    await new Promise((s) => setTimeout(s, 5000));
    const jr = await fetch(`${base}/api/games/${gameId}/assistant?job=${job}`, { headers: { cookie: COOKIE } })
      .then((x) => x.json())
      .catch(() => null);
    // AI 在这一轮里挂号要一份体检——它跑在服务端开不了浏览器，这个脚本能开。
    // 接了号跑一次、把报告 POST 回去，服务端那一轮当场接着往下走。
    // 不接的话 AI 等 90 秒会收到「没人替你跑」，那一轮就白等了。
    if (jr?.checkWanted && !checking) {
      checking = true;
      platformCheck("AI 当轮要的")
        .catch(() => null)
        .finally(() => {
          checking = false;
        });
    }
    const j = jr?.job;
    if (!j) continue;
    if (j.note && j.note !== note) {
      note = j.note;
      console.log(`  · ${note}`);
    }
    if (j.status === "done") return jr;
    if (j.status === "error") {
      const why = j.error || "这一轮失败了";
      if (!retried && /服务重启|重启了/.test(why)) {
        console.log(`  ↻ ${why}\n  （多半是平台正在重新部署，等 60 秒重发一次）`);
        await new Promise((s2) => setTimeout(s2, 60000));
        return ask(message, true);
      }
      throw new Error(why);
    }
  }
  throw new Error("等了 20 分钟还没跑完");
}

/**
 * 让**平台自己的**试玩体检跑一遍（`?wgpcheck=1`），并把报告交回平台。
 *
 * 跟上面 boot() 里那套走查的分工是：boot 是**我的**眼睛，报告打在日志里给人看；
 * 这一条是**平台的**眼睛——报告存进服务端，下一轮自动出现在 AI 的【试玩体检】里。
 * 「点了没反应」这类问题一个异常都不抛，不走这条路 AI 就是瞎的。
 *
 * 这里只当浏览器司机：真正去点的那段代码是平台在出口注入的，不是这个脚本写的。
 * 按铁律 1，能力必须长在平台里，脚本只负责开一次页面。
 */
async function platformCheck(label) {
  const browser = await chromium.launch(
    CHROME ? { executablePath: CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] }
  );
  let report = null;
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 820 } });
    const eq = COOKIE.indexOf("=");
    if (eq > 0) {
      await ctx.addCookies([
        { name: COOKIE.slice(0, eq), value: COOKIE.slice(eq + 1), url: base },
      ]);
    }
    const page = await ctx.newPage();
    // 顶层打开时 parent === self，体检脚本 postMessage 给 parent 就落在这一页上
    await page.addInitScript(() => {
      window.__pc = null;
      window.addEventListener("message", (e) => {
        const d = e.data || {};
        if (d.type === "wgp:playcheck") window.__pc = d.data;
        // 体检要从开局走，所以存档一律回空
        if (d.type === "wgp:load") window.postMessage({ type: "wgp:loaded", data: null }, "*");
      });
    });
    await page.goto(`${base}/play/${gameId}/index.html?wgpcheck=1&t=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction("window.__pc", null, { timeout: 40000 }).catch(() => {});
    report = await page.evaluate("window.__pc").catch(() => null);
  } finally {
    await browser.close().catch(() => {});
  }
  if (!report) {
    console.log(`  平台试玩体检（${label}）：没跑出结果——作品可能连打开都没打开`);
    // **没跑成不等于通过。** 平台在「把没测到说成没问题」上已经栽过五次，
    // 这里明确回 ran:false，让调用方去说清楚，而不是当成一次沉默的通过。
    return { ran: false, ok: false, summary: "体检没跑出结果", text: "" };
  }
  const r = await fetch(`${base}/api/games/${gameId}/playcheck`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(report),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.log(`  平台试玩体检（${label}）：报告没收下 ${JSON.stringify(b).slice(0, 200)}`);
    return { ran: false, ok: false, summary: "报告没收下", text: "" };
  }
  console.log(`  平台试玩体检（${label}）：${b.summary}`);
  return { ran: true, ok: b.ok_play === true, summary: b.summary ?? "", text: b.text ?? "" };
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
const COMPLAINT = (process.env.COMPLAINT ?? "").trim();

/**
 * 一部作品「行不行」，由两半合起来说，各管各的那一半：
 *
 *   - `boot()`      —— **打不打得开**：白屏、报错横幅、JS 异常、没发布被挡、有标签没控件
 *   - `platformCheck()` —— **玩不玩得动**：平台自己的试玩体检，跟 AI 手里 play_check
 *                          拿到的是同一份报告、同一套判据
 *
 * 第二半故意用平台自己那把尺子：**实测不能拿一把 AI 看不见的尺子给它打分**。
 * 走查本身准不准，由 playcheck-selftest.mjs 盯着。
 *
 * 还有一条硬规矩：体检**没跑成**的时候一律算不行，并且要说出来是「没测到」
 * 而不是「没问题」——这个坑平台已经踩过五次了。
 */
async function verdict(label, { asPlayer = false } = {}) {
  const open = await boot(label, asPlayer);
  // 玩家视角是匿名打开的，平台只肯给作者注入体检脚本，那一趟只验「打不打得开」
  if (asPlayer) return { ...open, ok: !open.broken, check: null };
  const check = await platformCheck(label);
  const ok = !open.broken && check.ran && check.ok;
  console.log(
    `  合起来：${ok ? "✓ 玩得动" : "✗ 还不行"}` +
      `（打开 ${open.broken ? "✗" : "✓"} / 试玩 ${check.ran ? (check.ok ? "✓" : "✗") : "没跑成"}）`
  );
  if (!open.broken && !check.ran) {
    console.log("  注意：试玩体检没跑成，**这不等于通过**——它只是没测到。");
  }
  return { ...open, ok, check };
}

let state = await verdict("修之前");
if (state.ok && !COMPLAINT) {
  console.log("\n这部作品现在玩得动，不用修。");
  process.exit(0);
}

for (let round = 1; round <= maxRounds; round++) {
  console.log(`\n──────── 第 ${round}/${maxRounds} 轮：交给 AI ────────`);
  // 报错本身不用抄——平台会自动贴进它的【运行报错】。
  //
  // 「哪儿不行」的原话**直接取平台试玩体检那一段**，跟 AI 自己调 play_check
  // 拿到的是同一段字。脚本不再另编一套说法：一套尺子量、一套尺子说，
  // 才不会出现「AI 照着一套改到通过、实测按另一套判红」。
  const evidence = [
    state.bar ? `页面顶上是一条红色报错横幅：${state.bar}` : "",
    ...state.flaws.map((x) => `打开的时候就看出来：${x}`),
    state.check && !state.check.ran
      ? "（平台的试玩体检这一轮没跑成，所以这里没有走查结论——**这不等于体检通过**，只是没测到。）"
      : "",
    state.check && state.check.ran && !state.check.ok && state.check.text ? state.check.text : "",
  ]
    .filter(Boolean)
    .join("\n");
  const res = await ask(
    "玩家现在玩不了这部作品。\n" +
      (COMPLAINT ? `创作者的原话：「${COMPLAINT}」\n` : "") +
      (evidence ? `${evidence}\n` : "") +
      "先看【运行报错】（有的话），把问题修好；" +
      "**改完必须调一次 play_check 自己验**——上面那段结论就是它给的，" +
      "你手里那把尺子和我这边判好没好用的是同一把。它说还有问题就接着修，" +
      "别写完就交差等下一轮。最后用 read_errors 带 clear: true 清掉记录。"
  );
  const reply = String(res?.job?.result?.reply ?? res?.reply ?? "").replace(/\s+/g, " ");
  console.log(`  AI：${reply.slice(0, 400)}`);
  // 修完再验一遍：好没好由平台自己说，而且这份结果就是下一轮 AI 的上下文
  state = await verdict(`第 ${round} 轮之后`);
  if (state.ok) {
    // **修好了才发布。**
    //
    // 原来是每轮先发布再验，于是一部还坏着的作品被一遍遍推回公开游戏库——
    // 老板为此投诉过一次（「游戏库里新出现的 val manager 根本玩不了」）。
    // 回炉全程走草稿：boot() 带着会话 cookie 打开，看到的本来就是草稿，
    // 不发布也验得了。玩家那边保持不动，直到它真的能玩。
    await publish();
    // 草稿好了不等于玩家那边好了：发布之后再用**匿名**浏览器验一遍，
    // 这一步才是玩家真正看到的东西（也顺带验证快照真的推上去了）。
    const live = await verdict("发布之后（玩家视角）", { asPlayer: true });
    if (!live.ok) {
      console.log("\n✗ 草稿是好的，可玩家那边还是不行——发布这一步没把新版本推上去。");
      process.exit(1);
    }
    console.log(`\n✓ 修好了（用了 ${round} 轮），玩家那边也验过了。`);
    process.exit(0);
  }
}

console.log("\n✗ 跑满了还是没修好。上面每一轮的报错原文就是线索。");
process.exit(1);
