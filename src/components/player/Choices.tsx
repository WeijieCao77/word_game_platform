"use client";

import { useState } from "react";
import { GameConfig, GameState } from "@/lib/schema";
import { choose, pendingInput, submitInput } from "@/lib/engine";

// 玩家的抉择区：普通选项按钮，以及「关键词输入门」——
// 有些卡片不给选项，要玩家自己把想到的词打出来才推进（MISSING 式）。

export function ChoiceControls({
  config,
  state,
  choices,
  inputGate,
  act,
}: {
  config: GameConfig;
  state: GameState;
  choices: { id: string; label: string }[];
  inputGate: ReturnType<typeof pendingInput>;
  act: (fn: () => GameState) => void;
}): React.ReactElement {
  const [kwText, setKwText] = useState("");
  return (
    <>
      {choices.map((c) => (
        <button key={c.id} className="choice-btn" onClick={() => act(() => choose(config, state, c.id))}>
          {c.label}
        </button>
      ))}
      {inputGate && (
        <form
          className="kw-gate"
          onSubmit={(e) => {
            e.preventDefault();
            const t = kwText.trim();
            if (!t) return;
            setKwText("");
            act(() => submitInput(config, state, t));
          }}
        >
          <input
            type="text"
            value={kwText}
            placeholder={inputGate.prompt}
            maxLength={40}
            onChange={(e) => setKwText(e.target.value)}
          />
          <button className="btn small" type="submit" disabled={!kwText.trim()}>
            检索
          </button>
        </form>
      )}
    </>
  );
}
