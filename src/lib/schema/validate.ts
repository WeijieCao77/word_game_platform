import { collectRefs, parseExpr, ExprError, Expr, PURE_FUNCTIONS } from "@/lib/expr";
import { CardDef, Effect, GameConfig } from "./types";
import { GameConfigSchema } from "./zod";
import { normalizeKeyword } from "@/lib/keyword";

// 语义校验：结构合法之后，检查引用是否悬空、表达式与作用域是否正确、
// 孤儿卡、不可达结局。错误信息要能直接报给作者/AI。

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

const RESERVED = new Set(["time", "turn", "cycle", "true", "false", "fired", "self", "target", "row"]);

const GAME_FUNCTIONS: Record<string, { min: number; max: number }> = {
  rand: { min: 0, max: 0 },
  randint: { min: 2, max: 2 },
  chance: { min: 1, max: 1 },
  fired: { min: 1, max: 1 },
  tag: { min: 1, max: 1 },
  avg: { min: 2, max: 3 },
  sum: { min: 2, max: 3 },
  max_of: { min: 2, max: 3 },
  min_of: { min: 2, max: 3 },
  count: { min: 1, max: 2 },
};

const AGGREGATES = new Set(["avg", "sum", "max_of", "min_of", "count"]);

interface ExprContext {
  entity?: { binding: "self" | "target"; typeId: string };
  rowKeys?: Set<string>;
  locals?: Set<string>;
}

class Validator {
  issues: ValidationIssue[] = [];
  private varIds = new Set<string>();
  private cardIds = new Set<string>();
  private endingIds = new Set<string>();
  private derivedIds = new Set<string>();
  private typeAttrs = new Map<string, Set<string>>();
  private knownTags = new Set<string>();
  private isSim: boolean;

  constructor(private config: GameConfig) {
    this.isSim = config.driver.kind === "sim";
  }

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
    this.checkUnique("vars", c.vars, "变量");
    this.checkUnique("cards", c.cards, "卡片");
    this.checkUnique("endings", c.endings, "结局");
    this.checkUnique("entityTypes", c.entityTypes ?? [], "实体类型");
    this.checkUnique("entities", c.entities ?? [], "实体");
    this.checkUnique("derived", c.derived ?? [], "派生值");
    this.checkUnique("actions", c.actions ?? [], "决策");
    this.checkUnique("settlements", c.settlements ?? [], "结算");
    this.checkUnique("curves", c.curves ?? [], "曲线");

    for (const v of c.vars) this.varIds.add(v.id);
    for (const card of c.cards) this.cardIds.add(card.id);
    for (const e of c.endings) this.endingIds.add(e.id);
    for (const t of c.entityTypes ?? []) {
      this.checkUnique(`entityTypes(${t.id}).attributes`, t.attributes, "属性");
      this.typeAttrs.set(t.id, new Set(t.attributes.map((a) => a.id)));
    }
    for (const d of c.derived ?? []) {
      if (this.varIds.has(d.id)) this.error("derived", `派生值 "${d.id}" 与变量 id 冲突`);
    }

    for (const [i, v] of c.vars.entries()) {
      if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
        this.error(`vars[${i}]`, `变量 "${v.id}" 的 min 大于 max`);
      }
      if (v.resetEachCycle && !this.isSim) {
        this.warn(`vars[${i}]`, `变量 "${v.id}" 的 resetEachCycle 只在 sim 调度器中生效`);
      }
    }

    // sim 模块字段用于非 sim 调度器
    if (!this.isSim) {
      for (const [key, arr] of Object.entries({
        entityTypes: c.entityTypes,
        entities: c.entities,
        actions: c.actions,
        settlements: c.settlements,
        curves: c.curves,
      })) {
        if (arr && arr.length > 0) this.warn(key, `${key} 只在 sim 调度器中生效，当前调度器会忽略它`);
      }
    }

    // 实体实例
    for (const [i, e] of (c.entities ?? []).entries()) {
      const attrs = this.typeAttrs.get(e.type);
      if (!attrs) {
        this.error(`entities[${i}]`, `实体 "${e.id}" 引用了不存在的类型 "${e.type}"`);
        continue;
      }
      for (const a of attrs) {
        if (e.attrs[a] === undefined) this.error(`entities[${i}]`, `实体 "${e.name}" 缺少属性 "${a}" 的初始值`);
      }
      for (const k of Object.keys(e.attrs)) {
        if (!attrs.has(k)) this.warn(`entities[${i}]`, `实体 "${e.name}" 的属性 "${k}" 未在类型中定义，将被忽略`);
      }
      for (const t of e.tags ?? []) this.knownTags.add(t);
    }

    // 先收集所有 add_tag，让 tag()/聚合的标签参数能识别动态标签
    const collectTags = (effects: Effect[] | undefined): void => {
      for (const ef of effects ?? []) if (ef.op === "add_tag" && ef.tag) this.knownTags.add(ef.tag);
    };
    for (const card of c.cards) {
      collectTags(card.effects);
      for (const ch of card.choices ?? []) collectTags(ch.effects);
      for (const a of card.input?.answers ?? []) collectTags(a.effects);
    }
    for (const a of c.actions ?? []) collectTags(a.effects);
    for (const s of c.settlements ?? []) for (const o of s.outcomes) collectTags(o.effects);
    for (const cv of c.curves ?? []) collectTags(cv.effects);

    // 派生值：只能引用变量/时间/聚合，以及定义在它之前的派生值
    const derivedSoFar = new Set<string>();
    for (const [i, d] of (c.derived ?? []).entries()) {
      this.checkExpr(d.expr, `derived[${i}].expr`, { locals: derivedSoFar });
      derivedSoFar.add(d.id);
      this.derivedIds.add(d.id);
    }

    // 决策
    const apBudget = c.driver.kind === "sim" ? c.driver.actionPoints : undefined;
    for (const [i, a] of (c.actions ?? []).entries()) {
      const base = `actions[${i}](${a.id})`;
      if (a.cost !== undefined && apBudget === undefined) {
        this.warn(`${base}.cost`, `决策 "${a.name}" 设置了行动点消耗，但 driver.actionPoints 未启用，cost 会被忽略`);
      }
      if (apBudget !== undefined && (a.cost ?? 1) > apBudget) {
        this.error(`${base}.cost`, `决策 "${a.name}" 的行动点消耗（${a.cost ?? 1}）超过每回合预算（${apBudget}），永远无法执行`);
      }
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
      const base = `settlements[${i}](${s.id})`;
      const rowKeys = new Set<string>();
      for (const row of s.data ?? []) for (const k of Object.keys(row)) rowKeys.add(k);
      const rowCtx = (s.data?.length ?? 0) > 0 ? rowKeys : undefined;
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
      if (last && !["1", "true"].includes(last.condition.trim())) {
        this.warn(`${base}.outcomes`, `结算 "${s.name}" 所有分支都可能不满足（建议最后一个分支条件写 1 作兜底）`);
      }
    }

    // 曲线
    for (const [i, cv] of (c.curves ?? []).entries()) {
      const base = `curves[${i}](${cv.id})`;
      if (!this.typeAttrs.has(cv.entityType)) {
        this.error(base, `曲线 "${cv.name}" 的实体类型 "${cv.entityType}" 不存在`);
        continue;
      }
      const ctx: ExprContext = { entity: { binding: "self", typeId: cv.entityType } };
      if (cv.phase === "cycle" && this.isSim && this.config.driver.kind === "sim" && !this.config.driver.time.turnsPerCycle) {
        this.warn(base, `曲线 "${cv.name}" 按周期运行，但时间模型没有 turnsPerCycle，永远不会触发`);
      }
      if (cv.condition) this.checkExpr(cv.condition, `${base}.condition`, ctx);
      this.checkEffects(cv.effects, `${base}.effects`, ctx);
      if (cv.text) this.checkTemplate(cv.text, `${base}.text`, ctx);
    }

    // 卡片
    const isLife = c.driver.kind === "life";
    for (const [i, card] of c.cards.entries()) {
      const base = `cards[${i}](${card.id})`;
      let entityCtx: ExprContext["entity"];
      if (card.scope) {
        if (!this.isSim) {
          this.warn(`${base}.scope`, `卡片实体作用域只在 sim 调度器中生效（卡片 "${card.id}"）`);
        }
        if (!this.typeAttrs.has(card.scope.entityType)) {
          this.error(`${base}.scope`, `卡片 "${card.id}" 的实体类型 "${card.scope.entityType}" 不存在`);
        } else {
          entityCtx = { binding: "self", typeId: card.scope.entityType };
          if (card.scope.condition) {
            this.checkExpr(card.scope.condition, `${base}.scope.condition`, { entity: entityCtx });
          }
        }
      }
      const ctx: ExprContext = { entity: entityCtx };
      if (card.condition) this.checkExpr(card.condition, `${base}.condition`, {});
      this.checkTemplate(card.text, `${base}.text`, ctx);
      for (let vi = 0; vi < (card.textVariants?.length ?? 0); vi++) {
        this.checkTemplate(card.textVariants![vi], `${base}.textVariants[${vi}]`, ctx);
      }
      this.checkEffects(card.effects, `${base}.effects`, ctx);
      if (card.goto && card.ending) this.error(base, `卡片 "${card.id}" 不能同时设置 goto 和 ending`);
      if (card.goto && !this.cardIds.has(card.goto)) {
        this.error(`${base}.goto`, `卡片 "${card.id}" 的 goto 指向不存在的卡 "${card.goto}"`);
      }
      if (card.ending && !this.endingIds.has(card.ending)) {
        this.error(`${base}.ending`, `卡片 "${card.id}" 引用了不存在的结局 "${card.ending}"`);
      }
      if ((card.goto || card.ending) && card.choices?.length) {
        this.error(base, `卡片 "${card.id}" 有选项时不能再设置卡级 goto/ending（放到选项里）`);
      }
      if (!isLife && !this.isSim && (card.weight !== undefined || card.priority !== undefined || card.cooldown !== undefined)) {
        this.warn(base, `story 调度器不使用 weight/priority/cooldown（卡片 "${card.id}"）`);
      }
      if (this.isSim && card.priority !== undefined) {
        this.warn(base, `sim 调度器不使用 priority（主线节拍用结算或条件事件实现，卡片 "${card.id}"）`);
      }
      const cseen = new Set<string>();
      for (const [j, ch] of (card.choices ?? []).entries()) {
        const cb = `${base}.choices[${j}](${ch.id})`;
        if (cseen.has(ch.id)) this.error(cb, `卡片 "${card.id}" 的选项 id "${ch.id}" 重复`);
        cseen.add(ch.id);
        if (ch.condition) this.checkExpr(ch.condition, `${cb}.condition`, ctx);
        this.checkTemplate(ch.label, `${cb}.label`, ctx);
        if (ch.text) this.checkTemplate(ch.text, `${cb}.text`, ctx);
        this.checkEffects(ch.effects, `${cb}.effects`, ctx);
        if (ch.goto && ch.ending) this.error(cb, `选项 "${ch.id}" 不能同时设置 goto 和 ending`);
        if (ch.goto && !this.cardIds.has(ch.goto)) {
          this.error(`${cb}.goto`, `选项 "${ch.id}" 的 goto 指向不存在的卡 "${ch.goto}"`);
        }
        if (ch.ending && !this.endingIds.has(ch.ending)) {
          this.error(`${cb}.ending`, `选项 "${ch.id}" 引用了不存在的结局 "${ch.ending}"`);
        }
      }
      // 关键词输入门
      if (card.input) {
        const ib = `${base}.input`;
        if (card.input.prompt) this.checkTemplate(card.input.prompt, `${ib}.prompt`, ctx);
        if (card.input.fallbackText) this.checkTemplate(card.input.fallbackText, `${ib}.fallbackText`, ctx);
        const aseen = new Set<string>();
        const kwSeen = new Set<string>();
        for (const [j, a] of card.input.answers.entries()) {
          const ab = `${ib}.answers[${j}](${a.id})`;
          if (aseen.has(a.id)) this.error(ab, `卡片 "${card.id}" 的输入答案 id "${a.id}" 重复`);
          aseen.add(a.id);
          if (a.condition) this.checkExpr(a.condition, `${ab}.condition`, ctx);
          if (a.text) this.checkTemplate(a.text, `${ab}.text`, ctx);
          this.checkEffects(a.effects, `${ab}.effects`, ctx);
          if (a.goto && a.ending) this.error(ab, `输入答案 "${a.id}" 不能同时设置 goto 和 ending`);
          if (a.goto && !this.cardIds.has(a.goto)) {
            this.error(`${ab}.goto`, `输入答案 "${a.id}" 的 goto 指向不存在的卡 "${a.goto}"`);
          }
          if (a.ending && !this.endingIds.has(a.ending)) {
            this.error(`${ab}.ending`, `输入答案 "${a.id}" 引用了不存在的结局 "${a.ending}"`);
          }
          for (const kw of a.keywords) {
            const norm = normalizeKeyword(kw);
            if (!norm) this.error(ab, `关键词 "${kw}" 归一化后为空`);
            else if (kwSeen.has(norm) && !a.condition) {
              this.warn(ab, `关键词 "${kw}" 与前面的答案重复，永远轮不到答案 "${a.id}"`);
            }
            kwSeen.add(norm);
          }
        }
      }
    }

    // 调度器
    if (c.driver.kind === "story") {
      if (!this.cardIds.has(c.driver.startCard)) {
        this.error("driver.startCard", `起始卡 "${c.driver.startCard}" 不存在`);
      } else {
        this.checkStoryReachability(c.driver.startCard);
      }
    } else if (c.driver.kind === "life") {
      const t = c.driver.time;
      if (t.max <= t.start) this.error("driver.time", "时间上限 max 必须大于起始值 start");
      if (!c.cards.some((card) => (card.weight ?? 0) > 0 || card.priority !== undefined)) {
        this.error("cards", "life 调度器需要至少一张可抽取的卡（weight>0）或主线卡（priority）");
      }
      this.checkLifeOrphans();
    } else {
      // sim
      if ((c.actions ?? []).length === 0) {
        this.warn("actions", "sim 调度器没有任何玩家决策——经营感来自主动操作，建议至少提供 3 个决策");
      }
      if ((c.settlements ?? []).length === 0) {
        this.warn("settlements", "sim 调度器没有结算——通常用一个结算表达对抗/营业等核心循环");
      }
    }

    // 结局
    const written = this.collectWrittenVars();
    const referenced = this.collectReferencedEndings();
    for (const [i, e] of c.endings.entries()) {
      const base = `endings[${i}](${e.id})`;
      if (e.condition) this.checkExpr(e.condition, `${base}.condition`, {});
      if (e.text) this.checkTemplate(e.text, `${base}.text`, {});
      if (!e.condition && !referenced.has(e.id)) {
        this.warn(base, `结局 "${e.title}" 既没有触发条件，也没有任何卡片/选项引用它，永远不会出现`);
      }
      if (e.condition) this.checkEndingReachabilityHeuristic(e.condition, base, e.title, written);
    }

    // 全局文案
    if (c.text?.turnHeader) this.checkTemplate(c.text.turnHeader, "text.turnHeader", {});
    if (c.text?.cycleEnd) this.checkTemplate(c.text.cycleEnd, "text.cycleEnd", {});
    if (c.text?.timeoutEnding?.text) this.checkTemplate(c.text.timeoutEnding.text, "text.timeoutEnding.text", {});
    if ((c.driver.kind === "life" || c.driver.kind === "sim") && !c.text?.timeoutEnding) {
      this.warn("text", "建议配置 timeoutEnding（时间走完的兜底结局），否则使用系统默认文案");
    }
  }

  private checkStoryReachability(start: string): void {
    const byId = new Map(this.config.cards.map((card) => [card.id, card]));
    const visited = new Set<string>();
    const queue = [start];
    while (queue.length) {
      const id = queue.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const card = byId.get(id);
      if (!card) continue;
      if (card.goto) queue.push(card.goto);
      for (const ch of card.choices ?? []) if (ch.goto) queue.push(ch.goto);
      for (const a of card.input?.answers ?? []) if (a.goto) queue.push(a.goto);
    }
    for (const card of this.config.cards) {
      if (!visited.has(card.id)) this.warn(`cards(${card.id})`, `卡片 "${card.id}" 从起始卡无法到达（孤儿卡）`);
    }
    for (const id of visited) {
      const card = byId.get(id);
      if (card && !card.choices?.length && !card.input?.answers?.length && !card.goto && !card.ending) {
        this.warn(`cards(${card.id})`, `卡片 "${card.id}" 是死端（无选项/goto/ending），游戏会在此以默认结局收尾`);
      }
    }
  }

  private checkLifeOrphans(): void {
    const linked = new Set<string>();
    for (const card of this.config.cards) {
      if (card.goto) linked.add(card.goto);
      for (const ch of card.choices ?? []) if (ch.goto) linked.add(ch.goto);
      for (const a of card.input?.answers ?? []) if (a.goto) linked.add(a.goto);
    }
    for (const card of this.config.cards) {
      const drawable = (card.weight ?? 0) > 0 || card.priority !== undefined;
      if (!drawable && !linked.has(card.id)) {
        this.warn(`cards(${card.id})`, `卡片 "${card.id}" 没有 weight/priority 也没有被任何 goto 指向，永远不会出现`);
      }
    }
  }

  private collectWrittenVars(): Set<string> {
    const written = new Set<string>();
    const scan = (effects: Effect[] | undefined): void => {
      for (const e of effects ?? []) {
        if ((e.op === "add" || e.op === "set") && !e.ref.includes(".")) written.add(e.ref);
      }
    };
    for (const card of this.config.cards) {
      scan(card.effects);
      for (const ch of card.choices ?? []) scan(ch.effects);
      for (const a of card.input?.answers ?? []) scan(a.effects);
    }
    for (const a of this.config.actions ?? []) scan(a.effects);
    for (const s of this.config.settlements ?? []) for (const o of s.outcomes) scan(o.effects);
    for (const cv of this.config.curves ?? []) scan(cv.effects);
    for (const v of this.config.vars) if (v.resetEachCycle) written.add(v.id);
    return written;
  }

  private collectReferencedEndings(): Set<string> {
    const refs = new Set<string>();
    for (const card of this.config.cards) {
      if (card.ending) refs.add(card.ending);
      for (const ch of card.choices ?? []) if (ch.ending) refs.add(ch.ending);
      for (const a of card.input?.answers ?? []) if (a.ending) refs.add(a.ending);
    }
    return refs;
  }

  private checkEndingReachabilityHeuristic(condition: string, path: string, title: string, written: Set<string>): void {
    let ast: Expr;
    try {
      ast = parseExpr(condition);
    } catch {
      return;
    }
    const { idents, calls } = collectRefs(ast);
    if (calls.some((c) => c.name !== "fired")) return;
    let touchesDynamic = calls.some((c) => c.name === "fired");
    for (const p of idents) {
      const head = p[0];
      if (head === "turn" || head === "time" || head === "cycle") touchesDynamic = true;
      if (this.varIds.has(head) && written.has(head)) touchesDynamic = true;
      if (this.derivedIds.has(head)) touchesDynamic = true;
    }
    if ((idents.length > 0 || calls.length > 0) && !touchesDynamic) {
      this.warn(path, `结局 "${title}" 的条件引用的变量从未被任何效果修改，可能永远不会触发`);
    }
  }

  private checkEffects(effects: Effect[] | undefined, path: string, ctx: ExprContext): void {
    for (const [i, e] of (effects ?? []).entries()) {
      const p = `${path}[${i}]`;
      if (e.op === "add_tag" || e.op === "remove_tag") {
        if (!ctx.entity) {
          this.error(p, "标签效果需要实体上下文（该位置没有 target/self）");
        } else if (e.ref !== ctx.entity.binding) {
          this.error(p, `标签效果的 ref 应为 "${ctx.entity.binding}"，实际是 "${e.ref}"`);
        }
        continue;
      }
      const parts = e.ref.split(".");
      if (parts.length === 1) {
        if (!this.varIds.has(e.ref)) this.error(p, `效果引用了不存在的变量 "${e.ref}"`);
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
    for (const p of idents) this.checkIdent(p, path, ctx, allowString);
    for (const call of calls) {
      const sig =
        GAME_FUNCTIONS[call.name] ??
        (PURE_FUNCTIONS[call.name]
          ? { min: PURE_FUNCTIONS[call.name].arity[0], max: PURE_FUNCTIONS[call.name].arity[1] }
          : undefined);
      if (!sig) {
        this.error(path, `未知函数 "${call.name}"`);
        continue;
      }
      if (call.args.length < sig.min || call.args.length > sig.max) {
        this.error(
          path,
          `函数 ${call.name} 需要 ${sig.min === sig.max ? sig.min : `${sig.min}-${sig.max}`} 个参数，实际 ${call.args.length} 个`
        );
        continue;
      }
      if (call.name === "fired") {
        const arg = call.args[0];
        if (arg.kind !== "str") {
          this.error(path, `fired() 的参数必须是卡片 id 字符串字面量，如 fired("遇仙")`);
        } else if (!this.cardIds.has(arg.value)) {
          this.error(path, `fired() 引用了不存在的卡片 "${arg.value}"`);
        }
      }
      if (call.name === "tag") {
        if (!ctx.entity) {
          this.error(path, "tag() 只能在实体上下文（决策目标/曲线/实体事件）中使用");
        } else if (call.args[0].kind === "str" && !this.knownTags.has(call.args[0].value)) {
          this.warn(path, `标签 "${call.args[0].value}" 从未出现在任何实体或效果中`);
        }
      }
      if (AGGREGATES.has(call.name)) this.checkAggregate(call.name, call.args, path);
    }
  }

  private checkAggregate(name: string, args: Expr[], path: string): void {
    if (!this.isSim) {
      this.error(path, `聚合函数 ${name} 只在 sim 调度器中可用`);
      return;
    }
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
    if (name !== "count") {
      const attrArg = args[1];
      if (!attrArg || attrArg.kind !== "str") {
        this.error(path, `聚合函数 ${name} 的属性参数必须是字符串字面量`);
      } else if (!attrs.has(attrArg.value)) {
        this.error(path, `实体类型 "${typeArg.value}" 没有属性 "${attrArg.value}"`);
      }
    }
    const tagArg = name === "count" ? args[1] : args[2];
    if (tagArg) {
      if (tagArg.kind !== "str") {
        this.error(path, "聚合函数的标签过滤参数必须是字符串字面量");
      } else if (!this.knownTags.has(tagArg.value)) {
        this.warn(path, `标签 "${tagArg.value}" 从未出现在任何实体或效果中`);
      }
    }
  }

  private checkIdent(p: string[], path: string, ctx: ExprContext, allowString: boolean): void {
    const head = p[0];
    if (p.length === 1) {
      if (head === "turn") return;
      if (head === "time") {
        if (this.config.driver.kind !== "life") this.error(path, `"time" 只在 life 调度器中可用`);
        return;
      }
      if (head === "cycle") {
        if (!this.isSim) this.error(path, `"cycle" 只在 sim 调度器中可用`);
        return;
      }
      if (this.varIds.has(head) || this.derivedIds.has(head)) return;
      if (ctx.locals?.has(head)) return;
      this.error(path, `未知变量 "${head}"`);
      return;
    }
    if (p.length === 2) {
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
        if (!ctx.rowKeys.has(p[1])) this.error(path, `结算数据行没有字段 "${p[1]}"`);
        return;
      }
    }
    this.error(path, `无法解析 "${p.join(".")}"`);
  }
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

export type { CardDef };
