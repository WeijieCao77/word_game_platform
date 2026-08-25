// 引擎共用底座：表达式求值上下文（GameScope）、文案 {} 插值、数值钳制、效果落地、冷却时钟。
// 想改「表达式里能读到哪些变量、能调哪些函数」「effect 怎么写回状态」「{x} 渲染成什么样」，来这里。
// 其他引擎模块都依赖它，所以这里只放不含调度逻辑的底层件，不要反向 import 兄弟模块（会成环）。

import { ExprError, Scope, Value, evaluate, PURE_FUNCTIONS, asNumber } from "@/lib/expr";
import { Effect, GameConfig, GameState } from "@/lib/schema";
import { Rng } from "./rng";
import { changeRelation, groupPairs, readRelation, relationDef, taggedMembers } from "./relations";

export interface Bindings {
  self?: string;
  target?: string;
  row?: Record<string, number | string>;
  locals?: Record<string, Value>;
}

export class GameScope implements Scope {
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
      if (head === "self" || head === "target" || head === "other") {
        // other 是 target 的别名：写关系初值时「self 与 other」比「self 与 target」更像人话
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
      case "searched": {
        // 玩家有没有用检索台查过这个词条。推理类最想要的那句「你没查过就不该知道」
        // 靠它才做得出来——此前检索只能是加分项，做不成硬性必需。
        if (typeof args[0] !== "string") throw new ExprError("searched() 需要检索词条 id 字符串");
        return (this.state.searched?.[args[0]] ?? 0) > 0 ? 1 : 0;
      }
      case "bond": {
        // self 与 target 之间的关系值——两个绑定都要有
        if (typeof args[0] !== "string") throw new ExprError("bond() 需要关系 id 字符串");
        const a = this.bindings.self;
        const b = this.bindings.target;
        if (!a || !b) throw new ExprError("bond() 需要同时有 self 和 target 两个实体绑定");
        return readRelation(this.config, this.state, args[0], a, b, (x, y) => this.initialRelation(args[0] as string, x, y));
      }
      case "harmony": {
        // 一群人两两之间的平均关系值——队内和谐度就是它
        if (typeof args[0] !== "string") throw new ExprError("harmony() 需要关系 id 字符串");
        const tag = args[1] === undefined ? undefined : String(args[1]);
        const pairs = groupPairs(taggedMembers(this.config, this.state, args[0], tag));
        if (pairs.length === 0) return 0;
        let sum = 0;
        for (const [x, y] of pairs) {
          sum += readRelation(this.config, this.state, args[0], x, y, (m, n) => this.initialRelation(args[0] as string, m, n));
        }
        return sum / pairs.length;
      }
      case "worst_bond": {
        // 最差的那一对——「更衣室里有没有人处不来」靠它判断
        if (typeof args[0] !== "string") throw new ExprError("worst_bond() 需要关系 id 字符串");
        const tag = args[1] === undefined ? undefined : String(args[1]);
        const pairs = groupPairs(taggedMembers(this.config, this.state, args[0], tag));
        if (pairs.length === 0) return 0;
        let lo = Infinity;
        for (const [x, y] of pairs) {
          lo = Math.min(lo, readRelation(this.config, this.state, args[0], x, y, (m, n) => this.initialRelation(args[0] as string, m, n)));
        }
        return lo;
      }
      case "tag": {
        if (typeof args[0] !== "string") throw new ExprError("tag() 需要标签名字符串");
        const entityId = this.bindings.self ?? this.bindings.target;
        if (!entityId) throw new ExprError("tag() 只能在实体上下文中使用");
        return (this.state.entities?.[entityId]?.tags ?? []).includes(args[0]) ? 1 : 0;
      }
      case "rank": {
        if (typeof args[0] !== "string") throw new ExprError("rank() 需要联赛 id 字符串");
        const league = (this.config.leagues ?? []).find((lg) => lg.id === args[0]);
        if (!league) throw new ExprError(`联赛 "${args[0]}" 不存在`);
        const table = this.state.leagues?.[league.id];
        const rows = league.teams.map((t) => ({ name: t.name, ...(table?.[t.name] ?? { w: 0, l: 0, diff: 0 }) }));
        rows.sort((a, b) => b.w - a.w || b.diff - a.diff || a.name.localeCompare(b.name, "zh"));
        return rows.findIndex((r) => r.name === league.playerTeam) + 1;
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

  /**
   * 没碰过的那一对，初值现算。
   * initial 表达式里可以用 self.* 和 other.* ——比如「同龄人天然亲近一点」
   * 写成 "10 - abs(self.年龄 - other.年龄)"。
   */
  private initialRelation(relId: string, a: string, b: string): number {
    const def = relationDef(this.config, relId);
    if (!def?.initial) return 0;
    // self=a、target=b（other 是 target 的别名，读起来更像人话）
    const scope = new GameScope(this.config, this.state, this.rng, { self: a, target: b });
    return asNumber(evaluate(def.initial, scope), def.initial);
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

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return (Math.round(n * 10) / 10).toString();
}

export function renderText(template: string, scope: GameScope): string {
  return template.replace(/\{([^{}]+)\}/g, (_, expr: string) => {
    const v = evaluate(expr, scope);
    if (typeof v === "number") return formatNumber(v);
    if (typeof v === "boolean") return v ? "1" : "0";
    return v;
  });
}

export function clampVar(config: GameConfig, id: string, value: number): number {
  const def = config.vars.find((v) => v.id === id);
  if (!def) return value;
  let out = value;
  if (def.min !== undefined) out = Math.max(def.min, out);
  if (def.max !== undefined) out = Math.min(def.max, out);
  return out;
}

export function clampEntityAttr(config: GameConfig, entityId: string, attrId: string, value: number): number {
  const type = config.entities?.find((e) => e.id === entityId)?.type;
  const def = config.entityTypes?.find((t) => t.id === type)?.attributes.find((a) => a.id === attrId);
  if (!def) return value;
  let out = value;
  if (def.min !== undefined) out = Math.max(def.min, out);
  if (def.max !== undefined) out = Math.min(def.max, out);
  return out;
}

export function applyEffects(config: GameConfig, state: GameState, scope: GameScope, effects: Effect[] | undefined, bindings: Bindings): void {
  for (const e of effects ?? []) {
    if (e.op === "relate" || e.op === "relate_group") {
      const delta = asNumber(evaluate(e.value!, scope), e.value);
      const initFn = (x: string, y: string): number => {
        const def = relationDef(config, e.ref);
        if (!def?.initial) return 0;
        return asNumber(evaluate(def.initial, scope.withBindings({ self: x, target: y })), def.initial);
      };
      if (e.op === "relate") {
        const a = bindings.self;
        const b = bindings.target;
        if (!a || !b) throw new Error(`relate 需要同时有 self 和 target 两个实体绑定（关系 "${e.ref}"）`);
        changeRelation(config, state, e.ref, a, b, delta, initFn);
      } else {
        // 组内两两都变——团建、集训、一起打了一场硬仗，都是这个形状
        if (!e.tag) throw new Error(`relate_group 需要 tag 指定分组（关系 "${e.ref}"）`);
        const members = taggedMembers(config, state, e.ref, e.tag);
        for (const [x, y] of groupPairs(members)) changeRelation(config, state, e.ref, x, y, delta, initFn);
      }
      continue;
    }
    if (e.op === "pend") {
      // 发起一件「要等回音的事」：现在只记下到期回合，结果留到那时候再算。
      // 转会报价、赞助洽谈、招聘邀约、跳槽求职都是这个形状。
      const def = (config.pendings ?? []).find((d) => d.id === e.ref);
      if (!def) throw new Error(`待办 "${e.ref}" 不存在`);
      const wait = Math.max(1, Math.round(asNumber(evaluate(def.waitTurns, scope), def.waitTurns)));
      if (!state.pendings) state.pendings = [];
      state.pendings.push({
        key: `${def.id}#${clockOf(config, state)}#${state.pendings.length}`,
        def: def.id,
        dueTurn: clockOf(config, state) + wait,
        // 记住发起时选中的目标，结果分支里还能用 target.*
        target: bindings.target ?? bindings.self,
      });
      continue;
    }
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

export function truthy(v: Value): boolean {
  return typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : v.length > 0;
}

/** 冷却计时基准：life 用 time，sim 用全局回合序号 */
export function clockOf(config: GameConfig, state: GameState): number {
  if (config.driver.kind === "sim") {
    const perCycle = config.driver.time.turnsPerCycle ?? 1;
    return ((state.cycle ?? 1) - 1) * perCycle + state.turn;
  }
  return state.time ?? state.turn;
}
