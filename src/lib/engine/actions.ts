// sim 主动决策：操作面板要显示的可用状态（availableActions）、合法目标（eligibleTargets）、执行一次决策（performAction）。
// 想改「行动点怎么扣」「按钮为什么灰着、灰着时提示什么」「决策生效后立刻检查什么」，来这里。
// 这里只管玩家在回合内的主动操作；点「结束回合」之后的事归 settle.ts。

import { evaluate } from "@/lib/expr";
import { GameConfig, GameState } from "@/lib/schema";
import { createRng } from "./rng";
import { Bindings, GameScope, applyEffects, renderText, truthy } from "./internal";
import { checkConditionEndings } from "./endings";

export interface ActionView {
  id: string;
  name: string;
  description?: string;
  available: boolean;
  reason?: string;
  usesLeft: number | null;
  needsTarget: boolean;
  /** 行动点消耗（driver.actionPoints 启用时有意义），默认 1 */
  cost: number;
}

/** 当前回合各决策的可用状态（渲染操作面板用） */
export function availableActions(config: GameConfig, state: GameState): ActionView[] {
  if (config.driver.kind !== "sim" || state.ended) return [];
  const rng = createRng(state.rngState);
  const scope = new GameScope(config, state, rng);
  const apBudget = config.driver.actionPoints;
  return (config.actions ?? []).map((a) => {
    const perTurn = a.usesPerTurn ?? 1;
    const used = state.actionsUsed?.[a.id] ?? 0;
    const usesLeft = perTurn === 0 ? null : Math.max(0, perTurn - used);
    const cost = a.cost ?? 1;
    let available = usesLeft === null || usesLeft > 0;
    let reason = available ? undefined : "本回合次数已用完";
    if (available && apBudget !== undefined && cost > (state.apLeft ?? apBudget)) {
      available = false;
      reason = `行动点不足（需 ${cost} 点）`;
    }
    if (available && a.condition) {
      try {
        available = truthy(evaluate(a.condition, scope));
        if (!available) reason = "条件未满足";
      } catch {
        available = false;
        reason = "条件求值失败";
      }
    }
    if (available && a.target && eligibleTargets(config, state, a.id).length === 0) {
      available = false;
      reason = "没有可选目标";
    }
    return { id: a.id, name: a.name, description: a.description, available, reason, usesLeft, needsTarget: !!a.target, cost };
  });
}

/** 某决策当前的合法目标实体 */
export function eligibleTargets(config: GameConfig, state: GameState, actionId: string): { id: string; name: string }[] {
  if (config.driver.kind !== "sim") return [];
  const action = config.actions?.find((a) => a.id === actionId);
  if (!action?.target) return [];
  const rng = createRng(state.rngState);
  const scope = new GameScope(config, state, rng);
  return (config.entities ?? [])
    .filter((e) => e.type === action.target!.entityType && state.entities?.[e.id])
    .filter((e) => {
      if (!action.target!.condition) return true;
      try {
        return truthy(evaluate(action.target!.condition, scope.withBindings({ self: e.id })));
      } catch {
        return false;
      }
    })
    .map((e) => ({ id: e.id, name: e.name }));
}

/** 玩家执行一个决策（sim） */
export function performAction(config: GameConfig, input: GameState, actionId: string, targetId?: string): GameState {
  if (config.driver.kind !== "sim") throw new Error("performAction() 仅用于 sim 调度器");
  if (input.ended) throw new Error("游戏已结束");
  if (input.pendingCard) throw new Error("先处理当前事件的选项");
  const action = config.actions?.find((a) => a.id === actionId);
  if (!action) throw new Error(`决策 "${actionId}" 不存在`);
  const state = structuredClone(input);
  const rng = createRng(state.rngState);
  const scope = new GameScope(config, state, rng);

  const perTurn = action.usesPerTurn ?? 1;
  const used = state.actionsUsed?.[actionId] ?? 0;
  if (perTurn > 0 && used >= perTurn) throw new Error(`「${action.name}」本回合次数已用完`);
  const apBudget = config.driver.actionPoints;
  const cost = action.cost ?? 1;
  if (apBudget !== undefined) {
    const left = state.apLeft ?? apBudget;
    if (cost > left) throw new Error(`「${action.name}」行动点不足（需 ${cost} 点，剩 ${left} 点）`);
    state.apLeft = left - cost;
  }
  if (action.condition && !truthy(evaluate(action.condition, scope))) {
    throw new Error(`「${action.name}」当前不可用`);
  }
  let bindings: Bindings = {};
  if (action.target) {
    if (!targetId) throw new Error(`「${action.name}」需要选择目标`);
    const ok = eligibleTargets(config, state, actionId).some((t) => t.id === targetId);
    if (!ok) throw new Error("目标不合法");
    bindings = { target: targetId };
  }
  const actionScope = scope.withBindings(bindings);
  applyEffects(config, state, actionScope, action.effects, bindings);
  const text = action.text ? renderText(action.text, actionScope) : `执行了「${action.name}」`;
  state.log.push({ kind: "action", text: `▸ ${text}`, turn: state.turn });
  if (!state.actionsUsed) state.actionsUsed = {};
  state.actionsUsed[actionId] = used + 1;
  // 决策也可能直接触发结局（比如把最后的资金花光）
  checkConditionEndings(config, state, scope);
  state.rngState = rng.state();
  return state;
}
