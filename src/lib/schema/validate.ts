import { collectRefs, parseExpr, ExprError, Expr } from "@/lib/expr";
import { PURE_FUNCTIONS } from "@/lib/expr";
import { GameConfig, Effect } from "./types";
import { GameConfigSchema } from "./zod";

// 语义校验：结构合法之后，检查引用是否悬空、表达式是否可解析、
// 作用域是否正确、结局是否可能触发。校验失败信息要能直接报给用户/AI。

export interface ValidationIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  config?: GameConfig;
  issues: ValidationIssue[];
}

const RESERVED = new Set(["turn", "cycle", "total_turn", "row", "self", "target", "true", "false"]);

/** 聚合函数与游戏函数的签名（用于静态检查） */
const GAME_FUNCTIONS: Record<string, { min: number; max: number }> = {
  rand: { min: 0, max: 0 },
  randint: { min: 2, max: 2 },
  chance: { min: 1, max: 1 },
  tag: { min: 1, max: 1 },
  avg: { min: 2, max: 3 },
  sum: { min: 2, max: 3 },
  max_of: { min: 2, max: 3 },
  min_of: { min: 2, max: 3 },
  count: { min: 1, max: 2 },
};

const AGGREGATES = new Set(["avg", "sum", "max_of", "min_of", "count"]);

interface ExprContext {
  /** 允许的实体绑定：self / target */
  entity?: { binding: "self" | "target"; typeId: string };
  /** 允许 row.<key>；true 表示允许任意 key（无 data 时不允许） */
  rowKeys?: Set<string>;
  /** 结算 compute 局部量 */
  locals?: Set<string>;
}

class Validator {
  issues: ValidationIssue[] = [];
  varIds = new Set<string>();
  derivedIds = new Set<string>();
  typeAttrs = new Map<string, Set<string>>();
  knownTags = new Set<string>();

  constructor(private config: GameConfig) {}

  error(path: string, message: string): void {
    this.issues.push({ severity: "error", path, message });
  }

  warn(path: string, message: string): void {
    this.issues.push({ severity: "warning", path, message });
  }

  private checkUnique(path: string, items: { id: string }[], label: string): void {
    const seen = new Set<string>();
    for (const [i, item] of items.entries()) {
      if (seen.has(item.id)) this.error(`${path}[${i}].id`, `${label} id "${item.id}" 重复`);
      seen.add(item.id);
      if (RESERVED.has(item.id)) {
        this.error(`${path}[${i}].id`, `"${item.id}" 是保留字，不能用作 ${label} id`);
      }
    }
  }

  run(): void {
    const c = this.config;

    this.checkUnique("variables", c.variables, "变量");
    this.checkUnique("derived", c.derived ?? [], "派生值");
    this.checkUnique("entityTypes", c.entityTypes, "实体类型");
    this.checkUnique("entities", c.entities, "实体");
    this.checkUnique("actions", c.actions, "决策");
    this.checkUnique("settlements", c.settlements ?? [], "结算");
    this.checkUnique("eventPools", c.eventPools ?? [], "事件池");
    this.checkUnique("curves", c.curves ?? [], "曲线");
    this.checkUnique("endings", c.endings, "结局");

    for (const v of c.variables) this.varIds.add(v.id);
    for (const d of c.derived ?? []) {
      if (this.varIds.has(d.id)) this.error("derived", `派生值 "${d.id}" 与变量 id 冲突`);
    }
    for (const t of c.entityTypes) {
      this.checkUnique(`entityTypes(${t.id}).attributes`, t.attributes, "属性");
      this.typeAttrs.set(t.id, new Set(t.attributes.map((a) => a.id)));
    }

    // 变量 min/max 合法性
    for (const [i, v] of c.variables.entries()) {
      if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
        this.error(`variables[${i}]`, `变量 "${v.id}" 的 min 大于 max`);
      }
      if (v.resetEachCycle && !c.time.turnsPerCycle) {
        this.warn(`variables[${i}]`, `变量 "${v.id}" 设置了每周期重置，但时间模型没有周期`);
      }
    }

    // 实体实例
    for (const [i, e] of c.entities.entries()) {
      const attrs = this.typeAttrs.get(e.type);
      if (!attrs) {
        this.error(`entities[${i}]`, `实体 "${e.id}" 引用了不存在的类型 "${e.type}"`);
        continue;
      }
      for (const a of attrs) {
        if (e.attrs[a] === undefined) {
          this.error(`entities[${i}]`, `实体 "${e.name}" 缺少属性 "${a}" 的初始值`);
        }
      }
      for (const k of Object.keys(e.attrs)) {
        if (!attrs.has(k)) this.warn(`entities[${i}]`, `实体 "${e.name}" 的属性 "${k}" 未在类型中定义，将被忽略`);
      }
      for (const t of e.tags ?? []) this.knownTags.add(t);
    }

    // 先收集所有 add_tag，让 tag() / 聚合的标签参数能识别动态标签
    const collectTags = (effects: Effect[] | undefined): void => {
      for (const ef of effects ?? []) if (ef.op === "add_tag" && ef.tag) this.knownTags.add(ef.tag);
    };
    for (const a of c.actions) collectTags(a.effects);
    for (const s of c.settlements ?? []) for (const o of s.outcomes) collectTags(o.effects);
    for (const p of c.eventPools ?? []) for (const ev of p.events) collectTags(ev.effects);
    for (const cv of c.curves ?? []) collectTags(cv.effects);

    // 派生值：只能引用变量/时间/聚合，以及定义在它之前的派生值
    const derivedSoFar = new Set<string>();
    for (const [i, d] of (c.derived ?? []).entries()) {
      this.checkExpr(d.expr, `derived[${i}].expr`, { locals: derivedSoFar });
      derivedSoFar.add(d.id);
      this.derivedIds.add(d.id);
    }

    // 决策
    for (const [i, a] of c.actions.entries()) {
      const base = `actions[${i}]`;
      let entityCtx: ExprContext["entity"];
      if (a.target) {
        if (!this.typeAttrs.has(a.target.entityType)) {
          this.error(`${base}.target`, `决策 "${a.name}" 的目标类型 "${a.target.entityType}" 不存在`);
        } else {
          entityCtx = { binding: "target", typeId: a.target.entityType };
          if (a.target.condition) {
            this.checkExpr(a.target.condition, `${base}.target.condition`, {
              entity: { binding: "self", typeId: a.target.entityType },
            });
          }
        }
      }
      if (a.condition) this.checkExpr(a.condition, `${base}.condition`, {});
      this.checkEffects(a.effects, `${base}.effects`, { entity: entityCtx });
      if (a.text) this.checkTemplate(a.text, `${base}.text`, { entity: entityCtx });
    }

    // 结算
    for (const [i, s] of (c.settlements ?? []).entries()) {
      const base = `settlements[${i}]`;
      const rowKeys = new Set<string>();
      for (const row of s.data ?? []) for (const k of Object.keys(row)) rowKeys.add(k);
      const hasRow = (s.data?.length ?? 0) > 0;
      const rowCtx = hasRow ? rowKeys : undefined;
      if (s.condition) this.checkExpr(s.condition, `${base}.condition`, { rowKeys: rowCtx });
      const locals = new Set<string>();
      this.checkUnique(`${base}.compute`, s.compute ?? [], "中间量");
      for (const [j, cp] of (s.compute ?? []).entries()) {
        this.checkExpr(cp.expr, `${base}.compute[${j}].expr`, { rowKeys: rowCtx, locals: new Set(locals) });
        locals.add(cp.id);
      }
      this.checkUnique(`${base}.outcomes`, s.outcomes, "结算分支");
      for (const [j, o] of s.outcomes.entries()) {
        const ctx: ExprContext = { rowKeys: rowCtx, locals };
        this.checkExpr(o.condition, `${base}.outcomes[${j}].condition`, ctx);
        this.checkEffects(o.effects, `${base}.outcomes[${j}].effects`, ctx);
        if (o.text) this.checkTemplate(o.text, `${base}.outcomes[${j}].text`, ctx);
      }
      const last = s.outcomes[s.outcomes.length - 1];
      if (last && !isAlwaysTrue(last.condition)) {
        this.warn(`${base}.outcomes`, `结算 "${s.name}" 所有分支都可能不满足（建议最后一个分支条件写 1 作兜底）`);
      }
    }

    // 事件池
    for (const [i, p] of (c.eventPools ?? []).entries()) {
      const base = `eventPools[${i}]`;
      this.checkUnique(`${base}.events`, p.events, "事件");
      if (p.condition) this.checkExpr(p.condition, `${base}.condition`, {});
      for (const [j, ev] of p.events.entries()) {
        const evBase = `${base}.events[${j}]`;
        let entityCtx: ExprContext["entity"];
        if (ev.scope) {
          if (!this.typeAttrs.has(ev.scope.entityType)) {
            this.error(`${evBase}.scope`, `事件 "${ev.id}" 的实体类型 "${ev.scope.entityType}" 不存在`);
          } else {
            entityCtx = { binding: "self", typeId: ev.scope.entityType };
            if (ev.scope.condition) this.checkExpr(ev.scope.condition, `${evBase}.scope.condition`, { entity: entityCtx });
          }
        }
        if (ev.condition) this.checkExpr(ev.condition, `${evBase}.condition`, {});
        this.checkEffects(ev.effects ?? [], `${evBase}.effects`, { entity: entityCtx });
        this.checkTemplate(ev.text, `${evBase}.text`, { entity: entityCtx });
      }
    }

    // 曲线
    for (const [i, cv] of (c.curves ?? []).entries()) {
      const base = `curves[${i}]`;
      if (!this.typeAttrs.has(cv.entityType)) {
        this.error(base, `曲线 "${cv.name}" 的实体类型 "${cv.entityType}" 不存在`);
        continue;
      }
      const ctx: ExprContext = { entity: { binding: "self", typeId: cv.entityType } };
      if (cv.phase === "cycle" && !c.time.turnsPerCycle) {
        this.warn(base, `曲线 "${cv.name}" 按周期运行，但时间模型没有周期，永远不会触发`);
      }
      if (cv.condition) this.checkExpr(cv.condition, `${base}.condition`, ctx);
      this.checkEffects(cv.effects, `${base}.effects`, ctx);
      if (cv.text) this.checkTemplate(cv.text, `${base}.text`, ctx);
    }

    // 结局
    const writtenRefs = this.collectWrittenRefs();
    for (const [i, e] of c.endings.entries()) {
      this.checkExpr(e.condition, `endings[${i}].condition`, {});
      if (e.text) this.checkTemplate(e.text, `endings[${i}].text`, {});
      this.checkEndingReachabilityHeuristic(e.condition, `endings[${i}]`, e.title, writtenRefs);
    }
    if (!c.time.maxCycles && !c.time.turnsPerCycle && c.endings.length === 0) {
      this.error("endings", "游戏既没有结局也没有时间上限，永远无法结束");
    }
    if (!c.time.maxCycles) {
      this.warn("time", "未设置 maxCycles：若结局条件一直不满足，游戏将无限进行（建议设置上限并配置 timeoutEnding）");
    }

    // 全局文案
    if (c.text?.turnHeader) this.checkTemplate(c.text.turnHeader, "text.turnHeader", {});
    if (c.text?.cycleEnd) this.checkTemplate(c.text.cycleEnd, "text.cycleEnd", {});
  }

  /** 某结局条件引用的变量若从未被任何效果修改、也与时间无关，多半永远不触发 */
  private checkEndingReachabilityHeuristic(
    condition: string,
    path: string,
    title: string,
    written: Set<string>
  ): void {
    let ast: Expr;
    try {
      ast = parseExpr(condition);
    } catch {
      return; // 解析错误已在 checkExpr 报告
    }
    const { idents, calls } = collectRefs(ast);
    if (calls.length > 0) return; // 含函数（聚合/随机）时不做静态判断
    let touchesDynamic = false;
    for (const p of idents) {
      const head = p[0];
      if (head === "turn" || head === "cycle" || head === "total_turn") touchesDynamic = true;
      if (this.varIds.has(head) && written.has(head)) touchesDynamic = true;
      if (this.derivedIds.has(head)) touchesDynamic = true; // 派生值通常依赖实体属性，保守放过
    }
    if (idents.length > 0 && !touchesDynamic) {
      this.warn(path, `结局 "${title}" 的条件引用的变量从未被任何效果修改，可能永远不会触发`);
    }
  }

  private collectWrittenRefs(): Set<string> {
    const written = new Set<string>();
    const scan = (effects: Effect[] | undefined): void => {
      for (const e of effects ?? []) {
        if ((e.op === "add" || e.op === "set") && !e.ref.includes(".")) written.add(e.ref);
      }
    };
    for (const a of this.config.actions) scan(a.effects);
    for (const s of this.config.settlements ?? []) for (const o of s.outcomes) scan(o.effects);
    for (const p of this.config.eventPools ?? []) for (const ev of p.events) scan(ev.effects);
    for (const cv of this.config.curves ?? []) scan(cv.effects);
    for (const v of this.config.variables) if (v.resetEachCycle) written.add(v.id);
    return written;
  }

  private checkEffects(effects: Effect[], path: string, ctx: ExprContext): void {
    for (const [i, e] of effects.entries()) {
      const p = `${path}[${i}]`;
      if (e.op === "add_tag" || e.op === "remove_tag") {
        if (!ctx.entity) {
          this.error(p, `标签效果需要实体上下文（该位置没有 target/self）`);
        } else if (e.ref !== ctx.entity.binding) {
          this.error(p, `标签效果的 ref 应为 "${ctx.entity.binding}"，实际是 "${e.ref}"`);
        }
        continue;
      }
      // 数值效果
      const parts = e.ref.split(".");
      if (parts.length === 1) {
        if (!this.varIds.has(e.ref)) {
          this.error(p, `效果引用了不存在的变量 "${e.ref}"`);
        }
      } else if (parts.length === 2 && (parts[0] === "target" || parts[0] === "self")) {
        if (!ctx.entity) {
          this.error(p, `效果 ref "${e.ref}" 需要实体上下文，但该位置没有 target/self`);
        } else if (parts[0] !== ctx.entity.binding) {
          this.error(p, `该位置的实体绑定是 "${ctx.entity.binding}"，不能用 "${parts[0]}"`);
        } else if (!this.typeAttrs.get(ctx.entity.typeId)?.has(parts[1])) {
          this.error(p, `实体类型 "${ctx.entity.typeId}" 没有属性 "${parts[1]}"`);
        }
      } else {
        this.error(p, `无法识别的效果 ref "${e.ref}"（应为变量 id 或 target.属性 / self.属性）`);
      }
      if (e.value) this.checkExpr(e.value, `${p}.value`, ctx);
    }
  }

  private checkTemplate(template: string, path: string, ctx: ExprContext): void {
    for (const m of template.matchAll(/\{([^{}]+)\}/g)) {
      this.checkExpr(m[1], `${path} 中的 {${m[1]}}`, ctx, true);
    }
  }

  private checkExpr(source: string, path: string, ctx: ExprContext, allowString = false): void {
    let ast: Expr;
    try {
      ast = parseExpr(source);
    } catch (err) {
      this.error(path, err instanceof ExprError ? err.message : String(err));
      return;
    }
    const { idents, calls } = collectRefs(ast);
    for (const p of idents) {
      this.checkIdent(p, path, ctx, allowString);
    }
    for (const call of calls) {
      const sig = GAME_FUNCTIONS[call.name] ?? (PURE_FUNCTIONS[call.name] ? { min: PURE_FUNCTIONS[call.name].arity[0], max: PURE_FUNCTIONS[call.name].arity[1] } : undefined);
      if (!sig) {
        this.error(path, `未知函数 "${call.name}"`);
        continue;
      }
      if (call.args.length < sig.min || call.args.length > sig.max) {
        this.error(path, `函数 ${call.name} 需要 ${sig.min === sig.max ? sig.min : `${sig.min}-${sig.max}`} 个参数，实际 ${call.args.length} 个`);
        continue;
      }
      if (AGGREGATES.has(call.name)) this.checkAggregate(call.name, call.args, path);
      if (call.name === "tag") {
        if (!ctx.entity) {
          this.error(path, `tag() 只能在实体上下文（事件/曲线/目标条件）中使用`);
        } else if (call.args[0].kind === "str" && !this.knownTags.has(call.args[0].value)) {
          this.warn(path, `标签 "${call.args[0].value}" 从未出现在任何实体或效果中`);
        }
      }
    }
  }

  private checkAggregate(name: string, args: Expr[], path: string): void {
    const typeArg = args[0];
    if (typeArg.kind !== "str") {
      this.error(path, `聚合函数 ${name} 的第一个参数必须是实体类型字符串字面量`);
      return;
    }
    const attrs = this.typeAttrs.get(typeArg.value);
    if (!attrs) {
      this.error(path, `聚合函数引用了不存在的实体类型 "${typeArg.value}"`);
      return;
    }
    const attrIndex = name === "count" ? -1 : 1;
    if (attrIndex >= 0) {
      const attrArg = args[attrIndex];
      if (!attrArg || attrArg.kind !== "str") {
        this.error(path, `聚合函数 ${name} 的属性参数必须是字符串字面量`);
      } else if (!attrs.has(attrArg.value)) {
        this.error(path, `实体类型 "${typeArg.value}" 没有属性 "${attrArg.value}"`);
      }
    }
    const tagArg = name === "count" ? args[1] : args[2];
    if (tagArg) {
      if (tagArg.kind !== "str") {
        this.error(path, `聚合函数的标签过滤参数必须是字符串字面量`);
      } else if (!this.knownTags.has(tagArg.value)) {
        this.warn(path, `标签 "${tagArg.value}" 从未出现在任何实体或效果中`);
      }
    }
  }

  private checkIdent(p: string[], path: string, ctx: ExprContext, allowString: boolean): void {
    const head = p[0];
    if (p.length === 1) {
      if (head === "turn" || head === "cycle" || head === "total_turn") return;
      if (this.varIds.has(head) || this.derivedIds.has(head)) return;
      if (ctx.locals?.has(head)) return;
      this.error(path, `未知变量 "${head}"`);
      return;
    }
    if (head === "self" || head === "target") {
      if (!ctx.entity) {
        this.error(path, `"${p.join(".")}" 需要实体上下文，但该位置没有 ${head}`);
        return;
      }
      if (head !== ctx.entity.binding) {
        this.error(path, `该位置的实体绑定是 "${ctx.entity.binding}"，不能用 "${head}"`);
        return;
      }
      const field = p[1];
      if (field === "name" || field === "id") {
        if (!allowString && field === "name") {
          this.warn(path, `"${p.join(".")}" 是字符串，只应在文案模板中使用`);
        }
        return;
      }
      if (!this.typeAttrs.get(ctx.entity.typeId)?.has(field)) {
        this.error(path, `实体类型 "${ctx.entity.typeId}" 没有属性 "${field}"`);
      }
      return;
    }
    if (head === "row") {
      if (!ctx.rowKeys) {
        this.error(path, `"${p.join(".")}" 只能在带 data 的结算中使用`);
        return;
      }
      if (!ctx.rowKeys.has(p[1])) {
        this.error(path, `结算数据行没有字段 "${p[1]}"`);
      }
      return;
    }
    this.error(path, `无法解析 "${p.join(".")}"`);
  }
}

function isAlwaysTrue(condition: string): boolean {
  const t = condition.trim();
  return t === "1" || t === "true";
}

/** 结构 + 语义完整校验。入口：编辑器保存、AI 生成结果、模板加载都走这里。 */
export function validateGameConfig(json: unknown): ValidationResult {
  const parsed = GameConfigSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        severity: "error" as const,
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }
  const config = parsed.data as GameConfig;
  const v = new Validator(config);
  v.run();
  const hasError = v.issues.some((i) => i.severity === "error");
  return { ok: !hasError, config: hasError ? undefined : config, issues: v.issues };
}
