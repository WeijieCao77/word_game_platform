import { collectRefs, parseExpr, ExprError, Expr, PURE_FUNCTIONS } from "@/lib/expr";
import { GameConfig, CardDef } from "./types";
import { GameConfigSchema } from "./zod";

// 语义校验：结构合法之后，检查引用是否悬空、表达式是否可解析、
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

const RESERVED = new Set(["time", "turn", "true", "false", "fired"]);

const GAME_FUNCTIONS: Record<string, { min: number; max: number }> = {
  rand: { min: 0, max: 0 },
  randint: { min: 2, max: 2 },
  chance: { min: 1, max: 1 },
  fired: { min: 1, max: 1 },
};

class Validator {
  issues: ValidationIssue[] = [];
  private varIds = new Set<string>();
  private cardIds = new Set<string>();
  private endingIds = new Set<string>();

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
    this.checkUnique("vars", c.vars, "变量");
    this.checkUnique("cards", c.cards, "卡片");
    this.checkUnique("endings", c.endings, "结局");
    for (const v of c.vars) this.varIds.add(v.id);
    for (const card of c.cards) this.cardIds.add(card.id);
    for (const e of c.endings) this.endingIds.add(e.id);

    for (const [i, v] of c.vars.entries()) {
      if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
        this.error(`vars[${i}]`, `变量 "${v.id}" 的 min 大于 max`);
      }
    }

    // 卡片
    const isLife = c.driver.kind === "life";
    for (const [i, card] of c.cards.entries()) {
      const base = `cards[${i}](${card.id})`;
      if (card.condition) this.checkExpr(card.condition, `${base}.condition`);
      this.checkTemplate(card.text, `${base}.text`);
      this.checkEffects(card.effects, `${base}.effects`);
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
      if (!isLife && (card.weight !== undefined || card.priority !== undefined || card.cooldown !== undefined)) {
        this.warn(base, `story 调度器不使用 weight/priority/cooldown（卡片 "${card.id}"）`);
      }
      const cseen = new Set<string>();
      for (const [j, ch] of (card.choices ?? []).entries()) {
        const cb = `${base}.choices[${j}](${ch.id})`;
        if (cseen.has(ch.id)) this.error(cb, `卡片 "${card.id}" 的选项 id "${ch.id}" 重复`);
        cseen.add(ch.id);
        if (ch.condition) this.checkExpr(ch.condition, `${cb}.condition`);
        this.checkTemplate(ch.label, `${cb}.label`);
        if (ch.text) this.checkTemplate(ch.text, `${cb}.text`);
        this.checkEffects(ch.effects, `${cb}.effects`);
        if (ch.goto && ch.ending) this.error(cb, `选项 "${ch.id}" 不能同时设置 goto 和 ending`);
        if (ch.goto && !this.cardIds.has(ch.goto)) {
          this.error(`${cb}.goto`, `选项 "${ch.id}" 的 goto 指向不存在的卡 "${ch.goto}"`);
        }
        if (ch.ending && !this.endingIds.has(ch.ending)) {
          this.error(`${cb}.ending`, `选项 "${ch.id}" 引用了不存在的结局 "${ch.ending}"`);
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
    } else {
      const t = c.driver.time;
      if (t.max <= t.start) this.error("driver.time", "时间上限 max 必须大于起始值 start");
      if (!c.cards.some((card) => (card.weight ?? 0) > 0 || card.priority !== undefined)) {
        this.error("cards", "life 调度器需要至少一张可抽取的卡（weight>0）或主线卡（priority）");
      }
      this.checkLifeOrphans();
    }

    // 结局
    const written = this.collectWrittenVars();
    const referenced = this.collectReferencedEndings();
    for (const [i, e] of c.endings.entries()) {
      const base = `endings[${i}](${e.id})`;
      if (e.condition) this.checkExpr(e.condition, `${base}.condition`);
      if (e.text) this.checkTemplate(e.text, `${base}.text`);
      if (!e.condition && !referenced.has(e.id)) {
        this.warn(base, `结局 "${e.title}" 既没有触发条件，也没有任何卡片/选项引用它，永远不会出现`);
      }
      if (e.condition) this.checkEndingReachabilityHeuristic(e.condition, base, e.title, written);
    }

    // 全局文案
    if (c.text?.turnHeader) this.checkTemplate(c.text.turnHeader, "text.turnHeader");
    if (c.text?.timeoutEnding?.text) this.checkTemplate(c.text.timeoutEnding.text, "text.timeoutEnding.text");
    if (isLife && !c.text?.timeoutEnding) {
      this.warn("text", "life 调度器建议配置 timeoutEnding（时间走完的兜底结局），否则使用系统默认文案");
    }
  }

  /** story：从起始卡沿 goto/choices.goto 做可达性分析，报孤儿卡 */
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
    }
    for (const card of this.config.cards) {
      if (!visited.has(card.id)) {
        this.warn(`cards(${card.id})`, `卡片 "${card.id}" 从起始卡无法到达（孤儿卡）`);
      }
    }
    // 死端卡：无选项、无 goto、无 ending —— 引擎会以中性"完"结束，提醒作者
    for (const id of visited) {
      const card = byId.get(id);
      if (card && !card.choices?.length && !card.goto && !card.ending) {
        this.warn(`cards(${card.id})`, `卡片 "${card.id}" 是死端（无选项/goto/ending），游戏会在此以默认结局收尾`);
      }
    }
  }

  /** life：既不进随机池、不是主线卡、也没有任何 goto 指向的卡 = 永远不会出现 */
  private checkLifeOrphans(): void {
    const linked = new Set<string>();
    for (const card of this.config.cards) {
      if (card.goto) linked.add(card.goto);
      for (const ch of card.choices ?? []) if (ch.goto) linked.add(ch.goto);
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
    for (const card of this.config.cards) {
      for (const e of card.effects ?? []) written.add(e.ref);
      for (const ch of card.choices ?? []) for (const e of ch.effects ?? []) written.add(e.ref);
    }
    return written;
  }

  private collectReferencedEndings(): Set<string> {
    const refs = new Set<string>();
    for (const card of this.config.cards) {
      if (card.ending) refs.add(card.ending);
      for (const ch of card.choices ?? []) if (ch.ending) refs.add(ch.ending);
    }
    return refs;
  }

  /** 条件结局引用的变量若从未被任何效果修改、又与时间无关，多半永远不触发 */
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
      return; // 解析错误已另行报告
    }
    const { idents, calls } = collectRefs(ast);
    if (calls.some((c) => c.name !== "fired")) return; // 含随机等函数时不做静态判断
    let touchesDynamic = calls.some((c) => c.name === "fired");
    for (const p of idents) {
      const head = p[0];
      if (head === "turn" || head === "time") touchesDynamic = true;
      if (this.varIds.has(head) && written.has(head)) touchesDynamic = true;
    }
    if ((idents.length > 0 || calls.length > 0) && !touchesDynamic) {
      this.warn(path, `结局 "${title}" 的条件引用的变量从未被任何效果修改，可能永远不会触发`);
    }
  }

  private checkEffects(effects: { ref: string; op: string; value: string }[] | undefined, path: string): void {
    for (const [i, e] of (effects ?? []).entries()) {
      if (!this.varIds.has(e.ref)) {
        this.error(`${path}[${i}]`, `效果引用了不存在的变量 "${e.ref}"`);
      }
      this.checkExpr(e.value, `${path}[${i}].value`);
    }
  }

  private checkTemplate(template: string, path: string): void {
    for (const m of template.matchAll(/\{([^{}]+)\}/g)) {
      this.checkExpr(m[1], `${path} 中的 {${m[1]}}`);
    }
  }

  private checkExpr(source: string, path: string): void {
    let ast: Expr;
    try {
      ast = parseExpr(source);
    } catch (err) {
      this.error(path, err instanceof ExprError ? err.message : String(err));
      return;
    }
    const { idents, calls } = collectRefs(ast);
    for (const p of idents) {
      if (p.length > 1) {
        this.error(path, `无法解析 "${p.join(".")}"（当前版本不支持点分引用）`);
        continue;
      }
      const head = p[0];
      if (head === "turn") continue;
      if (head === "time") {
        if (this.config.driver.kind !== "life") {
          this.error(path, `"time" 只在 life 调度器中可用`);
        }
        continue;
      }
      if (!this.varIds.has(head)) this.error(path, `未知变量 "${head}"`);
    }
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
    }
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
