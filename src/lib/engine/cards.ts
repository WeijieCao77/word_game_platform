// 卡片：可用选项过滤、textVariants 反重复轮换、goto 链解析（resolveCard）、权重随机抽卡（drawEventCards）。
// 想改「一张卡触发时发生什么」「随机事件怎么挑」「冷却/once/实体事件的筛选规则」，来这里。
// life 与 sim 共用同一套抽卡逻辑；停牌（pendingCard）只在这里产生，后续由 choices/input 接手。

import { evaluate } from "@/lib/expr";
import { CardDef, ChoiceDef, GameConfig, GameState } from "@/lib/schema";
import { Rng } from "./rng";
import { Bindings, GameScope, applyEffects, clockOf, renderText, truthy } from "./internal";
import { endGame, timeoutEnd } from "./endings";

const CHAIN_LIMIT = 32;
const DEFAULT_COOLDOWN = 2;

export function availableChoicesOf(card: CardDef, scope: GameScope): ChoiceDef[] {
  return (card.choices ?? []).filter((ch) => !ch.condition || truthy(evaluate(ch.condition, scope)));
}

/**
 * 反重复文案变体：从 [text, ...textVariants] 中确定性轮转挑选。
 * 起点由 (seed, 卡片id) 决定、每次触发前进一格——同一张卡连续两次触发必不同文案，
 * 且完全可复现（不消耗随机流，不影响既有存档回放）。
 */
function pickCardText(card: CardDef, state: GameState): string {
  const variants = card.textVariants;
  if (!variants || variants.length === 0) return card.text;
  const pool = [card.text, ...variants];
  let h = 0;
  const key = `${state.seed}:${card.id}`;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return pool[(h + (state.fired[card.id] ?? 1)) % pool.length];
}

/** 触发一张卡，沿 goto 链执行到需要选择、触发结局或链条终止。scopeEntity 为实体事件的 self 绑定。 */
export function resolveCard(config: GameConfig, state: GameState, scope: GameScope, startId: string, scopeEntity?: string): void {
  let id: string | undefined = startId;
  let depth = 0;
  while (id) {
    if (++depth > CHAIN_LIMIT) throw new Error(`卡片链过长（超过 ${CHAIN_LIMIT} 张，可能存在 goto 循环）`);
    const card = config.cards.find((c) => c.id === id);
    if (!card) throw new Error(`卡片 "${id}" 不存在`);
    const bindings: Bindings = scopeEntity ? { self: scopeEntity } : {};
    const cardScope = scope.withBindings(bindings);
    state.fired[card.id] = (state.fired[card.id] ?? 0) + 1;
    if (!state.lastFired) state.lastFired = {};
    state.lastFired[card.id] = clockOf(config, state);
    if (config.driver.kind !== "sim") state.turn += 1;
    applyEffects(config, state, cardScope, card.effects, bindings);
    state.log.push({
      kind: "card",
      text: renderText(pickCardText(card, state), cardScope),
      turn: state.turn,
      ...(card.image ? { image: card.image } : {}),
    });
    if (card.ending) {
      endGame(config, state, cardScope, card.ending);
      return;
    }
    const choices = availableChoicesOf(card, cardScope);
    if (choices.length > 0 || (card.input && card.input.answers.length > 0)) {
      // 有选项或关键词输入门：停牌等待玩家
      state.pendingCard = card.id;
      state.pendingEntity = scopeEntity;
      return;
    }
    id = card.goto;
  }
  if (config.driver.kind === "story" && !state.ended) {
    timeoutEnd(config, state, scope);
  }
}

/** 随机池抽卡（life 与 sim 共用）：权重 + 条件 + once + 冷却；实体事件需存在合格实体 */
export function drawEventCards(config: GameConfig, state: GameState, scope: GameScope, rng: Rng, draws: number): void {
  const lastFired = state.lastFired ?? {};
  const clock = clockOf(config, state);
  const offCooldown = (c: CardDef): boolean => {
    const last = Object.prototype.hasOwnProperty.call(lastFired, c.id) ? lastFired[c.id] : undefined;
    if (last === undefined) return true;
    return clock - last >= (c.cooldown ?? DEFAULT_COOLDOWN);
  };
  const scopeCandidates = (c: CardDef): string[] => {
    if (!c.scope) return [];
    const typeId = c.scope.entityType;
    return (config.entities ?? [])
      .filter((e) => e.type === typeId && state.entities?.[e.id])
      .filter((e) => {
        if (!c.scope!.condition) return true;
        return truthy(evaluate(c.scope!.condition, scope.withBindings({ self: e.id })));
      })
      .map((e) => e.id);
  };

  for (let d = 0; d < draws; d++) {
    if (state.ended || state.pendingCard) break;
    const eligible = config.cards
      .filter((c) => (c.weight ?? 0) > 0)
      .filter((c) => !(c.once && (state.fired[c.id] ?? 0) > 0))
      .filter((c) => !c.condition || truthy(evaluate(c.condition, scope)))
      .filter((c) => !c.scope || scopeCandidates(c).length > 0);
    const cooled = eligible.filter(offCooldown);
    const pool = cooled.length > 0 ? cooled : eligible;
    if (pool.length === 0) break;
    const total = pool.reduce((s, c) => s + (c.weight ?? 0), 0);
    let r = rng.next() * total;
    let picked = pool[pool.length - 1];
    for (const c of pool) {
      r -= c.weight ?? 0;
      if (r <= 0) {
        picked = c;
        break;
      }
    }
    let entity: string | undefined;
    if (picked.scope) {
      const candidates = scopeCandidates(picked);
      entity = candidates[rng.int(0, candidates.length - 1)];
    }
    resolveCard(config, state, scope, picked.id, entity);
  }
}
