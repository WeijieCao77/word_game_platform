// 活联赛：一轮比赛记账（leagueTick——玩家胜负 + 对手镜像 + NPC 互赛）与积分榜排序（leagueStandings）。
// 想改「NPC 之间怎么打」「排名怎么排」「联赛表长什么样」，来这里。
// 记账由 settle.ts 的结算 outcome（leagueResult）驱动；排名同款排序在 internal.ts 的 rank() 里也有一份。

import { GameConfig, GameState, LeagueDef } from "@/lib/schema";
import { Rng } from "./rng";

/** 活联赛推进一轮：玩家胜负记账（对手镜像），其余队伍确定性配对互赛 */
export function leagueTick(
  state: GameState,
  league: LeagueDef,
  rng: Rng,
  playerResult: "win" | "loss",
  opponentName: string | undefined
): void {
  if (!state.leagues) state.leagues = {};
  if (!state.leagues[league.id]) {
    state.leagues[league.id] = Object.fromEntries(league.teams.map((t) => [t.name, { w: 0, l: 0, diff: 0 }]));
  }
  const table = state.leagues[league.id];
  const rec = (name: string): { w: number; l: number; diff: number } => {
    if (!table[name]) table[name] = { w: 0, l: 0, diff: 0 };
    return table[name];
  };
  const me = rec(league.playerTeam);
  if (playerResult === "win") {
    me.w += 1;
    me.diff += 1;
  } else {
    me.l += 1;
    me.diff -= 1;
  }
  if (opponentName && opponentName !== league.playerTeam) {
    const opp = rec(opponentName);
    if (playerResult === "win") {
      opp.l += 1;
      opp.diff -= 1;
    } else {
      opp.w += 1;
      opp.diff += 1;
    }
  }
  // 其余队伍两两互赛：按轮次旋转确定性配对，logistic 胜率（同一 rng 流，可复现）
  const rest = league.teams
    .map((t) => t.name)
    .filter((n) => n !== league.playerTeam && n !== opponentName);
  const round = me.w + me.l;
  const rotated = rest.map((_, i) => rest[(i + round) % rest.length]);
  for (let i = 0; i + 1 < rotated.length; i += 2) {
    const a = rotated[i];
    const b = rotated[i + 1];
    const sa = league.teams.find((t) => t.name === a)?.strength ?? 50;
    const sb = league.teams.find((t) => t.name === b)?.strength ?? 50;
    const pa = 1 / (1 + Math.exp(-(sa - sb) / 12));
    const aWins = rng.next() < pa;
    const ra = rec(a);
    const rb = rec(b);
    if (aWins) {
      ra.w += 1;
      ra.diff += 1;
      rb.l += 1;
      rb.diff -= 1;
    } else {
      rb.w += 1;
      rb.diff += 1;
      ra.l += 1;
      ra.diff -= 1;
    }
  }
}

/** 联赛积分榜排序（胜场 → 净胜 → 名称），返回带排名的行 */
export function leagueStandings(
  config: GameConfig,
  state: GameState,
  leagueId: string
): { rank: number; name: string; w: number; l: number; diff: number; isPlayer: boolean }[] {
  const league = (config.leagues ?? []).find((lg) => lg.id === leagueId);
  if (!league) return [];
  const table = state.leagues?.[leagueId] ?? Object.fromEntries(league.teams.map((t) => [t.name, { w: 0, l: 0, diff: 0 }]));
  const rows = league.teams.map((t) => ({ name: t.name, ...(table[t.name] ?? { w: 0, l: 0, diff: 0 }) }));
  rows.sort((a, b) => b.w - a.w || b.diff - a.diff || a.name.localeCompare(b.name, "zh"));
  return rows.map((r, i) => ({ rank: i + 1, ...r, isPlayer: r.name === league.playerTeam }));
}
