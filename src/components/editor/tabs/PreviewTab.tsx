"use client";

import GamePlayer from "@/components/GamePlayer";
import { GameConfig } from "@/lib/schema";

// 预览试玩页签：直接嵌玩家页那一个 GamePlayer——编辑器与播放器同源，
// 作者看到的就是玩家看到的。有校验错误时不渲染播放器，改去看「校验」页。
// previewNonce 变化即重挂载播放器（应用新配置后从头开一局）。

export default function PreviewTab({
  config,
  gameId,
  errorCount,
  previewNonce,
}: {
  config: GameConfig;
  gameId: string;
  errorCount: number;
  previewNonce: number;
}): React.ReactElement {
  if (errorCount > 0) {
    return <div className="pane-note">配置存在 {errorCount} 个错误，修复后即可预览（见「校验」页）。</div>;
  }
  return (
    <div className="preview-frame">
      <GamePlayer key={previewNonce} config={config} gameId={gameId} mode="preview" />
    </div>
  );
}
