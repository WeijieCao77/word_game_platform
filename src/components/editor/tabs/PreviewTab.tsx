"use client";

import { useEffect, useState } from "react";
import GamePlayer from "@/components/GamePlayer";
import { GameConfig } from "@/lib/schema";

// 预览试玩页签：直接嵌玩家页那一个 GamePlayer——编辑器与播放器同源，
// 作者看到的就是玩家看到的。有校验错误时不渲染播放器，改去看「校验」页。
// previewNonce 变化即重挂载播放器（应用新配置后从头开一局）。
//
// 自由模式的作品没有通用播放器可嵌——它自带一套页面，跑在沙箱 iframe 里，
// 所以这里直接嵌那个沙箱地址（带编辑钥匙，未发布也看得到）。

export default function PreviewTab({
  config,
  gameId,
  errorCount,
  previewNonce,
  mode = "engine",
  editKey = "",
}: {
  config: GameConfig;
  gameId: string;
  errorCount: number;
  previewNonce: number;
  mode?: "engine" | "code";
  editKey?: string;
}): React.ReactElement {
  if (mode === "code") {
    return <CodePreview gameId={gameId} editKey={editKey} nonce={previewNonce} />;
  }
  if (errorCount > 0) {
    return <div className="pane-note">配置存在 {errorCount} 个错误，修复后即可预览（见「校验」页）。</div>;
  }
  return (
    <div className="preview-frame">
      <GamePlayer key={previewNonce} config={config} gameId={gameId} mode="preview" />
    </div>
  );
}

/**
 * 自由模式的预览。
 *
 * 先去换一张预览通行证（httpOnly cookie）再加载 iframe——不能靠 ?k=：
 * index.html 里相对引用的 style.css / game.js，浏览器发子请求时不会带上查询串，
 * 那些文件会全部 403，作者看到一张裸页还以为 AI 写坏了。
 * 顺带的好处是钥匙不再出现在 iframe 的 location 里，作者的代码读不到它。
 */
function CodePreview({
  gameId,
  editKey,
  nonce,
}: {
  gameId: string;
  editKey: string;
  nonce: number;
}): React.ReactElement {
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setToken("");
    setErr("");
    void fetch(`/api/games/${gameId}/preview`, {
      method: "POST",
      headers: { "x-edit-key": editKey },
    })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) {
          setErr("拿不到预览权限，刷新页面试试");
          return;
        }
        setToken(((await r.json()) as { token?: string }).token ?? "");
      })
      .catch(() => alive && setErr("预览请求失败，检查一下网络"));
    return () => {
      alive = false;
    };
  }, [gameId, editKey, nonce]);

  if (err) return <div className="pane-note">{err}</div>;
  if (!token) return <div className="pane-note">正在打开预览…</div>;
  return (
    <div className="preview-frame preview-code">
      <iframe
        key={nonce}
        className="preview-code-frame"
        src={`/play/${gameId}/k~${token}/index.html?n=${nonce}`}
        title="预览"
        // 跟正式游玩页一样的沙箱：不给 allow-same-origin，作者预览到的
        // 就是玩家会遇到的那个环境
        sandbox="allow-scripts"
      />
    </div>
  );
}
