"use client";

import { useMemo, useState } from "react";
import { GameConfig, GameState } from "@/lib/schema";
import { notebookItems } from "@/lib/engine";
import { assetUrlOf } from "./util";

// 档案夹（可选模块）：已掌握的线索/人物按分类索引，点开是一张张翻看式卡片。
// 纯展示——它只读状态，不改状态，所以随时能翻。

export default function Notebook({
  config,
  state,
  gameId,
}: {
  config: GameConfig;
  state: GameState;
  gameId?: string;
}): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const items = useMemo(() => {
    if (!config.notebook) return [];
    try {
      return notebookItems(config, state);
    } catch {
      return [];
    }
  }, [config, state]);

  if (!config.notebook) return null;
  const label = config.notebook.label ?? "档案";
  return (
    <>
      <button className="notebook-fab" onClick={() => setOpen((v) => !v)} title="随时翻看已掌握的线索与档案">
        📔 {label}（{items.length}）
      </button>
      {open && (
        <div className="notebook-drawer">
          <div className="notebook-head">
            <b>{label}</b>
            <button className="linklike" onClick={() => setOpen(false)}>
              收起 ✕
            </button>
          </div>
          {items.length === 0 && <div className="pane-note">还没有掌握任何条目。</div>}
          {Array.from(new Set(items.map((n) => n.category))).map((cat) => (
            <div key={cat} className="notebook-cat">
              <div className="notebook-cat-name">{cat}</div>
              {items
                .filter((n) => n.category === cat)
                .map((n) => (
                  <details key={n.id} className="notebook-item">
                    <summary>{n.name}</summary>
                    {n.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="log-img" src={assetUrlOf(gameId, n.image)} alt="" loading="lazy" />
                    )}
                    <div className="notebook-text">{n.text}</div>
                  </details>
                ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
