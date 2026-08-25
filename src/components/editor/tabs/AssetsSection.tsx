"use client";

import { AssetItem, LibAssetItem } from "../types";

// 封面·素材页签的下半部分：游戏内图片素材（角色立绘、场景图……）。
// 起名 → 上传（可勾选同时分享到公共素材库）→ 卡片的 image 字段按名称引用；
// 上传/删除后清单会自动写回设计卡，AI 工作室据此建议放图位。
// 还能从公共素材库导入别的作者共享出来的图。
// 上传/删除/导入的实际请求都在 page.tsx，这里只画界面。

export default function AssetsSection({
  gameId,
  assets,
  assetName,
  assetShare,
  busy,
  libAssets,
  onAssetName,
  onAssetShare,
  onUploadAsset,
  onDeleteAsset,
  onBrowseLibAssets,
  onImportLibAsset,
}: {
  gameId: string;
  /** null = 还没加载完 */
  assets: AssetItem[] | null;
  assetName: string;
  /** 是否同时分享到公共素材库 */
  assetShare: boolean;
  busy: boolean;
  /** null = 还没点过「浏览公共素材库」 */
  libAssets: LibAssetItem[] | null;
  onAssetName: (name: string) => void;
  onAssetShare: (share: boolean) => void;
  onUploadAsset: (file: File) => void;
  onDeleteAsset: (name: string) => void;
  onBrowseLibAssets: () => void;
  onImportLibAsset: (libId: string, name: string) => void;
}): React.ReactElement {
  return (
    <div className="pane-note" style={{ borderTop: "1px solid var(--border)", marginTop: 6 }}>
      <b>游戏内图片素材</b>（角色立绘、场景、宗门图……作者自己上传，卡片的 image 字段按名称引用；
      上传后清单会自动记进设计卡，AI 工作室会建议放图位）
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          value={assetName}
          placeholder="素材名（如 女主立绘）"
          maxLength={40}
          style={{ padding: "5px 10px", width: 180 }}
          onChange={(e) => onAssetName(e.target.value)}
        />
        <label className="btn small secondary" style={{ cursor: "pointer" }}>
          {busy ? "处理中…" : "选择图片上传"}
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onUploadAsset(f);
            }}
          />
        </label>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
          <input type="checkbox" checked={assetShare} onChange={(e) => onAssetShare(e.target.checked)} />
          同时分享到公共素材库（其他创作者可复用）
        </label>
      </div>
      <div className="asset-grid">
        {assets === null && <span className="pane-note">加载中…</span>}
        {assets?.length === 0 && <span className="pane-note">还没有素材。</span>}
        {assets?.map((a) => (
          <div key={a.name} className="asset-tile">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/games/${gameId}/assets/${encodeURIComponent(a.name)}?v=${a.size}`} alt={a.name} loading="lazy" />
            <div className="asset-meta">
              <span title={`卡片 image 字段填 "${a.name}"`}>{a.name}</span>
              <button className="linklike danger" onClick={() => onDeleteAsset(a.name)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <button className="btn small secondary" onClick={() => onBrowseLibAssets()}>
          浏览公共素材库
        </button>
        {libAssets && (
          <div className="asset-grid">
            {libAssets.length === 0 && <span className="pane-note">公共素材库还是空的。</span>}
            {libAssets.map((a) => (
              <div key={a.id} className="asset-tile">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/library/assets/${encodeURIComponent(a.id)}`} alt={a.name} loading="lazy" />
                <div className="asset-meta">
                  <span>
                    {a.name} <em style={{ opacity: 0.6 }}>by {a.author}</em>
                  </span>
                  <button className="linklike" onClick={() => onImportLibAsset(a.id, a.name)}>
                    导入
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
