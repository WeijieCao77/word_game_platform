"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePlayStats } from "@/components/player/hooks";
import { useGameFrameBridge } from "@/components/game-frame";

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
 *   parent.postMessage({ type: "wgp:error", data: {…} }, "*") 报一条运行时异常（运行库自动发）
 *   window.addEventListener("message", e => e.data.type === "wgp:loaded" && ...)
 */
export default function CodeGameFrame({
  gameId,
  title,
  editKey,
  previewToken,
}: {
  gameId: string;
  title: string;
  /** 未发布的作品要带钥匙才看得到（作者自己预览） */
  editKey?: string;
  /**
   * 服务端已经换好的预览通行证。
   *
   * 归属人凭登录态打开未发布作品时走这条：**cookie 救不了沙箱里的子请求**
   * （不透明源 = 跨站，SameSite=Lax 不带 cookie），所以通行证必须进路径。
   * 页面那一层拿得到会话，就在那儿换好直接发下来——比把编辑钥匙塞进 HTML 干净。
   */
  previewToken?: string;
}): React.ReactElement {
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [full, setFull] = useState(false);
  const saveKey = `wgp_codesave_${gameId}`;
  // 自由模式的作品也要计游玩、时长与点赞——跟快速模式共用同一套口径，
  // 不然它们在游戏库的「最热」里永远是零，作者的后台数据也是空的。
  // 作者自己带着钥匙预览时不计（跟 GamePlayer 的 preview 一个道理）。
  const { likes, liked, toggleLike } = usePlayStats(editKey || previewToken ? "preview" : "play", gameId);
  // 存档、就绪、报错回传全在这一个钩子里——编辑器的预览页签用的是同一份，
  // 保证「作者预览到的」和「玩家玩到的」是同一个环境（见 components/game-frame.ts）
  const { ready, clearSave, markReady } = useGameFrameBridge({ gameId, frameRef, saveKey });

  useEffect(() => {
    const onFs = (): void => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // 未发布的作品先换一张预览通行证，并把它放进**路径**——
  // index.html 里相对引用的 style.css / game.js 才带得上（见 lib/preview-token.ts）。
  // 换到之前先不加载 iframe，免得先渲染一张裸页再闪一下。
  const [pass, setPass] = useState(previewToken ? `k~${previewToken}/` : editKey ? "" : "-");
  useEffect(() => {
    if (previewToken || !editKey) return;
    let alive = true;
    void fetch(`/api/games/${gameId}/preview`, { method: "POST", headers: { "x-edit-key": editKey } })
      .then(async (r) => {
        if (!alive) return;
        const t = r.ok ? ((await r.json()) as { token?: string }).token : "";
        setPass(t ? `k~${t}/` : "-");
      })
      .catch(() => alive && setPass("-"));
    return () => {
      alive = false;
    };
  }, [editKey, gameId, previewToken]);

  const src = `/play/${gameId}/${pass === "-" ? "" : pass}index.html`;

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
            clearSave();
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
        {likes !== null && (
          <button className="linklike" onClick={() => void toggleLike()} title="喜欢这部作品">
            {liked ? "♥" : "♡"} {likes}
          </button>
        )}
      </div>
      <div className="embed-stage">
        {!ready && <div className="embed-loading">正在载入《{title}》…</div>}
        {pass !== "" && (
        <iframe
          ref={frameRef}
          className="embed-frame"
          src={src}
          title={title}
          // 关键：不给 allow-same-origin。游戏拿到的是不透明源，
          // 读不到平台的 cookie/存储，也访问不了 parent 的 DOM。
          sandbox="allow-scripts"
          onLoad={() => setTimeout(markReady, 1200)}
        />
        )}
      </div>
    </div>
  );
}
