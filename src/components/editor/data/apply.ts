import { GameConfig } from "@/lib/schema";
import { Table, isNumericColumn, toId, toNumber } from "./parse";

// 把解析好的表格变成游戏配置的一部分：
//   实体名单 —— 选手/弟子/门客这类「一个个的人」，进 entityTypes + entities
//   数据表   —— 赛程/对手表这类「一行行的场次」，进某个结算的 data
// 两条路都只改配置对象，存库仍走原来的保存流程。

export interface ColumnPlan {
  column: string;
  /** name=当作名字；attr=数值属性；tag=标签；skip=不导入 */
  use: "name" | "attr" | "tag" | "skip";
}

/** 给一张表猜一套默认映射：第一列当名字，数值列当属性，其余先不导入 */
export function suggestPlan(table: Table): ColumnPlan[] {
  let nameTaken = false;
  return table.columns.map((c) => {
    if (!nameTaken && !isNumericColumn(table.rows, c)) {
      nameTaken = true;
      return { column: c, use: "name" as const };
    }
    if (isNumericColumn(table.rows, c)) return { column: c, use: "attr" as const };
    return { column: c, use: "skip" as const };
  });
}

export interface EntityImportResult {
  config: GameConfig;
  typeId: string;
  added: number;
  skipped: number;
  attrs: string[];
}

/**
 * 导入成实体名单。已存在同名实体类型就并入（补齐属性），否则新建一个。
 * 同名实体视为同一个人：后导入的覆盖先前的数值，不会出现两个「一诺」。
 */
export function importEntities(
  config: GameConfig,
  table: Table,
  plan: ColumnPlan[],
  typeName: string,
  defaultTag?: string
): EntityImportResult {
  const nameCol = plan.find((p) => p.use === "name")?.column;
  if (!nameCol) throw new Error("请先指定哪一列是名字");

  const types = [...(config.entityTypes ?? [])];
  let type = types.find((t) => t.name === typeName || t.id === typeName);
  const usedTypeIds = new Set(types.map((t) => t.id));
  if (!type) {
    type = { id: toId(typeName, usedTypeIds), name: typeName, attributes: [] };
    types.push(type);
  }

  // 属性：沿用同名的旧属性，新的追加
  const usedAttrIds = new Set(type.attributes.map((a) => a.id));
  const attrCols = plan.filter((p) => p.use === "attr").map((p) => p.column);
  const attrIdOf = new Map<string, string>();
  for (const col of attrCols) {
    const existing = type.attributes.find((a) => a.name === col);
    attrIdOf.set(col, existing ? existing.id : toId(col, usedAttrIds));
    if (!existing) {
      type.attributes.push({ id: attrIdOf.get(col)!, name: col });
    }
  }

  const tagCols = plan.filter((p) => p.use === "tag").map((p) => p.column);
  const entities = [...(config.entities ?? [])];
  const usedEntityIds = new Set(entities.map((e) => e.id));
  let added = 0;
  let skipped = 0;

  for (const row of table.rows) {
    const name = (row[nameCol] ?? "").trim();
    if (!name) {
      skipped += 1;
      continue;
    }
    const attrs: Record<string, number> = {};
    for (const col of attrCols) attrs[attrIdOf.get(col)!] = toNumber(row[col]);
    const tags = tagCols.map((c) => (row[c] ?? "").trim()).filter(Boolean);
    if (defaultTag && !tags.includes(defaultTag)) tags.push(defaultTag);

    const same = entities.find((e) => e.type === type!.id && e.name === name);
    if (same) {
      same.attrs = { ...same.attrs, ...attrs };
      if (tags.length > 0) same.tags = Array.from(new Set([...(same.tags ?? []), ...tags]));
    } else {
      entities.push({
        id: toId(name, usedEntityIds),
        type: type.id,
        name,
        attrs,
        ...(tags.length > 0 ? { tags } : {}),
      });
    }
    added += 1;
  }

  return {
    config: { ...config, entityTypes: types, entities },
    typeId: type.id,
    added,
    skipped,
    attrs: attrCols,
  };
}

/** 导入成某个结算的数据表（赛程/对手表）：数值列转成数字，其余保留原文 */
export function importSettlementData(
  config: GameConfig,
  table: Table,
  plan: ColumnPlan[],
  settlementId: string
): { config: GameConfig; rows: number } {
  const cols = plan.filter((p) => p.use !== "skip").map((p) => p.column);
  if (cols.length === 0) throw new Error("至少要保留一列");
  const data = table.rows.map((row) => {
    const out: Record<string, number | string> = {};
    for (const c of cols) {
      out[c] = isNumericColumn(table.rows, c) ? toNumber(row[c]) : (row[c] ?? "");
    }
    return out;
  });
  const settlements = (config.settlements ?? []).map((st) => (st.id === settlementId ? { ...st, data } : st));
  if (!settlements.some((st) => st.id === settlementId)) {
    throw new Error(`结算「${settlementId}」不存在——先让 AI 建一个结算，再把数据表挂上去`);
  }
  return { config: { ...config, settlements }, rows: data.length };
}
