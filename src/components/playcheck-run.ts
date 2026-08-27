"use client";

import { PlayCheckReport } from "@/lib/playcheck/types";

/**
 * 在工作台里跑一次试玩体检。
 *
 * 干的事：开一个**看不见的沙箱 iframe** 载 `?wgpcheck=1` 的作品页，
 * 平台注入的体检脚本会在里面真的去点一遍，点完把报告 postMessage 回来，
 * 这里再送去服务端存下——下一轮 AI 的上下文里就会出现【试玩体检】。
 *
 * 三个细节是踩出来的，别顺手改掉：
 *
 * 1. **不能用 display:none**。隐藏的 iframe 里文档根本不排版，所有元素的
 *    getBoundingClientRect 都是 0，体检会一口咬定「这一屏没有能点的东西」——
 *    那是我自己的检查器瞎了，不是作品的问题。所以是挪到屏幕外，照常排版。
 * 2. **wgp:load 一律回 null**。体检要看的是**开局**走不走得通；
 *    要是把作者上次的存档喂回去，作品直接跳到中段，第一步永远检不到——
 *    而老板撞见的那次（「起名字没地方填」）恰恰就在第一步。
 * 3. 体检期间抛出来的异常照样送进 game_errors。自动点一遍本来就比人点得狠，
 *    踩出来的错更该留下。
 */

const TIMEOUT_MS = 30000;

export interface PlayCheckResult {
  ok: boolean;
  summary: string;
  report: PlayCheckReport | null;
  error?: string;
}

export async function runPlayCheck(gameId: string, editKey: string): Promise<PlayCheckResult> {
  // 预览通行证：子资源（style.css / game.js）的请求带不上 ?k=，只有 cookie 走得通
  let token = "";
  try {
    const r = await fetch(`/api/games/${gameId}/preview`, {
      method: "POST",
      headers: { "x-edit-key": editKey },
    });
    if (!r.ok) return { ok: false, summary: "", report: null, error: "拿不到预览权限，刷新页面再试" };
    token = ((await r.json()) as { token?: string }).token ?? "";
  } catch {
    return { ok: false, summary: "", report: null, error: "体检请求发不出去，检查一下网络" };
  }

  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("title", "试玩体检");
  // 挪到屏幕外，但照常排版——不能 display:none（见文件头第 1 条）
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:420px;height:820px;border:0;pointer-events:none";
  frame.src = `/play/${gameId}/k~${token}/index.html?wgpcheck=1&t=${Date.now()}`;

  const raw = await new Promise<unknown>((resolve) => {
    let done = false;
    const finish = (v: unknown): void => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMsg);
      clearTimeout(timer);
      frame.remove();
      resolve(v);
    };
    const onMsg = (e: MessageEvent): void => {
      if (e.source !== frame.contentWindow) return;
      const data = e.data as { type?: string; data?: unknown };
      if (data?.type === "wgp:load") {
        // 体检从零开局：不把旧存档喂回去（见文件头第 2 条）
        frame.contentWindow?.postMessage({ type: "wgp:loaded", data: null }, "*");
      } else if (data?.type === "wgp:error") {
        const err = (data.data ?? {}) as { message?: string };
        if (err.message) {
          void fetch(`/api/games/${gameId}/errors`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(data.data),
            keepalive: true,
          }).catch(() => {
            /* 报错通道自己出错，不该再惊动作者 */
          });
        }
      } else if (data?.type === "wgp:playcheck") {
        finish(data.data);
      }
      // wgp:save / wgp:clear 体检期间一概不落盘——别弄脏作者的存档
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    window.addEventListener("message", onMsg);
    document.body.appendChild(frame);
  });

  if (raw === null) {
    return { ok: false, summary: "", report: null, error: "体检超时——作品可能连打开都没打开" };
  }

  try {
    const res = await fetch(`/api/games/${gameId}/playcheck`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-edit-key": editKey },
      body: JSON.stringify(raw),
    });
    const body = (await res.json()) as {
      ok_play?: boolean;
      summary?: string;
      report?: PlayCheckReport;
      error?: string;
    };
    if (!res.ok) return { ok: false, summary: "", report: null, error: body.error ?? "体检结果存不下" };
    return { ok: body.ok_play === true, summary: body.summary ?? "", report: body.report ?? null };
  } catch {
    return { ok: false, summary: "", report: null, error: "体检结果送不回服务端" };
  }
}
