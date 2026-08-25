// 游戏配置 schema（v1）——内容卡（storylet）底座。
//
// 核心结构：状态（变量）+ 内容卡（文字+条件+权重+效果+选项）+ 调度器。
// 品类差异全部收敛在调度器里：
//   - story：叙事类。从 startCard 开始，卡片之间通过 choices.goto / goto 显式跳转
//   - life ：随机成长类（人生重开式）。时间自动推进，每回合按条件筛选+权重抽卡；
//            priority 卡在条件满足时强制插入（主线节拍），once 卡整局只出一次
// 经营/养成类的回合管线调度器与实体/结算模块在 v1.5 加入（见 docs/schema.md 路线）。
//
// 编辑器 UI、渲染引擎、AI 输出格式共用这一份定义。

/** 游戏元信息 */
export interface GameMeta {
  title: string;
  description?: string;
  /** 作者名，用于 /u/:name 作者主页 */
  author?: string;
  /** 开场文案，进入游戏时展示 */
  intro?: string;
  /** 封面样式：素材库预设 id（GameCover COVER_PRESETS）；上传的自定义封面优先于预设 */
  coverPreset?: string;
}

/** 表现层主题（反同质化：让游戏长得不一样） */
export interface GameTheme {
  /** 预设：paper 纸感浅色 / dark 夜幕深色 / terminal 终端绿字 */
  preset?: "paper" | "dark" | "terminal";
  /** 强调色，十六进制如 "#c0392b" */
  accent?: string;
}

/** 全局数值变量，如 智力/体魄/灵石/好感度 */
export interface VariableDef {
  id: string;
  name: string;
  initial: number;
  min?: number;
  max?: number;
  /** 是否展示在玩家状态栏，默认 true */
  visible?: boolean;
  /** sim：每个周期开始时重置回 initial（如联赛积分每赛季清零） */
  resetEachCycle?: boolean;
}

/** life 调度器的时间模型：如 岁 0→100 步长 1 */
export interface TimeModel {
  /** 时间单位名，如「岁」「天」「回合」 */
  label: string;
  start: number;
  step: number;
  /** 到达该值仍未触发结局 => timeout 兜底结局 */
  max: number;
}

export interface DriverStory {
  kind: "story";
  /** 开局第一张卡 */
  startCard: string;
}

export interface DriverLife {
  kind: "life";
  time: TimeModel;
  /** 每回合随机抽几张卡（priority 强制卡不占额度），默认 1 */
  drawsPerTurn?: number;
}

/** sim 的时间模型：回合（周）× 周期（赛季） */
export interface SimTimeModel {
  /** 回合名，如「周」 */
  turnLabel: string;
  /** 周期名，如「赛季」；不填则没有周期概念 */
  cycleLabel?: string;
  /** 每周期回合数 */
  turnsPerCycle?: number;
  /** 最多周期数，走完触发 timeout 兜底结局 */
  maxCycles: number;
}

/**
 * 经营模拟调度器。回合管线：
 * 玩家主动执行决策（可多个）→ 结束回合 → 结算（settlements）→
 * 随机事件（cards 权重抽取）→ 曲线（curves phase=turn）→ 结局检查 →
 * 周期滚动（curves phase=cycle、resetEachCycle 变量清零）。
 */
export interface DriverSim {
  kind: "sim";
  time: SimTimeModel;
  /** 每回合随机抽几张事件卡，默认 1 */
  drawsPerTurn?: number;
  /**
   * 每回合行动点预算：玩家一回合内能做的事有限，取舍才成立。
   * 不填 = 不限（仅靠资源/次数约束）。经营类建议 2~4。
   */
  actionPoints?: number;
}

export type Driver = DriverStory | DriverLife | DriverSim;

/**
 * 效果：对状态的一次修改。
 * - 数值：ref 为变量 id 或 "self.属性"/"target.属性"（实体上下文中），op add/set，value 是表达式
 * - 标签：op add_tag/remove_tag，ref 为 "self"/"target"，tag 为标签名（sim）
 */
export interface Effect {
  ref: string;
  op: "add" | "set" | "add_tag" | "remove_tag";
  value?: string;
  tag?: string;
}

// ---------------- sim 专用（实体/决策/结算/曲线） ----------------

/** 实体属性定义，如选手的「枪法」 */
export interface AttributeDef {
  id: string;
  name: string;
  min?: number;
  max?: number;
  /** 是否展示在阵容面板，默认 true */
  visible?: boolean;
}

/** 实体类型，如「选手」「弟子」 */
export interface EntityTypeDef {
  id: string;
  name: string;
  attributes: AttributeDef[];
}

/** 实体实例（初始名单；标签做状态流转：主力/替补/市场/伤病…） */
export interface EntityInstance {
  id: string;
  type: string;
  name: string;
  attrs: Record<string, number>;
  tags?: string[];
}

/** 派生值：由表达式计算的只读数值，如 战力 = avg("选手","枪法","主力") */
export interface DerivedDef {
  id: string;
  name: string;
  expr: string;
  visible?: boolean;
}

/** 玩家决策：每回合可主动执行的操作（训练/转会/团建…） */
export interface ActionDef {
  id: string;
  name: string;
  description?: string;
  /** 需要选择一个目标实体时填写；condition 中用 self.* 过滤候选 */
  target?: { entityType: string; condition?: string };
  /** 可用条件（全局作用域），如 "资金 >= 20" */
  condition?: string;
  /** 每回合可用次数，默认 1；0 = 本回合不限次 */
  usesPerTurn?: number;
  /** 行动点消耗（driver.actionPoints 启用时生效），默认 1；0 = 免费动作 */
  cost?: number;
  effects: Effect[];
  /** 执行后的日志文案，可用 {target.name} 等插值 */
  text?: string;
}

/** 结算中间量，按序计算，后面的可引用前面的 */
export interface SettlementCompute {
  id: string;
  expr: string;
}

/** 结算分支：按序取第一个条件为真的分支执行 */
export interface SettlementOutcome {
  id: string;
  condition: string;
  effects: Effect[];
  text?: string;
}

/**
 * 结算：每回合自动运行的规则（一场比赛/一次营业）。
 * data 是逐次数据行（赛程表），按结算已运行次数循环取行，行值以 row.<key> 引用。
 */
export interface SettlementDef {
  id: string;
  name: string;
  /** 每 N 回合运行一次，默认 1 */
  every?: number;
  condition?: string;
  data?: Array<Record<string, number | string>>;
  compute?: SettlementCompute[];
  outcomes: SettlementOutcome[];
}

/** 成长/衰退曲线：按回合或按周期对某类实体批量应用的规则 */
export interface CurveDef {
  id: string;
  name: string;
  entityType: string;
  phase: "turn" | "cycle";
  /** 实体过滤条件（self.*） */
  condition?: string;
  effects: Effect[];
  /** 生效实体的日志模板（可用 {self.name}）；不填则不记日志 */
  text?: string;
}

/** 选项：玩家在卡片上做的选择 */
export interface ChoiceDef {
  id: string;
  /** 按钮文字，支持 {表达式} 插值 */
  label: string;
  /** 满足才显示该选项 */
  condition?: string;
  effects?: Effect[];
  /** 选择后的结果文案 */
  text?: string;
  /** 跳转到某张卡（叙事链） */
  goto?: string;
  /** 直接触发某个结局 */
  ending?: string;
}

/** 关键词输入门的一组答案：命中任一 keyword 即按选项语义结算 */
export interface InputAnswerDef {
  id: string;
  /** 可命中的关键词（归一化后精确匹配：去首尾空白/小写/全角转半角） */
  keywords: string[];
  /** 额外开启条件（如需先拿到某线索才认这个词） */
  condition?: string;
  effects?: Effect[];
  /** 命中后的结果文案（支持 {表达式} 插值） */
  text?: string;
  goto?: string;
  ending?: string;
}

/** 关键词输入门（调查向玩法核心）：玩家自由输入文本，输对了才解锁——「自己想到才算数」 */
export interface CardInputDef {
  /** 输入框提示语，如「输入你想检索的人名/地名」 */
  prompt?: string;
  answers: InputAnswerDef[];
  /** 未命中时的反馈文案（支持 {表达式} 插值），默认「没有查到相关结果」 */
  fallbackText?: string;
}

/**
 * 内容卡：平台的原子内容单位。
 * - life 调度器：weight>0 的卡进入随机抽取池；priority 卡在条件满足时强制触发
 * - story 调度器：卡片只通过 goto / choices.goto 到达，weight/priority 无意义
 */
export interface CardDef {
  id: string;
  /** 编辑器里给作者看的备注名，玩家不可见 */
  title?: string;
  /** 出现条件（不填=恒可用） */
  condition?: string;
  /** 抽取权重（life），>0 才进入随机池 */
  weight?: number;
  /** 主线卡：条件满足时优先于随机抽取强制触发，数值大者先（life） */
  priority?: number;
  /** 整局最多触发一次 */
  once?: boolean;
  /**
   * 冷却：再次进入随机池前需要经过的最小时间跨度（life，按时间单位算）。
   * 默认 2（同一张卡不会连着两个回合出现）；0 表示允许连续出现。
   */
  cooldown?: number;
  /** 正文，支持 {表达式} 插值 */
  text: string;
  /**
   * 配图：素材名（作者在工作台「封面与素材」上传）或 https 外链。
   * 展示在卡片文字上方——角色立绘、场景、宗门图等。图片由作者提供，AI 只建议放图位。
   */
  image?: string;
  /**
   * 反重复文案变体：填了则每次触发从 [text, ...textVariants] 中按种子随机挑一套展示。
   * 高频卡（日常/事件）建议至少配 2 条变体，同一张卡多次出现不再一字不差。
   */
  textVariants?: string[];
  effects?: Effect[];
  choices?: ChoiceDef[];
  /** 关键词输入门：玩家自由输入文本解锁（可与 choices 并存） */
  input?: CardInputDef;
  /** 无选项时自动接到下一张卡（叙事链） */
  goto?: string;
  /** 触发后直接进入某个结局 */
  ending?: string;
  /** sim：实体事件——从满足条件的实体中随机选一个绑定为 self */
  scope?: { entityType: string; condition?: string };
}

/** 结局。触发方式二选一：condition 满足自动触发，或被卡片/选项的 ending 显式引用 */
export interface EndingDef {
  id: string;
  title: string;
  kind: "victory" | "defeat" | "neutral";
  /** 自动触发条件；仅被显式引用的结局可不填 */
  condition?: string;
  text?: string;
  /** 多个条件结局同时满足时，priority 大者先，默认 0 */
  priority?: number;
}

export interface GameText {
  /** 每回合的标题模板（life 默认 "{time} 岁"；sim 默认 "第 {cycle} 赛季 第 {turn} 周"式） */
  turnHeader?: string;
  /** sim：周期结束时的文案模板 */
  cycleEnd?: string;
  /** 到达时间上限仍无结局时的兜底结局 */
  timeoutEnding?: { title: string; text?: string };
}

export interface GameConfig {
  schemaVersion: 1;
  meta: GameMeta;
  theme?: GameTheme;
  driver: Driver;
  vars: VariableDef[];
  cards: CardDef[];
  endings: EndingDef[];
  text?: GameText;
  // ---- sim 模块（driver.kind === "sim" 时使用）----
  entityTypes?: EntityTypeDef[];
  entities?: EntityInstance[];
  derived?: DerivedDef[];
  actions?: ActionDef[];
  settlements?: SettlementDef[];
  curves?: CurveDef[];
}

// ---------------- 运行时状态 ----------------

export interface LogEntry {
  kind: "intro" | "header" | "card" | "choice" | "ending" | "action" | "settlement";
  text: string;
  turn: number;
  /** 卡片配图（素材名或 https 外链），播放器渲染在文字上方 */
  image?: string;
}

export interface EntityState {
  attrs: Record<string, number>;
  tags: string[];
}

export interface GameState {
  /** life/story：已触发的卡片数；sim：当前周期内的回合数（1 起） */
  turn: number;
  /** life 调度器的当前时间值 */
  time?: number;
  /** sim：当前周期（1 起） */
  cycle?: number;
  /** sim：本回合剩余行动点（driver.actionPoints 启用时维护） */
  apLeft?: number;
  /** sim：实体状态 */
  entities?: Record<string, EntityState>;
  /** sim：本回合各决策已用次数 */
  actionsUsed?: Record<string, number>;
  /** sim：各结算已运行次数（data 行循环用） */
  counters?: Record<string, number>;
  /** sim：实体事件挂起时绑定的 self 实体 */
  pendingEntity?: string;
  vars: Record<string, number>;
  /** 各卡触发次数（fired() 函数与 once 判定用） */
  fired: Record<string, number>;
  /** 各卡上次触发时的时间值（life 冷却判定用；旧存档可能缺失） */
  lastFired?: Record<string, number>;
  /** 等待玩家选择的卡 id（该卡有可用选项时） */
  pendingCard?: string;
  log: LogEntry[];
  ended?: { endingId: string; title: string; kind: "victory" | "defeat" | "neutral"; text?: string };
  seed: number;
  rngState: number;
}
