import { GameConfig, GameState } from "@/lib/schema";
import {
  initState,
  step,
  choose,
  pendingChoices,
  performAction,
  endTurn,
  availableActions,
  eligibleTargets,
  createRng,
} from "@/lib/engine";

// 模拟校验：随机策略跑 N 局，统计结局覆盖率与卡片触发情况。
// 这是"不可达结局"最有力的检测手段，也是 AI 策划的 simulate 工具。

export interface SimulationReport {
  runs: number;
  /** 每个结局的触发次数（含 __implicit__ 兜底与 __error__） */
  endings: Record<string, { title: string; count: number; ratio: number }>;
  /** 从未触发过的结局 id 列表（作者最该看的一行） */
  unreachedEndings: string[];
  /** 从未出现过的卡片 id 列表 */
  unfiredCards: string[];
  avgTurns: number;
  minTurns: number;
  maxTurns: number;
  /** 各变量结束时的均值 */
  finalVarMeans: Record<string, number>;
  /** 模拟中发生的运行时错误（表达式求值等），去重后最多 10 条 */
  errors: string[];
}

const MAX_STEPS_PER_RUN = 2000;

export function simulate(config: GameConfig, runs = 200, baseSeed = 12345): SimulationReport {
  const endingCount = new Map<string, { title: string; count: number }>();
  const firedCards = new Set<string>();
  const errors = new Set<string>();
  let totalTurns = 0;
  let minTurns = Infinity;
  let maxTurns = 0;
  const varSums: Record<string, number> = {};
  const seedGen = createRng(baseSeed);

  for (let i = 0; i < runs; i++) {
    const seed = Math.floor(seedGen.next() * 0xffffffff);
    const pickRng = createRng(seed ^ 0x9e3779b9);
    let state: GameState;
    try {
      state = initState(config, seed);
      let guard = 0;
      while (!state.ended && guard++ < MAX_STEPS_PER_RUN) {
        if (state.pendingCard) {
          const options = pendingChoices(config, state);
          if (options.length === 0) break;
          const pick = options[pickRng.int(0, options.length - 1)];
          state = choose(config, state, pick.id);
        } else if (config.driver.kind === "life") {
          state = step(config, state);
        } else if (config.driver.kind === "sim") {
          // 随机策略：每回合随机执行 0~2 个可用决策，再结束回合
          const wanted = pickRng.int(0, 2);
          for (let a = 0; a < wanted; a++) {
            const avail = availableActions(config, state).filter((v) => v.available);
            if (avail.length === 0) break;
            const action = avail[pickRng.int(0, avail.length - 1)];
            try {
              if (action.needsTarget) {
                const targets = eligibleTargets(config, state, action.id);
                if (targets.length === 0) continue;
                state = performAction(config, state, action.id, targets[pickRng.int(0, targets.length - 1)].id);
              } else {
                state = performAction(config, state, action.id);
              }
            } catch {
              // 条件竞争等情况下跳过该决策
            }
            if (state.ended) break;
          }
          if (!state.ended && !state.pendingCard) state = endTurn(config, state);
        } else {
          break;
        }
      }
    } catch (err) {
      errors.add(err instanceof Error ? err.message : String(err));
      continue;
    }
    for (const id of Object.keys(state.fired)) firedCards.add(id);
    const endedId = state.ended?.endingId ?? "__unfinished__";
    const title = state.ended?.title ?? "（未在步数上限内结束）";
    const entry = endingCount.get(endedId) ?? { title, count: 0 };
    entry.count += 1;
    endingCount.set(endedId, entry);
    // sim 的 turn 是周期内回合数，换算成全局回合数再统计局长
    const runTurns =
      config.driver.kind === "sim"
        ? ((state.cycle ?? 1) - 1) * (config.driver.time.turnsPerCycle ?? 1) + state.turn
        : state.turn;
    totalTurns += runTurns;
    minTurns = Math.min(minTurns, runTurns);
    maxTurns = Math.max(maxTurns, runTurns);
    for (const [k, v] of Object.entries(state.vars)) varSums[k] = (varSums[k] ?? 0) + v;
  }

  const completed = [...endingCount.values()].reduce((s, e) => s + e.count, 0);
  const endings: SimulationReport["endings"] = {};
  for (const [id, e] of endingCount) {
    endings[id] = { title: e.title, count: e.count, ratio: completed ? e.count / completed : 0 };
  }
  return {
    runs,
    endings,
    unreachedEndings: config.endings.filter((e) => !endingCount.has(e.id)).map((e) => e.id),
    unfiredCards: config.cards.filter((c) => !firedCards.has(c.id)).map((c) => c.id),
    avgTurns: completed ? Math.round((totalTurns / completed) * 10) / 10 : 0,
    minTurns: Number.isFinite(minTurns) ? minTurns : 0,
    maxTurns,
    finalVarMeans: Object.fromEntries(
      Object.entries(varSums).map(([k, v]) => [k, completed ? Math.round((v / completed) * 10) / 10 : 0])
    ),
    errors: [...errors].slice(0, 10),
  };
}

/** 给 AI / 校验面板的人话摘要 */
export function summarizeReport(r: SimulationReport): string {
  const lines: string[] = [];
  lines.push(`模拟 ${r.runs} 局：平均 ${r.avgTurns} 步结束（${r.minTurns}~${r.maxTurns}）。`);
  const sorted = Object.entries(r.endings).sort((a, b) => b[1].count - a[1].count);
  for (const [id, e] of sorted) {
    lines.push(`结局「${e.title}」(${id})：${Math.round(e.ratio * 100)}%`);
  }
  if (r.unreachedEndings.length) lines.push(`⚠ 从未触发的结局：${r.unreachedEndings.join("、")}`);
  if (r.unfiredCards.length) lines.push(`⚠ 从未出现的卡片：${r.unfiredCards.slice(0, 20).join("、")}${r.unfiredCards.length > 20 ? ` 等 ${r.unfiredCards.length} 张` : ""}`);
  if (r.errors.length) lines.push(`⚠ 运行时错误：${r.errors.join("；")}`);
  return lines.join("\n");
}
