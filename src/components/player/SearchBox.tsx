"use client";

import { useState } from "react";
import { GameConfig, GameState } from "@/lib/schema";
import { searchKeyword } from "@/lib/engine";

// 全局检索台（可选模块）：常驻的输入框，玩家随时把想到的词打进去查，
// 而不是等某张卡片给出选项——推理类游戏的「自己想到才算数」。

export default function SearchBox({
  config,
  state,
  act,
}: {
  config: GameConfig;
  state: GameState;
  act: (fn: () => GameState) => void;
}): React.ReactElement | null {
  const [kw, setKw] = useState("");
  if (!config.search || config.search.entries.length === 0 || state.ended) return null;
  return (
    <form
      className="kw-gate kw-global"
      onSubmit={(e) => {
        e.preventDefault();
        const t = kw.trim();
        if (!t) return;
        setKw("");
        act(() => searchKeyword(config, state, t));
      }}
    >
      <span className="kw-global-icon" aria-hidden>
        🔎
      </span>
      <input
        type="text"
        value={kw}
        placeholder={config.search.prompt ?? "输入你想到的关键词——人名、地名、事件……"}
        maxLength={40}
        onChange={(e) => setKw(e.target.value)}
      />
      <button className="btn small" type="submit" disabled={!kw.trim()}>
        {config.search.label ?? "检索"}
      </button>
    </form>
  );
}
