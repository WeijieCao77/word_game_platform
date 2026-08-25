import { BracketDef, GameConfig, GameState } from "@/lib/schema";
import { Value, evaluate } from "@/lib/expr";
import { GameScope, applyEffects, renderText, truthy } from "./internal";
import { Rng } from "./rng";

/**
 * 淘汰赛对阵表。
 *
 * 联赛只解决「谁排第几」，解决不了「谁淘汰了谁」——而一切赛事题材最紧张的部分
 * 恰恰在淘汰赛。种子从挂接联赛的积分榜里取（胜场 → 净胜 → 名字），
 * 一轮一轮打到只剩一个：玩家自己的比赛走 outcomes 判定，NPC 之间按强度加随机数
 * 直接算。整张表在触发的那个回合里一次打完，每一轮都写进日志。
 */

/** 按积分榜取前 size 名当种子；榜上没有的按队伍表顺序补齐 */
export function seedsOf(config: GameConfig, state: GameState, def: BracketDef): string[] {
  const league = (config.leagues ?? []).find((l) => l.id === def.league);
  if (!league) throw new Error(`对阵表 "${def.id}" 挂接了不存在的联赛 "${def.league}"`);
  const table = state.leagues?.[def.league] ?? {};
  const rows = league.teams.map((t) => ({
    name: t.name,
    strength: t.strength,
    ...(table[t.name] ?? { w: 0, l: 0, diff: 0 }),
  }));
  rows.sort((a, b) => b.w - a.w || b.diff - a.diff || b.strength - a.strength || a.name.localeCompare(b.name, "zh"));
  return rows.slice(0, def.size).map((r) => r.name);
}

function strengthOf(config: GameConfig, def: BracketDef, name: string): number {
  const league = (config.leagues ?? []).find((l) => l.id === def.league);
  return league?.teams.find((t) => t.name === name)?.strength ?? 50;
}

/** 标准种子对阵：1v8、2v7、3v6、4v5 */
function pairUp(alive: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < alive.length / 2; i++) pairs.push([alive[i], alive[alive.length - 1 - i]]);
  return pairs;
}

export function runBracket(
  config: GameConfig,
  state: GameState,
  scope: GameScope,
  rng: Rng,
  def: BracketDef
): void {
  const league = (config.leagues ?? []).find((l) => l.id === def.league);
  if (!league) return;
  const me = league.playerTeam;
  let alive = seedsOf(config, state, def);
  const rounds: { round: number; pairs: [string, string][]; winners: string[] }[] = [];
  let playerRounds = 0;
  let playerOut = false;

  for (let round = 1; alive.length > 1; round++) {
    const pairs = pairUp(alive);
    const winners: string[] = [];
    for (const [a, b] of pairs) {
      const mine = a === me || b === me;
      if (mine && !playerOut) {
        playerRounds = round;
        const oppName = a === me ? b : a;
        const row: Record<string, number | string> = { 名称: oppName, 强度: strengthOf(config, def, oppName) };
        const locals: Record<string, Value> = { round };
        for (const cp of def.compute ?? []) {
          locals[cp.id] = evaluate(cp.expr, scope.withBindings({ row, locals }));
        }
        const outScope = scope.withBindings({ row, locals });
        let won = false;
        for (const o of def.outcomes) {
          if (!truthy(evaluate(o.condition, outScope))) continue;
          applyEffects(config, state, outScope, o.effects, {});
          if (o.text) state.log.push({ kind: "settlement", text: renderText(o.text, outScope), turn: state.turn });
          // leagueResult 在这里表示「这一轮赢没赢」
          won = o.leagueResult === "win";
          break;
        }
        winners.push(won ? me : oppName);
        if (!won) {
          playerOut = true;
          if (def.eliminatedText) {
            state.log.push({
              kind: "settlement",
              text: renderText(def.eliminatedText, scope.withBindings({ locals: { round } })),
              turn: state.turn,
            });
          }
        }
      } else {
        // NPC 之间：强度加随机数，强的更可能赢但不是必然
        const sa = strengthOf(config, def, a) + rng.int(-10, 10);
        const sb = strengthOf(config, def, b) + rng.int(-10, 10);
        winners.push(sa >= sb ? a : b);
      }
    }
    rounds.push({ round, pairs, winners });
    alive = winners;
  }

  const champion = alive[0] ?? me;
  if (champion === me) {
    if (def.championEffects) applyEffects(config, state, scope, def.championEffects, {});
    if (def.championText) state.log.push({ kind: "settlement", text: renderText(def.championText, scope), turn: state.turn });
  }
  if (!state.brackets) state.brackets = {};
  state.brackets[def.id] = { champion, playerRounds, rounds };
}
