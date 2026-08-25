"use client";

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
    return (
      <div className="preview-frame preview-code">
        <iframe
          key={previewNonce}
          className="preview-code-frame"
          src={`/play/${gameId}/index.html?k=${encodeURIComponent(editKey)}&n=${previewNonce}`}
          title="预览"
          // 跟正式游玩页一样的沙箱：不给 allow-same-origin，作者预览到的
          // 就是玩家会遇到的那个环境（存档在这里不接桥，纯看界面与流程）
          sandbox="allow-scripts"
        />
      </div>
    );
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
