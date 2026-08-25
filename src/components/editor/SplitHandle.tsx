"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// 工作台中间那根可拖动的分隔条：想多看聊天就往右拉，想多看预览就往左拉。
// 比例记在浏览器里，下次打开还是你调的样子；双击复位。

const KEY = "wgp_editor_split";
const DEFAULT_PCT = 42;
const MIN_PCT = 22;
const MAX_PCT = 72;

export function useSplit(): {
  pct: number;
  onPointerDown: (e: React.PointerEvent) => void;
  reset: () => void;
  nudge: (delta: number) => void;
  dragging: boolean;
} {
  const [pct, setPct] = useState(DEFAULT_PCT);
  const [dragging, setDragging] = useState(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (saved >= MIN_PCT && saved <= MAX_PCT) setPct(saved);
    } catch {
      /* 隐私模式下用默认值 */
    }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent): void => {
    const handle = e.currentTarget as HTMLElement;
    const main = handle.parentElement;
    if (!main) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    document.body.classList.add("splitting");

    const move = (ev: PointerEvent): void => {
      if (frame.current !== null) return; // 每帧最多算一次，拖起来不卡
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const rect = main.getBoundingClientRect();
        if (rect.width === 0) return;
        const next = ((ev.clientX - rect.left) / rect.width) * 100;
        setPct(Math.min(MAX_PCT, Math.max(MIN_PCT, next)));
      });
    };
    const up = (): void => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDragging(false);
      document.body.classList.remove("splitting");
      setPct((v) => {
        try {
          localStorage.setItem(KEY, String(Math.round(v)));
        } catch {
          /* 存不下也不影响本次使用 */
        }
        return v;
      });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }, []);

  const reset = useCallback((): void => {
    setPct(DEFAULT_PCT);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* 忽略 */
    }
  }, []);

  const nudge = useCallback((delta: number): void => {
    setPct((v) => {
      const next = Math.min(MAX_PCT, Math.max(MIN_PCT, v + delta));
      try {
        localStorage.setItem(KEY, String(Math.round(next)));
      } catch {
        /* 忽略 */
      }
      return next;
    });
  }, []);

  return { pct, onPointerDown, reset, nudge, dragging };
}

export default function SplitHandle({
  pct,
  dragging,
  onPointerDown,
  onReset,
  onNudge,
}: {
  pct: number;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onReset: () => void;
  onNudge: (delta: number) => void;
}): React.ReactElement {
  return (
    <div
      className={`split-handle${dragging ? " dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(pct)}
      aria-label="拖动调整对话区与工作区的宽度，双击复位"
      title="拖动调整左右宽度 · 双击复位"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        // 键盘也能调：左右方向键各 2%
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          onNudge(e.key === "ArrowLeft" ? -2 : 2);
        }
      }}
    >
      <span className="split-grip" aria-hidden />
    </div>
  );
}
