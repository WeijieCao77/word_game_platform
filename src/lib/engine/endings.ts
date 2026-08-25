// 结局：具名结局落地（endGame）、没写结局时的兜底收尾（implicitEnd）、条件结局判定（checkConditionEndings）。
// 想改「什么时候算通关」「结局文案怎么落进日志」「多个结局同时命中谁优先」，来这里。
// 三个调度器都在自己的管线里调 checkConditionEndings，判定规则只此一份。

import { evaluate } from "@/lib/expr";
import { GameConfig, GameState } from "@/lib/schema";
import { GameScope, renderText, truthy } from "./internal";

export function endGame(config: GameConfig, state: GameState, scope: GameScope, endingId: string): void {
  const ending = config.endings.find((e) => e.id === endingId);
  if (!ending) throw new Error(`结局 "${endingId}" 不存在`);
  state.ended = {
    endingId: ending.id,
    title: renderText(ending.title, scope),
    kind: ending.kind,
    text: ending.text ? renderText(ending.text, scope) : undefined,
  };
  state.pendingCard = undefined;
  state.pendingEntity = undefined;
  state.log.push({
    kind: "ending",
    text: state.ended.text ? `【${state.ended.title}】${state.ended.text}` : `【${state.ended.title}】`,
    turn: state.turn,
  });
}

export const DEFAULT_END: { title: string; kind: "neutral" } = { title: "完", kind: "neutral" };

/**
 * 没有具名结局命中时的兜底收尾（时间到、story 走到头）。
 * 标题与文案都走 {} 插值——作者常在兜底文案里写「修为 {修为}」这种收束语。
 * fallbackTitle 是作者没写 timeoutEnding.title 时的语境默认值（岁月尽头 / 落幕 / 完）。
 */
export function timeoutEnd(
  config: GameConfig,
  state: GameState,
  scope: GameScope,
  fallbackTitle: string = DEFAULT_END.title
): void {
  const te = config.text?.timeoutEnding;
  implicitEnd(
    state,
    te?.title ? renderText(te.title, scope) : fallbackTitle,
    te?.text ? renderText(te.text, scope) : undefined
  );
}

export function implicitEnd(state: GameState, title: string, text?: string): void {
  state.ended = { endingId: "__implicit__", title, kind: DEFAULT_END.kind, text };
  state.pendingCard = undefined;
  state.pendingEntity = undefined;
  state.log.push({ kind: "ending", text: `【${title}】${text ?? ""}`, turn: state.turn });
}

export function checkConditionEndings(config: GameConfig, state: GameState, scope: GameScope): boolean {
  if (state.ended) return true;
  const hits = config.endings
    .filter((e) => e.condition && truthy(evaluate(e.condition, scope)))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  if (hits.length > 0) {
    endGame(config, state, scope, hits[0].id);
    return true;
  }
  return false;
}
