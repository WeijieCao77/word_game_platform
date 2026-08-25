// 选项：当前待选卡有哪些可选项（pendingChoices）、玩家选了之后怎么结算（choose）。
// 想改「选项条件怎么判、选完先做什么后做什么、选完接哪条管线」，来这里。
// 三个调度器共用这一份 choose；选项本身的过滤规则在 cards.ts 的 availableChoicesOf。

import { GameConfig, GameState } from "@/lib/schema";
import { createRng } from "./rng";
import { Bindings, GameScope, applyEffects, renderText } from "./internal";
import { endGame, timeoutEnd } from "./endings";
import { availableChoicesOf, resolveCard } from "./cards";
import { continueAfterResolution } from "./settle";

/** 在待选卡上做出选择（三种调度器共用） */
export function choose(config: GameConfig, input: GameState, choiceId: string): GameState {
  if (input.ended) return input;
  if (!input.pendingCard) throw new Error("当前没有待选择的卡片");
  const state = structuredClone(input);
  const rng = createRng(state.rngState);
  const baseScope = new GameScope(config, state, rng);
  const bindings: Bindings = state.pendingEntity ? { self: state.pendingEntity } : {};
  const scope = baseScope.withBindings(bindings);
  const card = config.cards.find((c) => c.id === state.pendingCard)!;
  const choice = availableChoicesOf(card, scope).find((ch) => ch.id === choiceId);
  if (!choice) throw new Error(`选项 "${choiceId}" 不可用`);

  const scopeEntity = state.pendingEntity;
  state.pendingCard = undefined;
  state.pendingEntity = undefined;
  state.log.push({ kind: "choice", text: `▸ ${renderText(choice.label, scope)}`, turn: state.turn });
  applyEffects(config, state, scope, choice.effects, bindings);
  if (choice.text) state.log.push({ kind: "card", text: renderText(choice.text, scope), turn: state.turn });

  if (choice.ending) {
    endGame(config, state, scope, choice.ending);
  } else if (choice.goto) {
    resolveCard(config, state, baseScope, choice.goto, scopeEntity);
  } else if (config.driver.kind === "story") {
    timeoutEnd(config, state, scope);
  }

  continueAfterResolution(config, state, baseScope, scope);
  state.rngState = rng.state();
  return state;
}

/** 当前待选卡的可用选项（渲染后的 label） */
export function pendingChoices(config: GameConfig, state: GameState): { id: string; label: string }[] {
  if (!state.pendingCard || state.ended) return [];
  const rng = createRng(state.rngState);
  const scope = new GameScope(config, state, rng).withBindings(
    state.pendingEntity ? { self: state.pendingEntity } : {}
  );
  const card = config.cards.find((c) => c.id === state.pendingCard);
  if (!card) return [];
  return availableChoicesOf(card, scope).map((ch) => ({ id: ch.id, label: renderText(ch.label, scope) }));
}
