"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// 旗舰作品内嵌壳：站内直接游玩，不再跳新标签页。
// 目标站是独立部署（自带存档与后端），这里只提供外壳——返回、全屏、以及嵌入失败时的兜底出口。

export default function FlagshipFrame({
  url,
  title,
  author,
}: {
  url: string;
  title: string;
  author: string;
}): React.ReactElement {
  const shellRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [full, setFull] = useState(false);

  // iframe 可能在 hydration 之前就加载完（onLoad 丢事件），所以遮罩另有超时兜底。
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onFs = (): void => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  return (
    <div className="embed-shell" ref={shellRef}>
      <div className="embed-bar">
        <Link className="embed-back" href="/">
          ← 返回游戏库
        </Link>
        <span className="embed-title">{title}</span>
        <span className="tag">旗舰作品</span>
        <span className="embed-author">作者：{author}</span>
        <span className="embed-spacer" />
        <button
          className="linklike"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void shellRef.current?.requestFullscreen();
          }}
        >
          {full ? "退出全屏" : "全屏游玩"}
        </button>
        <a className="linklike" href={url} target="_blank" rel="noreferrer">
          新窗口打开 ↗
        </a>
      </div>
      <div className="embed-stage">
        {!loaded && <div className="embed-loading">正在载入《{title}》…</div>}
        <iframe
          className="embed-frame"
          src={url}
          title={title}
          allow="fullscreen; clipboard-write"
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  );
}
