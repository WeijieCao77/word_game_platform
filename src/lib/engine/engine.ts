import { ExprError, Scope, Value, evaluate, PURE_FUNCTIONS, asNumber } from "@/lib/expr";
import {
  ActionDef,
  CardDef,
  ChoiceDef,
  Effect,
  GameConfig,
  GameState,
} from "@/lib/schema";
import { Rng, createRng } from "./rng";
import { normalizeKeyword } from "@/lib/keyword";

// 纯函数引擎：同一份配置 + 同一个种子 + 同样的操作序列 => 完全相同的过程。
// 播放器、编辑器预览、模拟器、AI 的 simulate 工具共用这一份实现。
//
// 三个调度器：
//   story：显式跳转的分支叙事
//   life ：时间推进 + 权重抽卡的随机成长
//   sim  ：经营模拟回合管线——玩家主动决策(performAction) → 结束回合(endTurn)：
//          结算 → 随机事件 → 曲线 → 结局检查 → 周期滚动

const CHAIN_LIMIT = 32;
const DEFAULT_COOLDOWN = 2;

interface Bindings {
  self?: string;
  target?: string;
  row?: Record<string, number | string>;
  locals?: Record<string, Value>;
}

class GameScope implements Scope {
  private typeOf: Map<string, string>;
  private derivedDepth = 0;

  constructor(
    private config: GameConfig,
    private state: GameState,
    private rng: Rng,
    private bindings: Bindings = {}
  ) {
    this.typeOf = new Map((config.entities ?? []).map((e) => [e.id, e.type]));
  }

  withBindings(bindings: Bindings): GameScope {
    return new GameScope(this.config, this.state, this.rng, bindings);
  }

  get(path: string[]): Value | undefined {
    if (path.length === 1) {
      const key = path[0];
      if (key === "turn") return this.state.turn;
      if (key === "time") return this.state.time ?? 0;
      if (key === "cycle") return this.state.cycle ?? 1;
      if (Object.prototype.hasOwnProperty.call(this.state.vars, key)) return this.state.vars[key];
      if (this.bindings.locals && Object.prototype.hasOwnProperty.call(this.bindings.locals, key)) {
        return this.bindings.locals[key];
      }
      const derived = this.config.derived?.find((d) => d.id === key);
      if (derived) {
        if (++this.derivedDepth > 8) throw new ExprError(`派生值 "${key}" 存在循环引用`);
        try {
          return evaluate(derived.expr, this);
        } finally {
          this.derivedDepth--;
        }
      }
      return undefined;
    }
    if (path.length === 2) {
      const [head, field] = path;
      if (head === "self" || head === "target") {
        const entityId = head === "self" ? this.bindings.self : this.bindings.target;
        if (!entityId) return undefined;
        const def = this.config.entities?.find((e) => e.id === entityId);
        const st = this.state.entities?.[entityId];
        if (!def || !st) return undefined;
        if (field === "name") return def.name;
        if (field === "id") return def.id;
        if (Object.prototype.hasOwnProperty.call(st.attrs, field)) return st.attrs[field];
        return undefined;
      }
      if (head === "row") {
        const row = this.bindings.row;
        if (!row || !Object.prototype.hasOwnProperty.call(row, field)) return undefined;
        return row[field];
      }
    }
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
      case "tag": {
        if (typeof args[0] !== "string") throw new ExprError("tag() 需要标签名字符串");
        const entityId = this.bindings.self ?? this.bindings.target;
        if (!entityId) throw new ExprError("tag() 只能在实体上下文中使用");
        return (this.state.entities?.[entityId]?.tags ?? []).includes(args[0]) ? 1 : 0;
      }
      case "avg":
      case "sum":
      case "max_of":
      case "min_of":
      case "count":
        return this.aggregate(name, args);
      default:
        throw new ExprError(`未知函数 "${name}"`);
    }
  }

  private aggregate(name: string, args: Value[]): number {
    const type = args[0];
    if (typeof type !== "string") throw new ExprError(`聚合函数 ${name} 的第一个参数必须是实体类型字符串`);
    const attr = name === "count" ? undefined : (args[1] as string);
    const tagFilter = name === "count" ? (args[1] as string | undefined) : (args[2] as string | undefined);
    if (attr !== undefined && typeof attr !== "string") throw new ExprError(`聚合函数 ${name} 的属性参数必须是字符串`);
    if (tagFilter !== undefined && typeof tagFilter !== "string") throw new ExprError("聚合函数的标签参数必须是字符串");
    const values: number[] = [];
    for (const [id, st] of Object.entries(this.state.entities ?? {})) {
      if (this.typeOf.get(id) !== type) continue;
      if (tagFilter && !st.tags.includes(tagFilter)) continue;
      if (attr === undefined) {
        values.push(1);
      } else if (Object.prototype.hasOwnProperty.call(st.attrs, attr)) {
        values.push(st.attrs[attr]);
      }
    }
    switch (name) {
      case "count":
        return values.length;
      case "sum":
        return values.reduce((a, b) => a + b, 0);
      case "avg":
        return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      case "max_of":
        return values.length ? Math.max(...values) : 0;
      case "min_of":
        return values.length ? Math.min(...values) : 0;
      default:
        return 0;
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

function clampEntityAttr(config: GameConfig, entityId: string, attrId: string, value: number): number {
  const type = config.entities?.find((e) => e.id === entityId)?.type;
  const def = config.entityTypes?.find((t) => t.id === type)?.attributes.find((a) => a.id === attrId);
  if (!def) return value;
  let out = value;
  if (def.min !== undefined) out = Math.max(def.min, out);
  if (def.max !== undefined) out = Math.min(def.max, out);
  return out;
}

function applyEffects(config: GameConfig, state: GameState, scope: GameScope, effects: Effect[] | undefined, bindings: Bindings): void {
  for (const e of effects ?? []) {
    if (e.op === "add_tag" || e.op === "remove_tag") {
      const entityId = e.ref === "self" ? bindings.self : e.ref === "target" ? bindings.target : undefined;
      if (!entityId || !e.tag) throw new Error(`标签效果 ref 应为 self/target 且该位置有实体绑定（ref="${e.ref}"）`);
      const st = state.entities?.[entityId];
      if (!st) throw new Error(`实体 "${entityId}" 不存在`);
      if (e.op === "add_tag") {
        if (!st.tags.includes(e.tag)) st.tags.push(e.tag);
      } else {
        st.tags = st.tags.filter((t) => t !== e.tag);
      }
      continue;
    }
    const value = asNumber(evaluate(e.value!, scope), e.value);
    const parts = e.ref.split(".");
    if (parts.length === 2 && (parts[0] === "self" || parts[0] === "target")) {
      const entityId = parts[0] === "self" ? bindings.self : bindings.target;
      if (!entityId) throw new Error(`效果 ref "${e.ref}" 需要实体绑定`);
      const st = state.entities?.[entityId];
      if (!st) throw new Error(`实体 "${entityId}" 不存在`);
      const current = st.attrs[parts[1]] ?? 0;
      st.attrs[parts[1]] = clampEntityAttr(config, entityId, parts[1], e.op === "add" ? current + value : value);
    } else {
      const current = state.vars[e.ref] ?? 0;
      state.vars[e.ref] = clampVar(config, e.ref, e.op === "add" ? current + value : value);
    }
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
  state.pendingEntity = undefined;
  state.log.push({
    kind: "ending",
    text: state.ended.text ? `【${state.ended.title}】${state.ended.text}` : `【${state.ended.title}】`,
    turn: state.turn,
  });
}

const DEFAULT_END: { title: string; kind: "neutral" } = { title: "完", kind: "neutral" };

function implicitEnd(state: GameState, title: string, text?: string): void {
  state.ended = { endingId: "__implicit__", title, kind: DEFAULT_END.kind, text };
  state.pendingCard = undefined;
  state.pendingEntity = undefined;
  state.log.push({ kind: "ending", text: `【${title}】${text ?? ""}`, turn: state.turn });
}

function availableChoicesOf(card: CardDef, scope: GameScope): ChoiceDef[] {
  return (card.choices ?? []).filter((ch) => !ch.condition || truthy(evaluate(ch.condition, scope)));
}

function truthy(v: Value): boolean {
  return typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : v.length > 0;
}

/** 冷却计时基准：life 用 time，sim 用全局回合序号 */
function clockOf(config: GameConfig, state: GameState): number {
  if (config.driver.kind === "sim") {
    const perCycle = config.driver.time.turnsPerCycle ?? 1;
    return ((state.cycle ?? 1) - 1) * perCycle + state.turn;
  }
  return state.time ?? state.turn;
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
function resolveCard(config: GameConfig, state: GameState, scope: GameScope, startId: string, scopeEntity?: string): void {
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
    state.log.push({ kind: "card", text: renderText(pickCardText(card, state), cardScope), turn: state.turn });
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
    implicitEnd(state, config.text?.timeoutEnding?.title ?? DEFAULT_END.title, config.text?.timeoutEnding?.text);
  }
}

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

/** 随机池抽卡（life 与 sim 共用）：权重 + 条件 + once + 冷却；实体事件需存在合格实体 */
function drawEventCards(config: GameConfig, state: GameState, scope: GameScope, rng: Rng, draws: number): void {
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
    state.log.push({ kind: "header", text: simHeader(config, state, scope), turn: state.turn });
  }
  state.rngState = rng.state();
  return state;
}

function simHeader(config: GameConfig, state: GameState, scope: GameScope): string {
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
    const te = config.text?.timeoutEnding;
    implicitEnd(state, te?.title ?? "岁月尽头", te?.text ? renderText(te.text, scope) : undefined);
  }
  state.rngState = rng.state();
  return state;
}

// ---------------- sim ----------------

export interface ActionView {
  id: string;
  name: string;
  description?: string;
  available: boolean;
  reason?: string;
  usesLeft: number | null;
  needsTarget: boolean;
}

/** 当前回合各决策的可用状态（渲染操作面板用） */
export function availableActions(config: GameConfig, state: GameState): ActionView[] {
  if (config.driver.kind !== "sim" || state.ended) return [];
  const rng = createRng(state.rngState);
  const scope = new GameScope(config, state, rng);
  return (config.actions ?? []).map((a) => {
    const perTurn = a.usesPerTurn ?? 1;
    const used = state.actionsUsed?.[a.id] ?? 0;
    const usesLeft = perTurn === 0 ? null : Math.max(0, perTurn - used);
    let available = usesLeft === null || usesLeft > 0;
    let reason = available ? undefined : "本回合次数已用完";
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
    return { id: a.id, name: a.name, description: a.description, available, reason, usesLeft, needsTarget: !!a.target };
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
    for (const o of s.outcomes) {
      if (truthy(evaluate(o.condition, outScope))) {
        applyEffects(config, state, outScope, o.effects, {});
        if (o.text) state.log.push({ kind: "settlement", text: renderText(o.text, outScope), turn: state.turn });
        break;
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
    if (state.cycle > t.maxCycles) {
      const te = config.text?.timeoutEnding;
      implicitEnd(state, te?.title ?? "落幕", te?.text ? renderText(te.text, scope) : undefined);
      return;
    }
  } else {
    state.turn += 1;
    if (t.turnsPerCycle === undefined && state.turn > t.maxCycles) {
      const te = config.text?.timeoutEnding;
      implicitEnd(state, te?.title ?? "落幕", te?.text ? renderText(te.text, scope) : undefined);
      return;
    }
  }
  state.actionsUsed = {};
  state.log.push({ kind: "header", text: simHeader(config, state, scope), turn: state.turn });
}

// ---------------- 共用 ----------------

/** 选择/输入结算后的收尾管线：条件结局 → life 时间上限 → sim 回合剩余管线 */
function continueAfterResolution(config: GameConfig, state: GameState, baseScope: GameScope, renderScope: GameScope): void {
  if (!state.pendingCard && !state.ended) {
    checkConditionEndings(config, state, baseScope);
    if (config.driver.kind === "life" && !state.ended && (state.time ?? 0) >= config.driver.time.max) {
      const te = config.text?.timeoutEnding;
      implicitEnd(state, te?.title ?? "岁月尽头", te?.text ? renderText(te.text, renderScope) : undefined);
    }
    // sim：事件处理完后继续走完本回合剩余管线
    if (config.driver.kind === "sim" && !state.ended) {
      runCurves(config, state, baseScope, "turn");
      checkConditionEndings(config, state, baseScope);
      if (!state.ended) advanceSimTime(config, state, baseScope);
    }
  }
}

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
    implicitEnd(state, config.text?.timeoutEnding?.title ?? DEFAULT_END.title, config.text?.timeoutEnding?.text);
  }

  continueAfterResolution(config, state, baseScope, scope);
  state.rngState = rng.state();
  return state;
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
