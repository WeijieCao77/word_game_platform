/**
 * 每一轮要把多少对话历史发给模型。
 *
 * 老板问过一句「我只是七轮对话就用了四十多万 token，这对吗」。不对，而这是其中一条：
 * 历史原来按**条数**截（最近 24 条，每条最多 8000 字符），也就是最坏情况下
 * 每轮请求都要重发将近 19 万字符。自由模式尤其糟——AI 的回复动辄几千字，
 * 二十四条堆起来就是一本书，而且**每一轮都重发一遍**。
 *
 * 连续搭建之后这条更要紧：一次请求跑二十轮，就是二十次重发。
 *
 * 改成按**总字符数**截，并且保底留几条：
 * - 太长的历史本来也帮不上忙，模型真正依赖的是设计卡（每轮原样发，是它的建造日志）
 * - 保底几条是防止「预算被一条巨长的消息吃光，结果一句上下文都不剩」
 */

export type Turn = { role: "user" | "assistant"; content: string };

/** 历史最多占多少字符。约等于 3 万 token，够装十几轮正常对话 */
export const HISTORY_BUDGET_CHARS = Number(process.env.AI_HISTORY_CHARS ?? 48_000);

/** 单条消息最多留多少字符——一条超长的消息不该把整个预算吃掉 */
export const MAX_TURN_CHARS = 8_000;

/** 无论预算多紧，至少留这么多条（最后这几条是「刚才说到哪」，丢了就接不上） */
export const MIN_TURNS = 4;

/**
 * 从后往前收，收满预算为止。
 *
 * 注意是**从后往前**：最近的话最有用。最前面那条（创作者最初的需求描述）
 * 掉出去不要紧——它早就被写进设计卡了，而设计卡每轮都原样发。
 */
export function trimHistory(
  turns: Turn[],
  budget = HISTORY_BUDGET_CHARS,
  minTurns = MIN_TURNS
): Turn[] {
  const capped = turns.map((t) => ({ role: t.role, content: t.content.slice(0, MAX_TURN_CHARS) }));
  const kept: Turn[] = [];
  let used = 0;
  for (let i = capped.length - 1; i >= 0; i--) {
    const t = capped[i];
    // 预算用完了就停——但保底那几条无论如何都要带上
    if (used + t.content.length > budget && kept.length >= minTurns) break;
    kept.unshift(t);
    used += t.content.length;
  }
  return kept;
}
