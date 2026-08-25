"use client";

import { GameConfig } from "@/lib/schema";
import { LIBRARY_CATEGORIES, LibraryEntry, RankedLibraryEntry, shareBlockReason } from "@/lib/library";

// 内容库页签：上半部分逛别人的桥段（按当前作品题材排序，贴合的置顶标「贴合本作」），
// 下半部分把自己的独立卡片分享出去（依赖其他卡/实体的卡由 shareBlockReason 挡掉）。
// 推荐排序与插入逻辑在 src/lib/library.ts；这里只管界面与回调。

export default function LibraryTab({
  config,
  libCategory,
  libQ,
  libEntries,
  rankedLib,
  onCategoryChange,
  onQChange,
  onSearch,
  onInsert,
  shareCardId,
  shareCategory,
  shareTags,
  onShareCardId,
  onShareCategory,
  onShareTags,
  onShare,
}: {
  config: GameConfig;
  libCategory: string;
  libQ: string;
  /** null = 还没加载完；用来区分「加载中」与「没有匹配的内容」 */
  libEntries: LibraryEntry[] | null;
  rankedLib: RankedLibraryEntry[] | null;
  onCategoryChange: (category: string) => void;
  onQChange: (q: string) => void;
  onSearch: () => void;
  onInsert: (entry: LibraryEntry) => void;
  shareCardId: string;
  shareCategory: string;
  shareTags: string;
  onShareCardId: (id: string) => void;
  onShareCategory: (category: string) => void;
  onShareTags: (tags: string) => void;
  onShare: () => void;
}): React.ReactElement {
  return (
    <div>
      <div className="pane-note" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={libCategory}
          onChange={(e) => {
            onCategoryChange(e.target.value);
          }}
        >
          <option value="">全部分类</option>
          {LIBRARY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={libQ}
          placeholder="搜索标题/文案/标签"
          style={{ flex: 1, minWidth: 120, padding: "4px 8px" }}
          onChange={(e) => onQChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSearch();
          }}
        />
        <button className="btn small secondary" onClick={onSearch}>
          搜索
        </button>
      </div>
      <div className="issues">
        {libEntries === null && <div className="pane-note">加载中…</div>}
        {libEntries?.length === 0 && <div className="pane-note">没有匹配的内容。</div>}
        {rankedLib?.map(({ entry, recommended }) => (
          <div key={entry.id} className="lib-card">
            <div className="lib-head">
              <b>{entry.name}</b>
              {recommended && (
                <span className="tag" style={{ color: "var(--accent, #7cd67c)" }} title="标签/变量与当前作品题材贴合，排在前面">
                  贴合本作
                </span>
              )}
              <span className="tag">{entry.category}</span>
              {entry.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
              <span className="lib-src">
                {entry.source === "official" ? "官方" : entry.source === "ai" ? "AI" : entry.author}
              </span>
              <button
                className="btn small"
                onClick={() => {
                  onInsert(entry);
                }}
              >
                插入
              </button>
            </div>
            <div className="lib-preview">{entry.card.text.slice(0, 100)}</div>
          </div>
        ))}
      </div>
      <div className="pane-note" style={{ borderTop: "1px solid var(--border)", marginTop: 8 }}>
        <b>分享本游戏的卡片到内容库</b>（仅限不依赖其他卡片/实体的独立卡）
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={shareCardId} onChange={(e) => onShareCardId(e.target.value)}>
            <option value="">选择卡片…</option>
            {config.cards
              .filter((c) => !shareBlockReason(c))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || c.id}
                </option>
              ))}
          </select>
          <select value={shareCategory} onChange={(e) => onShareCategory(e.target.value)}>
            {LIBRARY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={shareTags}
            placeholder="标签，逗号分隔（如 修仙,抉择）"
            style={{ padding: "4px 8px" }}
            onChange={(e) => onShareTags(e.target.value)}
          />
          <button
            className="btn small secondary"
            disabled={!shareCardId}
            onClick={() => {
              onShare();
            }}
          >
            分享
          </button>
        </div>
      </div>
    </div>
  );
}
