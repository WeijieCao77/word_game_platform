// 关键词玩法：卡面上的输入门（pendingInput/submitInput）、随时可用的全局检索台（searchKeyword）、档案夹（notebookItems）。
// 想改「输错了怎么回应」「检索命中的线索什么时候只生效一次」「档案夹显示哪些条目」，来这里。
// 输入的归一化匹配走 @/lib/keyword，和校验器查重用的是同一份规则。

import { evaluate } from "@/lib/expr";
import { GameConfig, GameState } from "@/lib/schema";
import { normalizeKeyword } from "@/lib/keyword";
import { createRng } from "./rng";
import { Bindings, GameScope, applyEffects, renderText, truthy } from "./internal";
import { DEFAULT_END, checkConditionEndings, endGame, implicitEnd } from "./endings";
import { resolveCard } from "./cards";
import { continueAfterResolution } from "./settle";

/** 当前待选卡的关键词输入门（渲染后的提示语）；没有则 null */
export function pendingInput(config: GameConfig, state: GameState): { prompt: string } | null {
  if (!state.pendingCard || state.ended) return null;
  const card = config.cards.find((c) => c.id === state.pendingCard);
  if (!card?.input || card.input.answers.length === 0) return null;
  const rng = createRng(state.rngState);
  const scope = new GameScope(config, state, rng).withBindings(
    state.pendingEntity ? { self: state.pendingEntity } : {}
  );
  return { prompt: renderText(card.input.prompt ?? "输入关键词检索", scope) };
}

/**
 * 在带关键词输入门的待选卡上提交输入（MISSING 式调查玩法）。
 * 命中答案按选项语义结算；未命中记录一次无果检索，停留在原卡上。
 */
export function submitInput(config: GameConfig, input: GameState, textRaw: string): GameState {
  if (input.ended) return input;
  if (!input.pendingCard) throw new Error("当前没有待输入的卡片");
  const typed = normalizeKeyword(textRaw);
  if (!typed) return input;
  const state = structuredClone(input);
  const rng = createRng(state.rngState);
  const baseScope = new GameScope(config, state, rng);
  const bindings: Bindings = state.pendingEntity ? { self: state.pendingEntity } : {};
  const scope = baseScope.withBindings(bindings);
  const card = config.cards.find((c) => c.id === state.pendingCard)!;
  if (!card.input || card.input.answers.length === 0) throw new Error("这张卡没有输入框");

  const hit = card.input.answers.find(
    (a) =>
      (!a.condition || truthy(evaluate(a.condition, scope))) &&
      a.keywords.some((k) => normalizeKeyword(k) === typed)
  );
  const shown = textRaw.trim().slice(0, 40);
  if (!hit) {
    state.log.push({ kind: "choice", text: `▸ 检索「${shown}」`, turn: state.turn });
    state.log.push({
      kind: "card",
      text: renderText(card.input.fallbackText ?? "没有查到相关结果。", scope),
      turn: state.turn,
    });
    state.rngState = rng.state();
    return state;
  }

  const scopeEntity = state.pendingEntity;
  state.pendingCard = undefined;
  state.pendingEntity = undefined;
  state.log.push({ kind: "choice", text: `▸ 检索「${shown}」`, turn: state.turn });
  applyEffects(config, state, scope, hit.effects, bindings);
  if (hit.text) state.log.push({ kind: "card", text: renderText(hit.text, scope), turn: state.turn });

  if (hit.ending) {
    endGame(config, state, scope, hit.ending);
  } else if (hit.goto) {
    resolveCard(config, state, baseScope, hit.goto, scopeEntity);
  } else if (config.driver.kind === "story") {
    implicitEnd(state, config.text?.timeoutEnding?.title ?? DEFAULT_END.title, config.text?.timeoutEnding?.text);
  }

  continueAfterResolution(config, state, baseScope, scope);
  state.rngState = rng.state();
  return state;
}

/**
 * 全局检索台：随时输入关键词查档案（有 pendingCard 时也可用——查到的线索
 * 立即生效，待选卡的条件选项会随之刷新）。效果只在词条首次命中时生效。
 */
export function searchKeyword(config: GameConfig, input: GameState, textRaw: string): GameState {
  if (!config.search || config.search.entries.length === 0) throw new Error("这个游戏没有检索台");
  if (input.ended) return input;
  const typed = normalizeKeyword(textRaw);
  if (!typed) return input;
  const state = structuredClone(input);
  const rng = createRng(state.rngState);
  const baseScope = new GameScope(config, state, rng);
  const bindings: Bindings = state.pendingEntity ? { self: state.pendingEntity } : {};
  const scope = baseScope.withBindings(bindings);
  const shown = textRaw.trim().slice(0, 40);
  const hit = config.search.entries.find(
    (e) =>
      (!e.condition || truthy(evaluate(e.condition, scope))) &&
      e.keywords.some((k) => normalizeKeyword(k) === typed)
  );
  state.log.push({ kind: "choice", text: `🔎 检索「${shown}」`, turn: state.turn });
  if (!hit) {
    state.log.push({
      kind: "card",
      text: renderText(config.search.fallbackText ?? "没有查到相关结果。", scope),
      turn: state.turn,
    });
    state.rngState = rng.state();
    return state;
  }
  const seen = state.searched?.[hit.id] ?? 0;
  if (seen === 0) applyEffects(config, state, scope, hit.effects, bindings);
  if (!state.searched) state.searched = {};
  state.searched[hit.id] = seen + 1;
  state.log.push({
    kind: "card",
    text: renderText(hit.text, scope),
    turn: state.turn,
    ...(hit.image ? { image: hit.image } : {}),
  });
  // 检索解锁的线索可能直接满足结局条件（如「找齐全部真相」）
  if (!state.pendingCard) checkConditionEndings(config, state, baseScope);
  state.rngState = rng.state();
  return state;
}

/** 档案夹：当前可翻看的条目（纯查询，不改状态；条件里禁用随机函数由校验器把关） */
export function notebookItems(
  config: GameConfig,
  state: GameState
): { id: string; name: string; category: string; text: string; image?: string }[] {
  if (!config.notebook || config.notebook.items.length === 0) return [];
  const rng = createRng(state.rngState);
  const scope = new GameScope(config, state, rng).withBindings(
    state.pendingEntity ? { self: state.pendingEntity } : {}
  );
  const out: { id: string; name: string; category: string; text: string; image?: string }[] = [];
  for (const item of config.notebook.items) {
    try {
      if (item.condition && !truthy(evaluate(item.condition, scope))) continue;
      out.push({
        id: item.id,
        name: renderText(item.name, scope),
        category: item.category ?? "档案",
        text: renderText(item.text, scope),
        image: item.image,
      });
    } catch {
      // 单条渲染失败不拖垮整个档案夹
    }
  }
  return out;
}
