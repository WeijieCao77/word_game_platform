import { GameConfig } from "./types";

// 平台模块注册表：每个游戏功能都是一个可选模块，作者自己决定加不加。
// 工作台用它展示「本作启用了哪些模块」，AI 工作室用同一套名字与作者对话。

export interface PlatformModule {
  id: string;
  name: string;
  /** 一句话说明（作者视角） */
  desc: string;
  /** 适用的调度器；空 = 全部 */
  drivers?: ("story" | "life" | "sim")[];
  enabled: (config: GameConfig) => boolean;
}

export const PLATFORM_MODULES: PlatformModule[] = [
  {
    id: "choices",
    name: "选项抉择",
    desc: "卡片上的分支选择（可带条件、效果、跳转、结局）",
    enabled: (c) => c.cards.some((card) => (card.choices?.length ?? 0) > 0),
  },
  {
    id: "event-pool",
    name: "随机事件池",
    desc: "按条件与权重抽取的事件卡（冷却防重复）",
    drivers: ["life", "sim"],
    enabled: (c) => c.cards.some((card) => (card.weight ?? 0) > 0),
  },
  {
    id: "text-variants",
    name: "反重复文案",
    desc: "同一张卡多套文案轮换，连续触发必不同",
    enabled: (c) => c.cards.some((card) => (card.textVariants?.length ?? 0) > 0),
  },
  {
    id: "images",
    name: "配图素材",
    desc: "卡片/档案展示作者上传的立绘、场景图",
    enabled: (c) => c.cards.some((card) => !!card.image) || (c.search?.entries.some((e) => !!e.image) ?? false),
  },
  {
    id: "input-gate",
    name: "关键词输入门",
    desc: "剧情关键时刻的自由输入（指认、密码），输对才解锁",
    enabled: (c) => c.cards.some((card) => (card.input?.answers.length ?? 0) > 0),
  },
  {
    id: "search",
    name: "全局检索台",
    desc: "常驻检索框，玩家随时查人名/地名/案号（调查类玩法核心）",
    enabled: (c) => (c.search?.entries.length ?? 0) > 0,
  },
  {
    id: "entities",
    name: "实体名单",
    desc: "有名有姓的角色/队员名单（属性+标签状态流转）",
    drivers: ["sim"],
    enabled: (c) => (c.entities?.length ?? 0) > 0,
  },
  {
    id: "actions",
    name: "玩家决策",
    desc: "每回合的主动操作（训练/转会/经营……）",
    drivers: ["sim"],
    enabled: (c) => (c.actions?.length ?? 0) > 0,
  },
  {
    id: "action-points",
    name: "行动点",
    desc: "每回合行动点预算——做什么必须取舍",
    drivers: ["sim"],
    enabled: (c) => c.driver.kind === "sim" && c.driver.actionPoints !== undefined,
  },
  {
    id: "settlements",
    name: "结算",
    desc: "每回合自动运行的对抗/营业规则（赛程表+公式+分支结果）",
    drivers: ["sim"],
    enabled: (c) => (c.settlements?.length ?? 0) > 0,
  },
  {
    id: "curves",
    name: "成长曲线",
    desc: "角色随时间成长/衰退的批量规则",
    drivers: ["sim"],
    enabled: (c) => (c.curves?.length ?? 0) > 0,
  },
  {
    id: "leagues",
    name: "活联赛",
    desc: "NPC 之间也在比赛：会变化的积分榜与排名（rank）",
    drivers: ["sim"],
    enabled: (c) => (c.leagues?.length ?? 0) > 0,
  },
  {
    id: "tab-labels",
    name: "界面定制",
    desc: "按题材命名游戏页签（宗门「大比日程」而非「赛程」）",
    drivers: ["sim"],
    enabled: (c) => !!c.text?.tabLabels && Object.keys(c.text.tabLabels).length > 0,
  },
];

/** 本作模块状态（工作台「模块」面板的数据源） */
export function moduleStatus(config: GameConfig): { module: PlatformModule; enabled: boolean; applicable: boolean }[] {
  return PLATFORM_MODULES.map((m) => ({
    module: m,
    applicable: !m.drivers || m.drivers.includes(config.driver.kind),
    enabled: m.enabled(config),
  }));
}
