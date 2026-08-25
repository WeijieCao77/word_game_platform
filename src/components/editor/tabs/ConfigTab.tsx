"use client";

// 配置页签：游戏的底层 JSON，给愿意手动调的作者用（AI 改配置也落在这份数据上）。
// 两步生效——「应用」把文本解析进内存并刷新预览，「保存」才写库；
// 「还原为当前」丢弃文本框里的改动。改按钮行为 → 在 page.tsx 的对应回调。

export default function ConfigTab({
  configText,
  onConfigText,
  onApply,
  onRevert,
}: {
  configText: string;
  onConfigText: (value: string) => void;
  onApply: () => void;
  onRevert: () => void;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="pane-note" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span>底层配置（JSON）。改完点「应用」生效，再「保存」入库。</span>
        <button className="btn small secondary" onClick={onApply}>
          应用
        </button>
        <button className="btn small secondary" onClick={onRevert}>
          还原为当前
        </button>
      </div>
      <textarea
        className="config-editor"
        style={{ flex: 1 }}
        value={configText}
        onChange={(e) => onConfigText(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
