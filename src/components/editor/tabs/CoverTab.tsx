"use client";

import GameCover, { COVER_PRESET_LIST } from "@/components/GameCover";
import { GameConfig } from "@/lib/schema";

// 封面·素材页签的上半部分：作品封面。自传图片（浏览器端裁成 16:9）或挑一套官方主题样式，
// 都没有时用默认渐变。封面出现在游戏库、作者页与「我的创作」。
// 下半部分的游戏内素材由 AssetsSection 渲染，page.tsx 作为 children 传进来——
// 两块共用一个 coverBusy 忙碌态（同一时间只处理一张图）。

export default function CoverTab({
  gameId,
  config,
  hasCover,
  coverBusy,
  coverVersion,
  onUploadCover,
  onRemoveCover,
  onSetPreset,
  children,
}: {
  gameId: string;
  config: GameConfig;
  hasCover: boolean;
  coverBusy: boolean;
  /** 换封面后自增，用来绕开图片缓存并重挂载预览 */
  coverVersion: number;
  onUploadCover: (file: File) => void;
  onRemoveCover: () => void;
  /** 传 undefined 表示清除预设 */
  onSetPreset: (presetId: string | undefined) => void;
  /** 游戏内图片素材那一块（AssetsSection） */
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <div className="pane-note">
        封面显示在游戏库、作者页与「我的创作」。上传自定义图片（自动裁剪为 16:9 并压缩），
        或从素材库选一套主题样式；两者都没有时使用默认渐变。
      </div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start", padding: "10px 0" }}>
        <div style={{ width: 300 }}>
          <GameCover
            key={coverVersion}
            id={gameId}
            title={config.meta.title}
            kind={config.driver.kind}
            preset={config.meta.coverPreset}
            coverUrl={hasCover ? `/api/games/${gameId}/cover?v=e${coverVersion}` : undefined}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <label className="btn small secondary" style={{ cursor: "pointer" }}>
              {coverBusy ? "处理中…" : "上传图片"}
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                disabled={coverBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onUploadCover(f);
                }}
              />
            </label>
            {hasCover && (
              <button className="btn small secondary" disabled={coverBusy} onClick={() => onRemoveCover()}>
                移除自定义封面
              </button>
            )}
            {config.meta.coverPreset && (
              <button className="btn small secondary" onClick={() => onSetPreset(undefined)}>
                清除预设
              </button>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 320 }}>
          <div className="pane-note" style={{ paddingTop: 0 }}>封面样式库（点击选用）</div>
          <div className="preset-grid">
            {COVER_PRESET_LIST.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`preset-tile ${config.meta.coverPreset === p.id ? "selected" : ""}`}
                onClick={() => onSetPreset(p.id)}
                title={p.label}
              >
                <GameCover id={`preset-${p.id}`} title={p.label.split("·")[1]?.trim() ?? p.label} kind="unknown" preset={p.id} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}
