// 存档与时间：开局建档（initState）、life 调度器的时间推进（step）、sim 回合抬头、派生值读数。
// 想改「新开一局的初始状态长什么样」「life 每步先走优先卡还是抽卡」「回合抬头文案」，来这里。
// sim 的回合推进不在这里，在 settle.ts 的结算管线里（那边才知道一回合何时算走完）。

import { evaluate } from "@/lib/expr";
import { GameConfig, GameState } from "@/lib/schema";
import { createRng } from "./rng";
import { GameScope, clampVar, formatNumber, renderText, truthy } from "./internal";
import { checkConditionEndings, timeoutEnd } from "./endings";
import { drawEventCards, resolveCard } from "./cards";

// ---------------- 初始化 ----------------

export function initState(config: GameConfig, seed: number): GameState {
  const rng = createRng(seed);
  const state: GameState = {
    turn: 0,
    time: config.driver.kind === "life" ? config.driver.time.start : undefined,
    cycle: config.driver.kind === "sim" ? 1 : undefined,
    vars: Object.fromEntries(config.vars.map((v) => [v.id, clampVar(config, v.id, v.initial)])),
    entities:
      config.driver.kind === "sim"
        ? Object.fromEntries(
            (config.entities ?? []).map((e) => [e.id, { attrs: { ...e.attrs }, tags: [...(e.tags ?? [])] }])
          )
        : undefined,
    actionsUsed: config.driver.kind === "sim" ? {} : undefined,
    counters: config.driver.kind === "sim" ? {} : undefined,
    fired: {},
    lastFired: {},
    log: [],
    seed,
    rngState: rng.state(),
  };
  const scope = new GameScope(config, state, rng);
  if (config.meta.intro) {
    state.log.push({ kind: "intro", text: renderText(config.meta.intro, scope), turn: 0 });
  }
  if (config.driver.kind === "story") {
    resolveCard(config, state, scope, config.driver.startCard);
  }
  if (config.driver.kind === "sim") {
    state.turn = 1;
    if (config.driver.actionPoints !== undefined) state.apLeft = config.driver.actionPoints;
    state.log.push({ kind: "header", text: simHeader(config, state, scope), turn: state.turn });
  }
  state.rngState = rng.state();
  return state;
}

export function simHeader(config: GameConfig, state: GameState, scope: GameScope): string {
  if (config.text?.turnHeader) return renderText(config.text.turnHeader, scope);
  const t = config.driver.kind === "sim" ? config.driver.time : null;
  if (!t) return "";
  if (t.cycleLabel && t.turnsPerCycle) {
    return `第 ${state.cycle} ${t.cycleLabel} · 第 ${state.turn} ${t.turnLabel}`;
  }
  return `第 ${state.turn} ${t.turnLabel}`;
}

// ---------------- life ----------------

/** life 调度器：推进一个时间步 */
export function step(config: GameConfig, input: GameState): GameState {
  if (config.driver.kind !== "life") throw new Error("step() 仅用于 life 调度器");
  if (input.ended) return input;
  if (input.pendingCard) throw new Error("有待选择的选项，不能推进时间");
  const state = structuredClone(input);
  const rng = createRng(state.rngState);
  const scope = new GameScope(config, state, rng);
  const t = config.driver.time;

  state.time = (state.time ?? t.start) + t.step;
  const header = config.text?.turnHeader
    ? renderText(config.text.turnHeader, scope)
    : `${formatNumber(state.time)} ${t.label}`;
  state.log.push({ kind: "header", text: header, turn: state.turn });

  const eligiblePriority = config.cards
    .filter((c) => c.priority !== undefined)
    .filter((c) => !(c.once && (state.fired[c.id] ?? 0) > 0))
    .filter((c) => !c.condition || truthy(evaluate(c.condition, scope)))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  if (eligiblePriority.length > 0) {
    resolveCard(config, state, scope, eligiblePriority[0].id);
  } else {
    drawEventCards(config, state, scope, rng, config.driver.drawsPerTurn ?? 1);
  }

  if (!state.pendingCard && !state.ended) {
    checkConditionEndings(config, state, scope);
  }
  if (!state.pendingCard && !state.ended && state.time >= t.max) {
    timeoutEnd(config, state, scope, "岁月尽头");
  }
  state.rngState = rng.state();
  return state;
}

/** 可见派生值的当前数值（状态栏渲染用） */
export function derivedValues(config: GameConfig, state: GameState): { id: string; name: string; value: number }[] {
  const rng = createRng(state.rngState);
  const scope = new GameScope(config, state, rng);
  const out: { id: string; name: string; value: number }[] = [];
  for (const d of config.derived ?? []) {
    if (d.visible === false) continue;
    try {
      const v = evaluate(d.expr, scope);
      if (typeof v === "number") out.push({ id: d.id, name: d.name, value: Math.round(v * 10) / 10 });
    } catch {
      // 求值失败的派生值不展示
    }
  }
  return out;
}
