// 纯函数引擎：同一份配置 + 同一个种子 + 同样的操作序列 => 完全相同的过程。
// 播放器、编辑器预览、模拟器、AI 的 simulate 工具共用这一份实现。
//
// 三个调度器：
//   story：显式跳转的分支叙事
//   life ：时间推进 + 权重抽卡的随机成长
//   sim  ：经营模拟回合管线——玩家主动决策(performAction) → 结束回合(endTurn)：
//          结算 → 随机事件 → 曲线 → 结局检查 → 周期滚动
//
// 这里是唯一对外门面（外部只 import "@/lib/engine"）。要改具体行为，去对应模块：
//   internal.ts 求值上下文 / 文案插值 / 效果落地   endings.ts  结局判定
//   cards.ts    卡片链与随机抽卡                   choices.ts  选项与 choose
//   input.ts    关键词输入门 / 检索台 / 档案夹      actions.ts  sim 决策与行动点
//   state.ts    开局建档 / life 推进 / 派生值       settle.ts   sim 回合管线与结算
//   leagues.ts  活联赛记账与积分榜                 rng.ts      确定性随机流

export { createRng } from "./rng";
export type { Rng } from "./rng";
export { initState, step, derivedValues } from "./state";
export { choose, pendingChoices } from "./choices";
export { pendingInput, submitInput, searchKeyword, notebookItems } from "./input";
export { leagueStandings } from "./leagues";
export { performAction, availableActions, eligibleTargets } from "./actions";
export { endTurn, upcomingRows } from "./settle";
export type { ActionView } from "./actions";

export { clockOf } from "./internal";
export { pairKey, readRelation, changeRelation, taggedMembers, groupPairs } from "./relations";
