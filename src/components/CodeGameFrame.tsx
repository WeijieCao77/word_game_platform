"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 自由模式作品的运行外壳。
 *
 * 游戏跑在 sandbox="allow-scripts" 的 iframe 里——没有 allow-same-origin，
 * 浏览器给它一个**不透明源**：读不到平台的 cookie 与存储，也拿不到 parent 的东西。
 * 代价是它自己也用不了 localStorage，所以存档走 postMessage 交给外壳来存。
 * 这反而更好：存档在平台这边，换设备也能续。
 *
 * 游戏侧的 API（写进技能包，AI 照着用）：
 *   parent.postMessage({ type: "wgp:save", data }, "*")    存档（data 会被 JSON 序列化）
 *   parent.postMessage({ type: "wgp:load" }, "*")           要存档
 *   parent.postMessage({ type: "wgp:ready" }, "*")          告诉外壳自己起来了
 *   window.addEventListener("message", e => e.data.type === "wgp:loaded" && ...)
 */
export default function CodeGameFrame({
  gameId,
  title,
  editKey,
}: {
  gameId: string;
  title: string;
  /** 未发布的作品要带钥匙才看得到（作者自己预览） */
  editKey?: string;
}): React.ReactElement {
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [full, setFull] = useState(false);
  const [ready, setReady] = useState(false);
  const saveKey = `wgp_codesave_${gameId}`;

  const post = useCallback((msg: unknown) => {
    frameRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  const readSave = useCallback((): unknown => {
    try {
      const raw = localStorage.getItem(saveKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [saveKey]);

  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      // 只认自己那个 iframe 发来的消息
      if (e.source !== frameRef.current?.contentWindow) return;
      const data = e.data as { type?: string; data?: unknown };
      if (data?.type === "wgp:ready") {
        setReady(true);
      } else if (data?.type === "wgp:save") {
        try {
          localStorage.setItem(saveKey, JSON.stringify(data.data ?? null));
        } catch {
          // 隐私模式/存储满：存不下就算了，不该让游戏崩
        }
      } else if (data?.type === "wgp:load") {
        post({ type: "wgp:loaded", data: readSave() });
      } else if (data?.type === "wgp:clear") {
        try {
          localStorage.removeItem(saveKey);
        } catch {
          /* 同上 */
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [post, readSave, saveKey]);

  // 竞态兜底：iframe 常常在 React 水合之前就 load 完，游戏那一句 wgp:ready 与
  // wgp:load 发出来时外壳还没挂上监听——两条都会石沉大海，结果是遮罩不散、
  // 存档不回来（而且 onLoad 也不会补发，load 事件早过去了）。
  // 所以挂载后主动补两次：把存档推给游戏，并给遮罩一个时间下限。
  // 这两次补发都在第一秒内，玩家还来不及点任何东西，不会盖掉新进度。
  useEffect(() => {
    const timers = [
      setTimeout(() => post({ type: "wgp:loaded", data: readSave() }), 250),
      setTimeout(() => post({ type: "wgp:loaded", data: readSave() }), 900),
      setTimeout(() => setReady(true), 1500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [post, readSave]);

  useEffect(() => {
    const onFs = (): void => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const src = `/play/${gameId}/index.html${editKey ? `?k=${encodeURIComponent(editKey)}` : ""}`;

  return (
    <div className="embed-shell" ref={shellRef}>
      <div className="embed-bar">
        <Link className="embed-back" href="/">
          ← 返回字游
        </Link>
        <span className="embed-title">{title}</span>
        <span className="tag">自由模式</span>
        <span className="embed-spacer" />
        <button
          className="linklike"
          onClick={() => {
            try {
              localStorage.removeItem(saveKey);
            } catch {
              /* 同上 */
            }
            if (frameRef.current) frameRef.current.src = src;
          }}
        >
          重新开始
        </button>
        <button
          className="linklike"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void shellRef.current?.requestFullscreen();
          }}
        >
          {full ? "退出全屏" : "全屏游玩"}
        </button>
      </div>
      <div className="embed-stage">
        {!ready && <div className="embed-loading">正在载入《{title}》…</div>}
        <iframe
          ref={frameRef}
          className="embed-frame"
          src={src}
          title={title}
          // 关键：不给 allow-same-origin。游戏拿到的是不透明源，
          // 读不到平台的 cookie/存储，也访问不了 parent 的 DOM。
          sandbox="allow-scripts"
          onLoad={() => setTimeout(() => setReady(true), 1200)}
        />
      </div>
    </div>
  );
}
