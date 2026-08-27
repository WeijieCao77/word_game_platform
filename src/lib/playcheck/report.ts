import { PlayCheckReport, PlayNavItem, PlayStuck, playCheckHasIssue } from "./types";

/**
 * 服务端这一半：把浏览器发回来的东西**当外人的输入**收，再翻译成 AI 看得懂的一段话。
 *
 * 收的时候一律截断、限长、限条数——这份 JSON 是从沙箱里的页面发出来的，
 * 作品的代码理论上碰得到它。
 */

const S = (v: unknown, n: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const N = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? Math.min(Math.round(x), 10_000_000) : 0;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** 把 postMessage 过来的东西洗成一份能存的报告 */
export function parsePlayCheck(raw: unknown): PlayCheckReport {
  const o = (raw ?? {}) as Record<string, unknown>;
  const stuckRaw = o.stuck as Record<string, unknown> | null | undefined;
  const stuck: PlayStuck | null = stuckRaw
    ? {
        step: N(stuckRaw.step),
        tried: arr(stuckRaw.tried).slice(0, 12).map((t) => S(t, 24)),
        screen: S(stuckRaw.screen, 300),
        filled: arr(stuckRaw.filled).slice(0, 6).map((t) => S(t, 24)),
        why: stuckRaw.why === "no-clickable" ? "no-clickable" : "dead-end",
      }
    : null;
  return {
    at: new Date().toISOString(),
    bootText: N(o.bootText),
    steps: arr(o.steps)
      .slice(0, 12)
      .map((s) => {
        const x = (s ?? {}) as Record<string, unknown>;
        return {
          label: S(x.label, 24),
          dead: arr(x.dead).slice(0, 10).map((d) => S(d, 24)),
          filled: arr(x.filled).slice(0, 6).map((f) => S(f, 24)),
        };
      }),
    stuck,
    nav: arr(o.nav)
      .slice(0, 20)
      .map((n): PlayNavItem => {
        const x = (n ?? {}) as Record<string, unknown>;
        return {
          label: S(x.label, 24),
          changed: x.changed === true,
          already: x.already === true,
          textLen: N(x.textLen),
          clickable: N(x.clickable),
        };
      }),
    notes: arr(o.notes).slice(0, 6).map((t) => S(t, 120)),
    ms: N(o.ms),
  };
}

/** 一句话的结论，给工作台顶栏和后台列表用 */
export function summarizePlayCheck(r: PlayCheckReport): string {
  if (r.bootText <= 0) return "开局白屏";
  const bad: string[] = [];
  if (r.stuck) bad.push(`开局卡在第 ${r.stuck.step} 步`);
  const dead = r.nav.filter((n) => !n.changed && !n.already).length;
  if (dead > 0) bad.push(`导航 ${dead}/${r.nav.length} 项点不动`);
  const deadBtn = r.steps.reduce((a, s2) => a + s2.dead.length, 0);
  if (deadBtn > 0) bad.push(`开局路上 ${deadBtn} 个按钮点了没反应`);
  const empty = r.nav.filter((n) => n.changed && n.textLen < 40 && n.clickable === 0).length;
  if (empty > 0) bad.push(`${empty} 页是空壳`);
  if (bad.length === 0) {
    // 「导航 0 项都能切」是句空话——一项都没测到，别写得像通过了。
    // 这个毛病我在别处栽过三次（判据浅、把「没测到」说成「没问题」），这里堵死。
    return r.nav.length > 0
      ? `试玩通过（走了 ${r.steps.length} 步，导航 ${r.nav.length} 项都能切）`
      : `开局走通 ${r.steps.length} 步；没找到导航，那一段没测到`;
  }
  return bad.join("、");
}

/**
 * 翻译成给 AI 的一段话。
 *
 * 要点全在措辞上：这类问题**不抛异常**，所以 read_errors 一定是空的。
 * 不把这句挑明，模型会照着老经验判「没有报错记录 = 没问题」然后收工——
 * 实测里连着四轮就是这么过去的。
 */
export function describePlayCheck(r: PlayCheckReport, lastWriteAt?: string): string {
  if (!playCheckHasIssue(r)) {
    const nav =
      r.nav.length > 0
        ? `导航 ${r.nav.length} 项都能切，没查出「点了没反应」。`
        : `**但一项导航都没找到**——要么这部作品还没有导航栏，要么体检没走到有导航的那一屏。` +
          `这一段等于没测到，别当成通过。`;
    return (
      `平台刚在浏览器里自动玩了一遍：开局走通 ${r.steps.length} 步，` +
      nav +
      `（走得动不说明好玩，也不说明数值对。）`
    );
  }
  const lines: string[] = [];
  lines.push("平台刚在浏览器里自动玩了一遍这部作品，查到下面这些问题。");
  lines.push(
    "**这类问题一个异常都不抛**——所以 read_errors 里当然是空的，别拿「没有报错记录」当作没问题。"
  );

  if (r.bootText <= 0) {
    lines.push("· 开局白屏：页面加载完之后，正文一个字都没有。");
  }

  if (r.stuck) {
    const s = r.stuck;
    if (s.why === "no-clickable") {
      lines.push(
        `· 开局走到第 ${s.step} 步就走不下去了：**这一屏根本没有能点的东西**` +
          `（没有按钮、没有链接、没有可点的卡片），玩家到这里就没路了。`
      );
    } else {
      lines.push(
        `· 开局走到第 ${s.step} 步就走不下去了：这一屏能点的东西全试了一遍` +
          `（${s.tried.join("、") || "无"}），**点完界面一个字都没变**。` +
          (s.filled.length ? `（体检已经先替玩家把「${s.filled.join("、")}」填上了，还是过不去。）` : "")
      );
    }
    lines.push(`  卡住的那一屏长这样：「${s.screen || "（空白）"}」`);
  }

  const deadOnPath = r.steps.flatMap((s2) => s2.dead);
  if (deadOnPath.length) {
    lines.push(
      `· 开局这一路上有 ${deadOnPath.length} 个按钮**点了没反应**：${deadOnPath.join("、")}。` +
        `流程最后是靠点别的东西才走下去的——这些按钮玩家一样会去点，点了就以为游戏卡了。`
    );
  }

  const dead = r.nav.filter((n) => !n.changed && !n.already);
  if (dead.length) {
    lines.push(
      `· 导航 ${r.nav.length} 项里有 ${dead.length} 项**点了没反应**：` +
        `${dead.map((n) => n.label).join("、")}。挂在导航上就得点得动。`
    );
  }
  const empty = r.nav.filter((n) => n.changed && n.textLen < 40 && n.clickable === 0);
  if (empty.length) {
    lines.push(
      `· 这几页切得过去，但里面几乎是空的（空壳）：` +
        empty.map((n) => `${n.label}（${n.textLen} 字 / 0 个可点元素）`).join("、") +
        `。没做完的页面不许挂进导航。`
    );
  }
  for (const n of r.notes) lines.push(`· ${n}`);

  if (lastWriteAt && lastWriteAt > r.at) {
    lines.push(
      "（注意：这份体检是在你这轮改文件**之前**跑的，可能已经过时——改完让创作者再体检一次。）"
    );
  }
  lines.push("修的时候先修「走不下去」那一条：开局过不去，后面做得再多玩家也看不到。");
  return lines.join("\n");
}
