import { GameConfig, GameState } from "@/lib/schema";
import {
  initState,
  step,
  choose,
  pendingChoices,
  pendingInput,
  submitInput,
  searchKeyword,
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
  /** 早终局：在前 earlyThreshold 个全局回合内就出结局的局占比（开局即死检测） */
  earlyEndRate: number;
  earlyThreshold: number;
  /** 各变量结束时的均值 */
  finalVarMeans: Record<string, number>;
  /** 模拟中发生的运行时错误（表达式求值等），去重后最多 10 条 */
  errors: string[];
  /** 内容体检：一局里一字不差重复的叙事段落占比（>0.2 就该配 textVariants 了） */
  verbatimRepeatRatio: number;
  /** 内容体检：局均触发 ≥3 次却没有 textVariants 的卡片（玩家要把同一段读好几遍） */
  hotCards: { id: string; perRun: number }[];
  /** 内容体检：落进兜底结局（timeoutEnding / 未具名收尾）的局占比 */
  implicitEndingRatio: number;
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
  // 内容体检累加器：重复段落、热卡、兜底结局
  let totalLines = 0;
  let repeatedLines = 0;
  const cardHits = new Map<string, number>();
  let implicitEnds = 0;

  // 期望局长：life = 时间轴长度；sim = 周期数×每周期回合数；story 无固定长度不检测
  let expectedLength = 0;
  if (config.driver.kind === "life") {
    const t = config.driver.time;
    expectedLength = Math.max(1, Math.ceil((t.max - t.start) / (t.step || 1)));
  } else if (config.driver.kind === "sim") {
    const t = config.driver.time;
    // 开放式生涯（无 maxCycles）没有固定局长，开局即死检测不适用
    expectedLength = t.maxCycles === undefined ? 0 : Math.max(1, t.maxCycles * (t.turnsPerCycle ?? 1));
  }
  const earlyThreshold = expectedLength > 0 ? Math.max(2, Math.ceil(expectedLength * 0.1)) : 0;
  let earlyEnds = 0;

  for (let i = 0; i < runs; i++) {
    const seed = Math.floor(seedGen.next() * 0xffffffff);
    const pickRng = createRng(seed ^ 0x9e3779b9);
    let state: GameState;
    try {
      state = initState(config, seed);
      let guard = 0;
      const searchEntries = config.search?.entries ?? [];
      while (!state.ended && guard++ < MAX_STEPS_PER_RUN) {
        // 全局检索台：随机策略以一定概率查词（覆盖检索解锁的线索与结局路径）
        if (searchEntries.length > 0 && pickRng.next() < 0.35) {
          const e = searchEntries[pickRng.int(0, searchEntries.length - 1)];
          state = searchKeyword(config, state, e.keywords[pickRng.int(0, e.keywords.length - 1)]);
          if (state.ended) break;
          // 这一轮花在查资料上（玩家先检索再决策），下一轮再处理选项/推进
          continue;
        }
        if (state.pendingCard) {
          const options = pendingChoices(config, state);
          const gate = pendingInput(config, state);
          if (gate && (options.length === 0 || pickRng.next() < 0.5)) {
            // 关键词输入门：随机策略从该卡的答案键里挑一个词提交（模拟「玩家想到了」），
            // 两成概率输错一次以覆盖 fallback 路径
            const card = config.cards.find((c) => c.id === state.pendingCard)!;
            const answers = card.input!.answers;
            if (pickRng.next() < 0.2) {
              state = submitInput(config, state, `__miss_${pickRng.int(0, 999)}`);
            }
            if (state.pendingCard === card.id) {
              const a = answers[pickRng.int(0, answers.length - 1)];
              state = submitInput(config, state, a.keywords[pickRng.int(0, a.keywords.length - 1)]);
              // 命中了带 condition 的锁定答案可能无效：仍停在原卡则强制走一遍全部答案键
              if (state.pendingCard === card.id) {
                for (const alt of answers) {
                  state = submitInput(config, state, alt.keywords[0]);
                  if (state.pendingCard !== card.id || state.ended) break;
                }
              }
            }
            if (state.pendingCard === card.id && options.length === 0) break;
          } else {
            if (options.length === 0) break;
            const pick = options[pickRng.int(0, options.length - 1)];
            state = choose(config, state, pick.id);
          }
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
    // 这一局里，玩家实际读到的叙事段落有多少是一字不差重复的
    const seenLines = new Set<string>();
    for (const entry of state.log) {
      if (entry.kind === "header" || !entry.text) continue;
      totalLines += 1;
      if (seenLines.has(entry.text)) repeatedLines += 1;
      else seenLines.add(entry.text);
    }
    for (const [id, n] of Object.entries(state.fired)) cardHits.set(id, (cardHits.get(id) ?? 0) + n);
    if (state.ended && (state.ended.endingId === "__implicit__" || !state.ended.endingId)) implicitEnds += 1;
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
    if (earlyThreshold > 0 && state.ended && runTurns <= earlyThreshold) earlyEnds += 1;
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
    earlyEndRate: completed ? Math.round((earlyEnds / completed) * 1000) / 1000 : 0,
    earlyThreshold,
    finalVarMeans: Object.fromEntries(
      Object.entries(varSums).map(([k, v]) => [k, completed ? Math.round((v / completed) * 10) / 10 : 0])
    ),
    verbatimRepeatRatio: totalLines ? Math.round((repeatedLines / totalLines) * 1000) / 1000 : 0,
    hotCards: [...cardHits.entries()]
      .map(([id, n]) => ({ id, perRun: completed ? Math.round((n / completed) * 10) / 10 : 0 }))
      .filter((c) => c.perRun >= 3 && !(config.cards.find((k) => k.id === c.id)?.textVariants?.length))
      .sort((a, b) => b.perRun - a.perRun)
      .slice(0, 8),
    implicitEndingRatio: completed ? Math.round((implicitEnds / completed) * 1000) / 1000 : 0,
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
  if (r.earlyThreshold > 0 && r.earlyEndRate > 0.03) {
    lines.push(
      `⚠ 开局即死：${Math.round(r.earlyEndRate * 100)}% 的局在前 ${r.earlyThreshold} 回合内就出结局——玩家还没进入状态就被判负，必须修：负面结局改成「连续多次不达标」判定（计数变量），或提高门槛/推迟生效回合，并在触发前给预警事件。`
    );
  }
  if (r.verbatimRepeatRatio > 0.2) {
    lines.push(
      `⚠ 内容重复：一局里 ${Math.round(r.verbatimRepeatRatio * 100)}% 的段落是一字不差读过的——` +
        `玩家会觉得"就这么点东西翻来覆去"。给高频卡配 textVariants（同一处境换几种写法），或者把枢纽卡拆开`
    );
  }
  if (r.hotCards.length) {
    lines.push(
      `⚠ 这几张卡玩家一局要读好几遍且没有变体：` +
        r.hotCards.map((c) => `${c.id}（${c.perRun} 次/局）`).join("、") +
        `——优先给它们加 textVariants`
    );
  }
  if (r.implicitEndingRatio > 0.2) {
    lines.push(
      `⚠ 兜底结局占 ${Math.round(r.implicitEndingRatio * 100)}%：大多数玩家拿到的是同一段泛泛的结语。` +
        `补几个条件结局，把"打得还行但没夺冠""亏光了但留住了人"这类中间状态写出来`
    );
  }
  if (r.unreachedEndings.length) lines.push(`⚠ 从未触发的结局：${r.unreachedEndings.join("、")}`);
  if (r.unfiredCards.length) lines.push(`⚠ 从未出现的卡片：${r.unfiredCards.slice(0, 20).join("、")}${r.unfiredCards.length > 20 ? ` 等 ${r.unfiredCards.length} 张` : ""}`);
  if (r.errors.length) lines.push(`⚠ 运行时错误：${r.errors.join("；")}`);
  return lines.join("\n");
}
