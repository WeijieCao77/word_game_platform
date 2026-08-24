import { ExprError, Scope, Value, evaluate, PURE_FUNCTIONS, asNumber } from "@/lib/expr";
import { CardDef, ChoiceDef, GameConfig, GameState } from "@/lib/schema";
import { Rng, createRng } from "./rng";

// 纯函数引擎：同一份配置 + 同一个种子 + 同样的操作序列 => 完全相同的过程。
// 播放器、编辑器预览、模拟器、AI 的 simulate 工具共用这一份实现。

const CHAIN_LIMIT = 32;

class GameScope implements Scope {
  constructor(
    private config: GameConfig,
    private state: GameState,
    private rng: Rng
  ) {}

  get(path: string[]): Value | undefined {
    if (path.length !== 1) return undefined;
    const key = path[0];
    if (key === "turn") return this.state.turn;
    if (key === "time") return this.state.time ?? 0;
    // hasOwnProperty：防止 "__proto__" 之类的键命中原型链
    if (Object.prototype.hasOwnProperty.call(this.state.vars, key)) return this.state.vars[key];
    return undefined;
  }

  call(name: string, args: Value[]): Value {
    const pure = PURE_FUNCTIONS[name];
    if (pure) {
      if (args.length < pure.arity[0] || args.length > pure.arity[1]) {
        throw new ExprError(`函数 ${name} 参数数量不对`);
      }
      return pure.fn(args.map((a) => asNumber(a)));
    }
    switch (name) {
      case "rand":
        return this.rng.next();
      case "randint":
        return this.rng.int(asNumber(args[0]), asNumber(args[1]));
      case "chance":
        return this.rng.next() < asNumber(args[0]) ? 1 : 0;
      case "fired": {
        if (typeof args[0] !== "string") throw new ExprError("fired() 需要卡片 id 字符串");
        const n = Object.prototype.hasOwnProperty.call(this.state.fired, args[0]) ? this.state.fired[args[0]] : 0;
        return n > 0 ? 1 : 0;
      }
      default:
        throw new ExprError(`未知函数 "${name}"`);
    }
  }
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return (Math.round(n * 10) / 10).toString();
}

function renderText(template: string, scope: GameScope): string {
  return template.replace(/\{([^{}]+)\}/g, (_, expr: string) => {
    const v = evaluate(expr, scope);
    if (typeof v === "number") return formatNumber(v);
    if (typeof v === "boolean") return v ? "1" : "0";
    return v;
  });
}

function clampVar(config: GameConfig, id: string, value: number): number {
  const def = config.vars.find((v) => v.id === id);
  if (!def) return value;
  let out = value;
  if (def.min !== undefined) out = Math.max(def.min, out);
  if (def.max !== undefined) out = Math.min(def.max, out);
  return out;
}

function applyEffects(
  config: GameConfig,
  state: GameState,
  scope: GameScope,
  effects: { ref: string; op: "add" | "set"; value: string }[] | undefined
): void {
  for (const e of effects ?? []) {
    const value = asNumber(evaluate(e.value, scope), e.value);
    const current = state.vars[e.ref] ?? 0;
    state.vars[e.ref] = clampVar(config, e.ref, e.op === "add" ? current + value : value);
  }
}

function endGame(config: GameConfig, state: GameState, scope: GameScope, endingId: string): void {
  const ending = config.endings.find((e) => e.id === endingId);
  if (!ending) throw new Error(`结局 "${endingId}" 不存在`);
  state.ended = {
    endingId: ending.id,
    title: renderText(ending.title, scope),
    kind: ending.kind,
    text: ending.text ? renderText(ending.text, scope) : undefined,
  };
  state.pendingCard = undefined;
  state.log.push({ kind: "ending", text: state.ended.text ? `【${state.ended.title}】${state.ended.text}` : `【${state.ended.title}】`, turn: state.turn });
}

const DEFAULT_END: { title: string; kind: "neutral" } = { title: "完", kind: "neutral" };

/** story 死端 / 无结局可用时的兜底 */
function implicitEnd(state: GameState, scope: GameScope, title: string, text?: string): void {
  state.ended = { endingId: "__implicit__", title, kind: DEFAULT_END.kind, text };
  state.pendingCard = undefined;
  state.log.push({ kind: "ending", text: `【${title}】${text ?? ""}`, turn: state.turn });
}

function availableChoicesOf(card: CardDef, scope: GameScope): ChoiceDef[] {
  return (card.choices ?? []).filter((ch) => !ch.condition || truthy(evaluate(ch.condition, scope)));
}

function truthy(v: Value): boolean {
  return typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : v.length > 0;
}

/** 触发一张卡，沿 goto 链一路执行到需要玩家选择、触发结局或链条终止。 */
function resolveCard(config: GameConfig, state: GameState, scope: GameScope, startId: string): void {
  let id: string | undefined = startId;
  let depth = 0;
  while (id) {
    if (++depth > CHAIN_LIMIT) throw new Error(`卡片链过长（超过 ${CHAIN_LIMIT} 张，可能存在 goto 循环）`);
    const card = config.cards.find((c) => c.id === id);
    if (!card) throw new Error(`卡片 "${id}" 不存在`);
    state.fired[card.id] = (state.fired[card.id] ?? 0) + 1;
    if (!state.lastFired) state.lastFired = {};
    state.lastFired[card.id] = state.time ?? state.turn;
    state.turn += 1;
    applyEffects(config, state, scope, card.effects);
    state.log.push({ kind: "card", text: renderText(card.text, scope), turn: state.turn });
    if (card.ending) {
      endGame(config, state, scope, card.ending);
      return;
    }
    const choices = availableChoicesOf(card, scope);
    if (choices.length > 0) {
      state.pendingCard = card.id;
      return;
    }
    if (card.choices?.length && choices.length === 0) {
      // 所有选项条件都不满足：视为无选项，继续走 goto / 终止
    }
    id = card.goto;
  }
  // 链条终止（无 goto）：story 在此收尾；life 回到时间流
  if (config.driver.kind === "story" && !state.ended) {
    implicitEnd(state, scope, config.text?.timeoutEnding?.title ?? DEFAULT_END.title, config.text?.timeoutEnding?.text);
  }
}

/** 条件结局检查：满足条件者按 priority 降序取第一个 */
function checkConditionEndings(config: GameConfig, state: GameState, scope: GameScope): boolean {
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

export function initState(config: GameConfig, seed: number): GameState {
  const rng = createRng(seed);
  const state: GameState = {
    turn: 0,
    time: config.driver.kind === "life" ? config.driver.time.start : undefined,
    vars: Object.fromEntries(config.vars.map((v) => [v.id, clampVar(config, v.id, v.initial)])),
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
  state.rngState = rng.state();
  return state;
}

/** life 调度器：推进一个时间步（story 调度器不使用）。 */
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

  // 1) 主线卡：条件满足的 priority 卡（数值大者先），一步最多一张
  const eligiblePriority = config.cards
    .filter((c) => c.priority !== undefined)
    .filter((c) => !(c.once && (state.fired[c.id] ?? 0) > 0))
    .filter((c) => !c.condition || truthy(evaluate(c.condition, scope)))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  if (eligiblePriority.length > 0) {
    resolveCard(config, state, scope, eligiblePriority[0].id);
  } else {
    // 2) 随机池：按权重抽 drawsPerTurn 张
    const DEFAULT_COOLDOWN = 2;
    const lastFired = state.lastFired ?? {};
    const offCooldown = (c: (typeof config.cards)[number]): boolean => {
      const last = Object.prototype.hasOwnProperty.call(lastFired, c.id) ? lastFired[c.id] : undefined;
      if (last === undefined) return true;
      return (state.time ?? 0) - last >= (c.cooldown ?? DEFAULT_COOLDOWN);
    };
    const draws = config.driver.drawsPerTurn ?? 1;
    for (let d = 0; d < draws; d++) {
      if (state.ended || state.pendingCard) break;
      const eligible = config.cards
        .filter((c) => (c.weight ?? 0) > 0)
        .filter((c) => !(c.once && (state.fired[c.id] ?? 0) > 0))
        .filter((c) => !c.condition || truthy(evaluate(c.condition, scope)));
      // 冷却过滤防止同一张卡连年出现；若过滤后池子空了则放宽（小卡池不至于停摆）
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
      resolveCard(config, state, scope, picked.id);
    }
  }

  if (!state.pendingCard && !state.ended) {
    checkConditionEndings(config, state, scope);
  }
  if (!state.pendingCard && !state.ended && state.time >= t.max) {
    const te = config.text?.timeoutEnding;
    implicitEnd(state, scope, te?.title ?? "岁月尽头", te?.text ? renderText(te.text, scope) : undefined);
  }
  state.rngState = rng.state();
  return state;
}

/** 在待选卡上做出选择（两种调度器共用）。 */
export function choose(config: GameConfig, input: GameState, choiceId: string): GameState {
  if (input.ended) return input;
  if (!input.pendingCard) throw new Error("当前没有待选择的卡片");
  const state = structuredClone(input);
  const rng = createRng(state.rngState);
  const scope = new GameScope(config, state, rng);
  const card = config.cards.find((c) => c.id === state.pendingCard)!;
  const choice = availableChoicesOf(card, scope).find((ch) => ch.id === choiceId);
  if (!choice) throw new Error(`选项 "${choiceId}" 不可用`);

  state.pendingCard = undefined;
  state.log.push({ kind: "choice", text: `▸ ${renderText(choice.label, scope)}`, turn: state.turn });
  applyEffects(config, state, scope, choice.effects);
  if (choice.text) state.log.push({ kind: "card", text: renderText(choice.text, scope), turn: state.turn });

  if (choice.ending) {
    endGame(config, state, scope, choice.ending);
  } else if (choice.goto) {
    resolveCard(config, state, scope, choice.goto);
  } else if (config.driver.kind === "story") {
    // 无 goto 的选项在 story 里意味着故事在此收尾
    implicitEnd(state, scope, config.text?.timeoutEnding?.title ?? DEFAULT_END.title, config.text?.timeoutEnding?.text);
  }

  if (!state.pendingCard && !state.ended) {
    checkConditionEndings(config, state, scope);
    if (config.driver.kind === "life" && !state.ended && (state.time ?? 0) >= config.driver.time.max) {
      const te = config.text?.timeoutEnding;
      implicitEnd(state, scope, te?.title ?? "岁月尽头", te?.text ? renderText(te.text, scope) : undefined);
    }
  }
  state.rngState = rng.state();
  return state;
}

/** 当前待选卡的可用选项（渲染后的 label） */
export function pendingChoices(config: GameConfig, state: GameState): { id: string; label: string }[] {
  if (!state.pendingCard || state.ended) return [];
  const rng = createRng(state.rngState);
  const scope = new GameScope(config, state, rng);
  const card = config.cards.find((c) => c.id === state.pendingCard);
  if (!card) return [];
  return availableChoicesOf(card, scope).map((ch) => ({ id: ch.id, label: renderText(ch.label, scope) }));
}
