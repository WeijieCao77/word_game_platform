import { GameConfig, GameState, RelationDef } from "@/lib/schema";

/**
 * 关系网：两个角色**之间**的状态。
 *
 * 平台原本只有全局变量和「每个角色自己的属性」，谁和谁的关系无处安放。
 * 队内羁绊、恋爱好感、门派恩怨、宫斗结盟——全都需要这一层。
 *
 * 存储是惰性的：只有被读过或改过的那一对才落进存档。没碰过的按 initial 现算，
 * 所以 500 个角色不会铺开 12 万条记录，存档也不会爆。
 */

/** 一对角色的存储键：两个 id 排序后拼接，保证 (A,B) 和 (B,A) 是同一条 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function relationDef(config: GameConfig, id: string): RelationDef | undefined {
  return (config.relations ?? []).find((r) => r.id === id);
}

function clampRelation(def: RelationDef, v: number): number {
  let n = v;
  if (def.min !== undefined) n = Math.max(def.min, n);
  if (def.max !== undefined) n = Math.min(def.max, n);
  return n;
}

/**
 * 读一对角色的关系值。没碰过就用 initFn 现算一个初值并落盘——
 * 「现算」这一步交给调用方，因为 initial 表达式要在带 self/other 绑定的作用域里求值。
 */
export function readRelation(
  config: GameConfig,
  state: GameState,
  relId: string,
  a: string,
  b: string,
  initFn: (a: string, b: string) => number
): number {
  const def = relationDef(config, relId);
  if (!def) throw new Error(`关系 "${relId}" 不存在`);
  if (a === b) return 0; // 自己跟自己没有关系可言
  const key = pairKey(a, b);
  const table = state.relations?.[relId];
  if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  const v = clampRelation(def, initFn(a, b));
  if (!state.relations) state.relations = {};
  if (!state.relations[relId]) state.relations[relId] = {};
  state.relations[relId][key] = v;
  return v;
}

/** 改一对角色的关系值（增量） */
export function changeRelation(
  config: GameConfig,
  state: GameState,
  relId: string,
  a: string,
  b: string,
  delta: number,
  initFn: (a: string, b: string) => number
): void {
  const def = relationDef(config, relId);
  if (!def) throw new Error(`关系 "${relId}" 不存在`);
  if (a === b) return;
  const current = readRelation(config, state, relId, a, b, initFn);
  state.relations![relId][pairKey(a, b)] = clampRelation(def, current + delta);
}

/** 带某个标签的同类角色 id 列表——关系聚合与组内群改都按它取范围 */
export function taggedMembers(config: GameConfig, state: GameState, relId: string, tag?: string): string[] {
  const def = relationDef(config, relId);
  if (!def) throw new Error(`关系 "${relId}" 不存在`);
  const out: string[] = [];
  for (const e of config.entities ?? []) {
    if (e.type !== def.entityType) continue;
    const st = state.entities?.[e.id];
    if (!st) continue;
    if (tag && !st.tags.includes(tag)) continue;
    out.push(e.id);
  }
  return out;
}

/** 组内两两的关系值。成员少（首发五人这种），N² 完全够用 */
export function groupPairs(members: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) pairs.push([members[i], members[j]]);
  }
  return pairs;
}
