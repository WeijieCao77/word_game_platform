import { collectRefs, parseExpr, Expr } from "@/lib/expr";
import { CardDef, GameConfig, VariableDef } from "@/lib/schema";

// 内容库：让卡片跨游戏复用。
// 核心是「依赖打包」：分享时把卡片引用的变量定义一起存进库；
// 插入到别的游戏时自动补齐缺失变量——即插即用。
// v1 只收「独立卡」：不带 goto 链 / 结局引用 / 实体作用域 / fired() 外部依赖。

export const LIBRARY_CATEGORIES = ["机遇", "挑战", "日常", "抉择"] as const;
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export interface LibraryEntry {
  id: string;
  /** 展示名（默认取卡片 title 或 id） */
  name: string;
  category: string;
  /** 题材标签，如 修仙/电竞/凡人/通用 */
  tags: string[];
  card: CardDef;
  /** 卡片引用到的变量定义（插入时自动补齐） */
  requiredVars: VariableDef[];
  source: "official" | "creator" | "ai";
  author: string;
  createdAt: string;
}

/** 收集一张卡里出现的全部表达式（条件/效果/文案插值/选项） */
function cardExprSources(card: CardDef): string[] {
  const out: string[] = [];
  const pushTemplate = (t?: string): void => {
    if (!t) return;
    for (const m of t.matchAll(/\{([^{}]+)\}/g)) out.push(m[1]);
  };
  if (card.condition) out.push(card.condition);
  pushTemplate(card.text);
  for (const e of card.effects ?? []) if (e.value) out.push(e.value);
  for (const ch of card.choices ?? []) {
    if (ch.condition) out.push(ch.condition);
    pushTemplate(ch.label);
    pushTemplate(ch.text);
    for (const e of ch.effects ?? []) if (e.value) out.push(e.value);
  }
  return out;
}

function cardAsts(card: CardDef): Expr[] {
  const asts: Expr[] = [];
  for (const src of cardExprSources(card)) {
    try {
      asts.push(parseExpr(src));
    } catch {
      // 解析失败的表达式由校验器另行报告
    }
  }
  return asts;
}

/** 卡片引用的单段标识符集合（变量候选） */
function referencedIdents(card: CardDef): Set<string> {
  const idents = new Set<string>();
  for (const ast of cardAsts(card)) {
    for (const p of collectRefs(ast).idents) if (p.length === 1) idents.add(p[0]);
  }
  for (const e of card.effects ?? []) if (!e.ref.includes(".") && e.ref) idents.add(e.ref);
  for (const ch of card.choices ?? []) {
    for (const e of ch.effects ?? []) if (!e.ref.includes(".") && e.ref) idents.add(e.ref);
  }
  return idents;
}

/** 判断卡片是否可入库（独立卡），不可则给出原因 */
export function shareBlockReason(card: CardDef): string | null {
  if (card.goto) return "带 goto 跳转的卡依赖其他卡片，暂不能入库";
  if (card.ending) return "直接触发结局的卡依赖结局定义，暂不能入库";
  if (card.scope) return "实体事件卡依赖实体类型，暂不能入库";
  for (const ch of card.choices ?? []) {
    if (ch.goto) return "选项带 goto 跳转，依赖其他卡片，暂不能入库";
    if (ch.ending) return "选项直接触发结局，暂不能入库";
  }
  for (const ast of cardAsts(card)) {
    for (const call of collectRefs(ast).calls) {
      if (call.name === "fired") return "使用了 fired() 引用其他卡片，暂不能入库";
      if (["avg", "sum", "count", "max_of", "min_of", "tag"].includes(call.name)) {
        return "使用了实体聚合/标签函数，依赖实体定义，暂不能入库";
      }
    }
  }
  for (const e of card.effects ?? []) {
    if (e.ref.includes(".") || e.op === "add_tag" || e.op === "remove_tag") return "效果作用于实体，暂不能入库";
  }
  for (const ch of card.choices ?? []) {
    for (const e of ch.effects ?? []) {
      if (e.ref.includes(".") || e.op === "add_tag" || e.op === "remove_tag") return "选项效果作用于实体，暂不能入库";
    }
  }
  return null;
}

/** 提取卡片依赖的变量定义（从来源游戏的 vars 里带走） */
export function extractRequiredVars(card: CardDef, source: GameConfig): VariableDef[] {
  const idents = referencedIdents(card);
  return source.vars.filter((v) => idents.has(v.id));
}

// ---------------- 推荐排序 ----------------
// 内容库不是死列表，是跟着当前作品变的推荐库：
// 按「题材画像」给条目打分——库条目的标签出现在游戏文本里（江湖背景推江湖卡）、
// 依赖变量与游戏已有变量重合（即插即用）、条目名称与游戏文本的双字重合（兜底信号）。

const CJK_RE = /[一-鿿]/;

function cjkBigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    if (CJK_RE.test(text[i]) && CJK_RE.test(text[i + 1])) out.add(text[i] + text[i + 1]);
  }
  return out;
}

/** 游戏的题材画像文本：标题/简介/变量名/卡片标题与文案 */
function themeTextOf(config: GameConfig): string {
  const parts: string[] = [config.meta.title ?? "", config.meta.description ?? ""];
  for (const v of config.vars) parts.push(v.id, v.name ?? "");
  for (const c of config.cards.slice(0, 80)) parts.push(c.id, c.title ?? "", c.text);
  return parts.join(" ").toLowerCase();
}

export interface RankedLibraryEntry {
  entry: LibraryEntry;
  score: number;
  /** 达到推荐线（UI 可标「贴合本作」并置顶展示） */
  recommended: boolean;
}

/** 按与当前作品的贴合度排序（分数降序，同分保持原有顺序=最新在前） */
export function rankLibraryEntries(entries: LibraryEntry[], config: GameConfig): RankedLibraryEntry[] {
  const gameText = themeTextOf(config);
  const gameBigrams = cjkBigrams(gameText);
  const gameVarIds = new Set(config.vars.map((v) => v.id));
  const scored = entries.map((entry, i) => {
    let score = 0;
    for (const tag of entry.tags) {
      const t = tag.trim().toLowerCase();
      if (t && gameText.includes(t)) score += 3;
    }
    for (const v of entry.requiredVars) if (gameVarIds.has(v.id)) score += 2;
    // 名称/标签的双字重合：捕捉没有精确标签的题材相关性，权重压低当兜底
    let overlap = 0;
    for (const bg of cjkBigrams(`${entry.name} ${entry.tags.join(" ")}`)) {
      if (gameBigrams.has(bg)) overlap++;
    }
    score += Math.min(overlap, 6) * 0.5;
    return { entry, score, recommended: score >= 2, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map(({ entry, score, recommended }) => ({ entry, score, recommended }));
}

/** 把库中卡片插入目标配置：补缺失变量、避开 id 冲突，返回新配置 */
export function insertLibraryCard(config: GameConfig, entry: LibraryEntry): { config: GameConfig; cardId: string } {
  const next: GameConfig = structuredClone(config);
  let cardId = entry.card.id;
  const existing = new Set(next.cards.map((c) => c.id));
  let n = 2;
  while (existing.has(cardId)) cardId = `${entry.card.id}_${n++}`;
  const card = structuredClone(entry.card);
  card.id = cardId;
  // 库中的卡默认按事件卡插入：life/sim 需要 weight 才会出现
  if (card.weight === undefined && card.priority === undefined) card.weight = 1;
  next.cards.push(card);
  const varIds = new Set(next.vars.map((v) => v.id));
  for (const v of entry.requiredVars) {
    if (!varIds.has(v.id)) {
      next.vars.push(structuredClone(v));
      varIds.add(v.id);
    }
  }
  return { config: next, cardId };
}
