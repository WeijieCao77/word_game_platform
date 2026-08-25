"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// 分步引导（聚光灯式）：遮罩挖洞框出目标区域 + 气泡讲解 + 下一步。
// 通用组件——工作台、播放器都能用，只要传一组步骤。

export interface TourStep {
  /** 要框出的元素 CSS 选择器；不填则显示为居中卡片（开场白/结束语） */
  target?: string;
  title: string;
  body: string;
  /** 进入这一步前的准备动作，例如切换到对应页签 */
  onEnter?: () => void;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
const POP_W = 330;

export default function Tour({
  steps,
  open,
  onClose,
}: {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
}): React.ReactElement | null {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  const measure = useCallback((): void => {
    const step = stepsRef.current[i];
    if (!step?.target) {
      setBox(null);
      return;
    }
    const el = document.querySelector(step.target);
    if (!el) {
      setBox(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      setBox(null);
      return;
    }
    setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [i]);

  // 进入某一步：先跑 onEnter（可能切页签），等重绘后再量目标位置，量不到就重试几帧
  useEffect(() => {
    if (!open) return;
    const step = stepsRef.current[i];
    step?.onEnter?.();
    let raf = 0;
    let tries = 0;
    const tick = (): void => {
      const target = step?.target;
      const el = target ? document.querySelector(target) : null;
      if (target && !el && tries++ < 40) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      measure();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, i, measure]);

  useEffect(() => {
    if (!open) return;
    const onChange = (): void => measure();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [open, measure]);

  const next = useCallback((): void => {
    setI((v) => {
      if (v >= stepsRef.current.length - 1) {
        onClose();
        return v;
      }
      return v + 1;
    });
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, onClose]);

  if (!open) return null;
  const step = steps[i];
  if (!step) return null;

  // 气泡放在高亮框下方；下方装不下就放上方，再不行就贴着视口居中
  let popStyle: React.CSSProperties = {
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
  };
  if (box) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampLeft = (v: number): number => Math.min(Math.max(12, v), Math.max(12, vw - POP_W - 12));
    const below = box.top + box.height + 12;
    const sideTop = Math.min(Math.max(12, box.top + box.height / 2 - 110), Math.max(12, vh - 240));
    if (vh - below > 190) {
      popStyle = { left: clampLeft(box.left), top: below };
    } else if (box.top > 210) {
      popStyle = { left: clampLeft(box.left), top: Math.max(12, box.top - 200) };
    } else if (vw - (box.left + box.width) > POP_W + 24) {
      // 目标很高（比如整根对话栏）：放到它右边的空白处，别去挤上下
      popStyle = { left: box.left + box.width + 12, top: sideTop };
    } else if (box.left > POP_W + 24) {
      popStyle = { left: box.left - POP_W - 12, top: sideTop };
    } else {
      popStyle = { left: clampLeft(box.left), top: Math.max(12, vh - 220) };
    }
  }

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="新手引导">
      <div className="tour-block" onClick={next} />
      {box ? (
        <div className="tour-hole" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-pop" style={popStyle}>
        <div className="tour-idx">
          {i + 1} / {steps.length}
        </div>
        <h4>{step.title}</h4>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button className="linklike" onClick={onClose}>
            跳过
          </button>
          <span className="tour-spacer" />
          {i > 0 && (
            <button className="btn small secondary" onClick={() => setI((v) => Math.max(0, v - 1))}>
              上一步
            </button>
          )}
          <button className="btn small" onClick={next}>
            {i === steps.length - 1 ? "开始创作" : "下一步"}
          </button>
        </div>
      </div>
    </div>
  );
}
