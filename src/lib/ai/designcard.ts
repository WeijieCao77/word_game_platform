// 《游戏设计卡》模板与状态机。
// 设计卡是创作者与 AI 策划的共同备忘录，也是创作流程的状态载体：
// update_config 工具只在状态为「已确认」或「调优中」时可用（见 agent.ts 的门禁）。

export const CARD_STATUS = {
  ALIGNING: "需求对齐中",
  PENDING: "方案待确认",
  APPROVED: "已确认",
  TUNING: "调优中",
} as const;

export const DESIGN_CARD_TEMPLATE = `状态：需求对齐中

# 游戏设计卡

> 由创作者与 AI 策划共同维护。「状态」一行是创作流程的开关：
> 需求对齐中 → 方案待确认 → 已确认 →（实现后）调优中。
> AI 只有在状态为「已确认」之后才被允许生成/修改游戏配置。

## 一句话概念
（这个游戏是什么？给谁玩的？）

## 世界观与背景故事
（时代/世界设定、主角是谁、故事从哪里开始）

## 核心玩法循环
（调度器选型：story 分支叙事 / life 随机成长 / sim 经营模拟；
一个回合里发生什么？时间单位是什么——注意贴合题材：宗门经营用「年」，人生重开才用「岁」）

## 玩家的决策
（玩家每回合能主动做什么？选择的代价与收益是什么？纯看文字没得选 = 无聊）

## 趣味性来源
（爽点是什么：数值增长？收集？赌运气？多结局探索？张力从哪来：资源紧张？风险决策？）

## 数值体系
（核心变量 3~6 个；它们如何互相牵制；难度曲线大致什么样）

## 内容规划
（事件/卡池的大类；主线节拍；大约多少张卡）

## 结局设计
（胜利/失败/中性结局各是什么；触发条件；隐藏结局？）

## 单局时长
（目标几分钟一局？多少回合？）

## 待定问题
（还没聊清楚的点）
`;

/** 从设计卡首行解析当前状态；解析不到按「需求对齐中」处理 */
export function parseCardStatus(designCard: string): string {
  const m = designCard.match(/^\s*状态[:：]\s*(\S+)/);
  return m ? m[1] : CARD_STATUS.ALIGNING;
}

/** 配置生成是否已解锁 */
export function configUnlocked(designCard: string): boolean {
  const s = parseCardStatus(designCard);
  return s === CARD_STATUS.APPROVED || s === CARD_STATUS.TUNING;
}
