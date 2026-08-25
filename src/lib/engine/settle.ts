// sim 回合管线：结算（数据行 → compute → outcomes → 归因快照）、成长曲线、周期滚动、endTurn 主流程。
// 想改「一个回合结束时按什么顺序发生什么」「为什么是这个结果面板的数据」「赛季怎么翻篇」，来这里。
// continueAfterResolution 是选择/输入结算完后把这条管线接着跑完的入口，choices.ts 与 input.ts 都会调它。

import { Value, evaluate } from "@/lib/expr";
import { GameConfig, GameState } from "@/lib/schema";
import { createRng } from "./rng";
import { Bindings, GameScope, applyEffects, clampVar, clockOf, renderText, truthy } from "./internal";
import { checkConditionEndings, timeoutEnd } from "./endings";
import { drawEventCards } from "./cards";
import { leagueTick } from "./leagues";
import { simHeader } from "./state";

/** 结束回合（sim）：结算 → 随机事件 → 曲线 → 结局检查 → 周期滚动 */
export function endTurn(config: GameConfig, input: GameState): GameState {
  if (config.driver.kind !== "sim") throw new Error("endTurn() 仅用于 sim 调度器");
  if (input.ended) return input;
  if (input.pendingCard) throw new Error("先处理当前事件的选项");
  const state = structuredClone(input);
  const rng = createRng(state.rngState);
  const scope = new GameScope(config, state, rng);
  const t = config.driver.time;
  const globalTurn = clockOf(config, state);

  // 0) 到期的待办先出结果——这周收到的回音，应该在这周的比赛之前落地
  resolvePendings(config, state, scope, globalTurn);

  // 1) 结算
  for (const s of config.settlements ?? []) {
    if (state.ended) break;
    const every = s.every ?? 1;
    if (globalTurn % every !== 0) continue;
    if (s.condition && !truthy(evaluate(s.condition, scope))) continue;
    const runIdx = state.counters?.[s.id] ?? 0;
    const row = s.data && s.data.length > 0 ? s.data[runIdx % s.data.length] : undefined;
    const locals: Record<string, Value> = {};
    for (const cp of s.compute ?? []) {
      locals[cp.id] = evaluate(cp.expr, scope.withBindings({ row, locals }));
    }
    const outScope = scope.withBindings({ row, locals });
    let firedOutcome: (typeof s.outcomes)[number] | undefined;
    let firedText: string | undefined;
    for (const o of s.outcomes) {
      if (truthy(evaluate(o.condition, outScope))) {
        firedOutcome = o;
        applyEffects(config, state, outScope, o.effects, {});
        if (o.text) {
          firedText = renderText(o.text, outScope);
          state.log.push({ kind: "settlement", text: firedText, turn: state.turn });
        }
        break;
      }
    }
    // 归因快照：把结算的中间量留给「为什么是这个结果」面板
    if ((s.compute?.length ?? 0) > 0 || row) {
      const numLocals: Record<string, number> = {};
      for (const [k, v] of Object.entries(locals)) if (typeof v === "number") numLocals[k] = Math.round(v * 10) / 10;
      if (!state.lastSettlements) state.lastSettlements = {};
      state.lastSettlements[s.id] = { name: s.name, row, locals: numLocals, text: firedText };
    }
    // 活联赛：玩家场次记账（对手镜像）+ 同轮 NPC 互赛
    if (firedOutcome?.leagueResult) {
      const league = (config.leagues ?? []).find((lg) => lg.settlement === s.id);
      if (league) {
        const oppName = row?.[league.opponentKey ?? "名称"];
        leagueTick(state, league, rng, firedOutcome.leagueResult, typeof oppName === "string" ? oppName : undefined);
      }
    }
    if (!state.counters) state.counters = {};
    state.counters[s.id] = runIdx + 1;
    checkConditionEndings(config, state, scope);
  }

  // 2) 随机事件
  if (!state.ended && !state.pendingCard) {
    drawEventCards(config, state, scope, rng, config.driver.drawsPerTurn ?? 1);
  }

  // 3) 回合曲线
  if (!state.ended && !state.pendingCard) {
    runCurves(config, state, scope, "turn");
  }

  // 4) 结局检查（在周期滚动之前，让 "turn == turnsPerCycle && 积分 >= X" 生效）
  if (!state.pendingCard && !state.ended) {
    checkConditionEndings(config, state, scope);
  }

  // 5) 周期滚动与时间上限
  if (!state.pendingCard && !state.ended) {
    advanceSimTime(config, state, scope);
  }

  state.rngState = rng.state();
  return state;
}

/**
 * 结算到期的待办。
 *
 * 「发出去要等回音」这件事，经理类游戏里到处都是：转会报价、赞助洽谈、招聘邀约、
 * 跳槽求职。它们的共同形状是「现在做个动作，过几回合才知道结果」——压扁成
 * 当场结算就没有了等待的张力，也没有了「同时押好几件事」的经营感。
 */
function resolvePendings(config: GameConfig, state: GameState, scope: GameScope, globalTurn: number): void {
  if (!state.pendings?.length) return;
  const due = state.pendings.filter((p) => p.dueTurn <= globalTurn);
  if (due.length === 0) return;
  state.pendings = state.pendings.filter((p) => p.dueTurn > globalTurn);
  for (const item of due) {
    if (state.ended) break;
    const def = (config.pendings ?? []).find((d) => d.id === item.def);
    if (!def) continue;
    const bindings: Bindings = item.target ? { target: item.target, self: item.target } : {};
    const pScope = scope.withBindings(bindings);
    for (const o of def.outcomes) {
      if (!truthy(evaluate(o.condition, pScope))) continue;
      applyEffects(config, state, pScope, o.effects, bindings);
      if (o.text) state.log.push({ kind: "settlement", text: renderText(o.text, pScope), turn: state.turn });
      break;
    }
    checkConditionEndings(config, state, scope);
  }
}

function runCurves(config: GameConfig, state: GameState, scope: GameScope, phase: "turn" | "cycle"): void {
  for (const curve of config.curves ?? []) {
    if (curve.phase !== phase) continue;
    for (const e of config.entities ?? []) {
      if (e.type !== curve.entityType || !state.entities?.[e.id]) continue;
      const bindings: Bindings = { self: e.id };
      const entScope = scope.withBindings(bindings);
      if (curve.condition && !truthy(evaluate(curve.condition, entScope))) continue;
      applyEffects(config, state, entScope, curve.effects, bindings);
      if (curve.text) state.log.push({ kind: "card", text: renderText(curve.text, entScope), turn: state.turn });
    }
  }
}

function advanceSimTime(config: GameConfig, state: GameState, scope: GameScope): void {
  if (config.driver.kind !== "sim") return;
  const t = config.driver.time;
  const cycleDone = t.turnsPerCycle !== undefined && state.turn >= t.turnsPerCycle;
  if (cycleDone) {
    runCurves(config, state, scope, "cycle");
    if (config.text?.cycleEnd) {
      state.log.push({ kind: "settlement", text: renderText(config.text.cycleEnd, scope), turn: state.turn });
    }
    // 周期结束后的曲线效果也可能触发结局
    if (checkConditionEndings(config, state, scope)) return;
    state.cycle = (state.cycle ?? 1) + 1;
    state.turn = 1;
    for (const v of config.vars) {
      if (v.resetEachCycle) state.vars[v.id] = clampVar(config, v.id, v.initial);
    }
    for (const lg of config.leagues ?? []) {
      if (lg.resetEachCycle !== false && state.leagues?.[lg.id]) delete state.leagues[lg.id];
    }
    // maxCycles 不填 = 开放式生涯，永远不会因为「打完」而结束
    if (t.maxCycles !== undefined && state.cycle > t.maxCycles) {
      timeoutEnd(config, state, scope, "落幕");
      return;
    }
  } else {
    state.turn += 1;
    if (t.turnsPerCycle === undefined && t.maxCycles !== undefined && state.turn > t.maxCycles) {
      timeoutEnd(config, state, scope, "落幕");
      return;
    }
  }
  state.actionsUsed = {};
  if (config.driver.kind === "sim" && config.driver.actionPoints !== undefined) {
    state.apLeft = config.driver.actionPoints;
  }
  state.log.push({ kind: "header", text: simHeader(config, state, scope), turn: state.turn });
}

/** 选择/输入结算后的收尾管线：条件结局 → life 时间上限 → sim 回合剩余管线 */
export function continueAfterResolution(config: GameConfig, state: GameState, baseScope: GameScope, renderScope: GameScope): void {
  if (!state.pendingCard && !state.ended) {
    checkConditionEndings(config, state, baseScope);
    if (config.driver.kind === "life" && !state.ended && (state.time ?? 0) >= config.driver.time.max) {
      timeoutEnd(config, state, renderScope, "岁月尽头");
    }
    // sim：事件处理完后继续走完本回合剩余管线
    if (config.driver.kind === "sim" && !state.ended) {
      runCurves(config, state, baseScope, "turn");
      checkConditionEndings(config, state, baseScope);
      if (!state.ended) advanceSimTime(config, state, baseScope);
    }
  }
}

/** 本回合将要运行的带数据结算的下一行（"下一场预告"面板用） */
export function upcomingRows(
  config: GameConfig,
  state: GameState
): { settlement: string; row: Record<string, number | string> }[] {
  if (config.driver.kind !== "sim" || state.ended) return [];
  const rng = createRng(state.rngState);
  const scope = new GameScope(config, state, rng);
  const globalTurn = clockOf(config, state);
  const out: { settlement: string; row: Record<string, number | string> }[] = [];
  for (const s of config.settlements ?? []) {
    if (!s.data || s.data.length === 0) continue;
    if (globalTurn % (s.every ?? 1) !== 0) continue;
    try {
      if (s.condition && !truthy(evaluate(s.condition, scope))) continue;
    } catch {
      continue;
    }
    const runIdx = state.counters?.[s.id] ?? 0;
    out.push({ settlement: s.name, row: s.data[runIdx % s.data.length] });
  }
  return out;
}
