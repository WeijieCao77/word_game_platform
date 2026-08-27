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
 * 像玩家一样打开**并且真去玩一下**，回来报「能不能玩 + 卡在哪」。
 *
 * 只看「打不打得开」是不够的——老板撞到的第二个坑就是这样：页面渲染得好好的，
 * 一个 JS 错误都没有，可「你的名字」只有标签、**没有输入框**，点「下一步」
 * 弹一句「先给自己起个名字」然后原地不动。体检当时判的是「✓ 能玩」。
 * 所以这里补三样：表单控件对不对得上标签、点主按钮之后页面变没变、有没有卡住。
 */
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
  let moved = 0;
  const stuck = [];
  const dead = [];
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
        stuck.push(`页面上有 ${labels} 个标签却只有 ${fields} 个能填的控件——有字段渲染不出来（玩家看得到「填什么」，却没地方填）`);
      }

      // 先把开局走完，再谈导航。
      //
      // 这一条是被自己的盲点逼出来的：玩家一进去是「捏人第 1 步 / 4」，
      // 那一屏根本没有导航栏——导航要走完创建流程才出现。上一版体检只看首屏，
      // 于是 navN=0、一项都没点，还判了「✓ 玩得动」，等于把老板的投诉漏过去了。
      // 所以像玩家一样往前走：把能填的填上、点主按钮，最多 10 步，
      // 走到出现导航为止（或者页面不再变化）。
      const hasNav = async () =>
        (await frame.locator("nav button:visible, .wgp-nav-item:visible, [data-screen]:visible").count().catch(() => 0)) > 0;
      let steps = 0;
      while (steps < 10 && !(await hasNav())) {
        const fields = frame.locator("input:visible, textarea:visible");
        const fn = Math.min(await fields.count().catch(() => 0), 4);
        for (let i = 0; i < fn; i++) {
          await fields.nth(i).fill("测试", { timeout: 1500 }).catch(() => {});
        }
        const next = frame.locator(CLICKABLE).last();
        if ((await next.count().catch(() => 0)) === 0) {
          // 一个能点的都没有 = 死路。以前这里直接 break 然后照样判「✓ 玩得动」，
          // 于是「走不下去」被当成「没问题」——同一个毛病栽了第三次。
          // 报「没得点」之前先把这一屏有什么摆出来：到底是作品没画，
          // 还是我的判据又太窄了。靠猜已经猜错过三次。
          const shape = await frame
            .evaluate(() => {
              const out = [];
              document.querySelectorAll("body *").forEach((n) => {
                const r = n.getBoundingClientRect();
                if (r.width < 8 || r.height < 8) return;
                const clickish =
                  n.onclick ||
                  n.getAttribute("onclick") ||
                  n.dataset.act ||
                  n.dataset.screen ||
                  n.hasAttribute("tabindex");
                if (!clickish && !/^(BUTTON|A|INPUT|SELECT)$/.test(n.tagName)) return;
                out.push(
                  n.tagName.toLowerCase() +
                    (n.className && typeof n.className === "string" ? "." + n.className.split(/\s+/).slice(0, 2).join(".") : "") +
                    "「" + (n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 14) + "」"
                );
              });
              return out.slice(0, 12);
            })
            .catch(() => []);
          stuck.push(
            `开局第 ${steps + 1} 屏上一个能点的东西都没有——走不下去了` +
              (shape.length ? `（这一屏上像是能点的元素：${shape.join("、")}）` : "（这一屏上连像样的元素都没有）")
          );
          break;
        }
        const was = (await frame.locator("body").innerText().catch(() => "")).replace(/\s+/g, "");
        await next.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const now = (await frame.locator("body").innerText().catch(() => "")).replace(/\s+/g, "");
        steps += 1;
        if (now === was) {
          stuck.push(`开局第 ${steps} 步点下去，页面一个字都没变——走不下去了`);
          break;
        }
      }
      // 走到底也没看见导航 = 这次体检**没能验到导航**。
      // 这不叫通过，叫测不了——测不了就不许报「玩得动」，不然又是一次自欺。
      const reachedNav = await hasNav();
      if (steps > 0) console.log(`  开局走了 ${steps} 步${reachedNav ? "，进到有导航的界面" : "，还是没看到导航"}`);
      if (!reachedNav) {
        stuck.push(
          `走了 ${steps} 步也没走到有导航的界面——作品说好有俱乐部/阵容/赛程那一整排页签，` +
            `玩家却进不去；先让开局这条路能一直走到主界面`
        );
      }

      // 导航体检：挂在导航上的每一项都点一遍，看点不点得进去、里面有没有真东西。
      //
      // 老板的第三次投诉就是这个：「这一排里面很多都点不了」。
      // 平台的铁律写着「不许写占位页」——挂在导航上就必须点得进去、里面必须有真东西。
      // 这一层就是量那条律的：点了没反应的、点进去几乎空白的、挂着但是禁用的，全报出来。
      const nav = frame.locator(
        "nav button:visible, nav a:visible, .wgp-nav-item:visible, [data-screen]:visible"
      );
      const navN = Math.min(await nav.count().catch(() => 0), 30);
      for (let i = 0; i < navN; i++) {
        const item = nav.nth(i);
        const name = (await item.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 12);
        if (!name) continue;
        const off =
          (await item.isDisabled().catch(() => false)) ||
          (await item.getAttribute("aria-disabled").catch(() => null)) === "true";
        if (off) {
          dead.push(`${name}：挂在导航上却是禁用的`);
          continue;
        }
        const before = (await frame.locator("body").innerText().catch(() => "")).replace(/\s+/g, "");
        await item.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(900);
        const after = (await frame.locator("body").innerText().catch(() => "")).replace(/\s+/g, "");
        if (after === before) dead.push(`${name}：点了一点反应都没有`);
        else if (after.length < 150) dead.push(`${name}：点进去几乎是空的（只有 ${after.length} 字）`);
      }
      if (navN > 0) {
        console.log(`  导航 ${navN} 项，其中 ${dead.length} 项有问题`);
      }

      // 首屏那个主按钮（只有在开局一步都没走动的情况下才需要单独试）
      const btn = frame.locator(CLICKABLE).first();
      if (steps === 0 && (await btn.count().catch(() => 0)) > 0) {
        const label0 = (await btn.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 24);
        // 能填的先填上，别把「没填必填项」当成 bug
        for (let i = 0; i < Math.min(fields, 4); i++) {
          await frame
            .locator("input:visible, textarea:visible")
            .nth(i)
            .fill("测试", { timeout: 2000 })
            .catch(() => {});
        }
        await btn.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(2500);
        const after = (await frame.locator("body").innerText().catch(() => "")).trim();
        if (after.replace(/\s+/g, "") === text.replace(/\s+/g, "")) {
          stuck.push(`点了「${label0}」之后页面一个字都没变——第一步就走不下去`);
        }
        moved = after.length;
      }
    }
  } catch (e) {
    errs.push(`打开失败: ${String(e).slice(0, 160)}`);
  }
  await browser.close();
  const bar = banner.replace(/\s+/g, " ").trim();
  const broken =
    Boolean(bar) || errs.length > 0 || text.length < 80 || stuck.length > 0 || dead.length > 0;
  console.log(
    `\n【${label}】${broken ? "✗ 玩不了" : "✓ 玩得动"}　正文 ${text.length} 字　可点 ${clickable} 处` +
      (moved ? `　点一下之后 ${moved} 字` : "")
  );
  if (bar) console.log(`  横幅：${bar}`);
  for (const e of [...new Set(errs)].slice(0, 4)) console.log(`  报错：${e}`);
  for (const s2 of stuck) console.log(`  卡住：${s2}`);
  for (const d of dead.slice(0, 12)) console.log(`  导航：${d}`);
  console.log(`  首屏：${text.replace(/\s+/g, " ").slice(0, 240)}`);
  return { broken, bar, errs: [...new Set(errs)], stuck, dead, text };
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
let state = await boot("修之前");
if (!state.broken && !COMPLAINT) {
  console.log("\n这部作品现在玩得动，不用修。");
  process.exit(0);
}

for (let round = 1; round <= maxRounds; round++) {
  console.log(`\n──────── 第 ${round}/${maxRounds} 轮：交给 AI ────────`);
  // 故意只说一句话。报错应该已经自动摆在它的【运行报错】里了——
  // 要是还得我把报错抄给它，说明那条链路没通。
  // 现场证据（横幅 / 报错 / 卡在哪）+ 创作者的原话，一起交给 AI。
  // 报错本身不用抄——平台会自动贴进它的【运行报错】。
  const evidence = [
    state.bar ? `页面顶上是一条红色报错横幅：${state.bar}` : "",
    ...state.stuck.map((x) => `实际去玩的时候：${x}`),
    ...(state.dead.length
      ? [
          "导航上这些项点不进去或者里面是空的：\n" + state.dead.map((x) => "  - " + x).join("\n"),
          "平台的铁律：挂在导航上就必须点得进去、里面必须有真东西；还没做的页宁可先从导航里拿掉。",
        ]
      : []),
  ]
    .filter(Boolean)
    .join("\n");
  const res = await ask(
    "玩家现在玩不了这部作品。\n" +
      (COMPLAINT ? `创作者的原话：「${COMPLAINT}」\n` : "") +
      (evidence ? `${evidence}\n` : "") +
      "先看【运行报错】（有的话），把问题修好；" +
      "修完把开局那条路径从头走一遍——加载、首屏渲染、每一个要玩家填的字段真的渲染出来了没有、" +
      "点第一个按钮能不能走到下一步。确认走得通再交差，然后用 read_errors 带 clear: true 清掉记录。"
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
