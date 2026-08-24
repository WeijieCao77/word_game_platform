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

export type Driver = DriverStory | DriverLife;

/** 效果：对变量的一次修改，value 是受限表达式 */
export interface Effect {
  ref: string;
  op: "add" | "set";
  value: string;
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
  effects?: Effect[];
  choices?: ChoiceDef[];
  /** 无选项时自动接到下一张卡（叙事链） */
  goto?: string;
  /** 触发后直接进入某个结局 */
  ending?: string;
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
  /** life 调度器每回合的标题模板，如 "{time} 岁"；不填有默认 */
  turnHeader?: string;
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
}

// ---------------- 运行时状态 ----------------

export interface LogEntry {
  kind: "intro" | "header" | "card" | "choice" | "ending";
  text: string;
  turn: number;
}

export interface GameState {
  /** 已触发的卡片数（步数） */
  turn: number;
  /** life 调度器的当前时间值 */
  time?: number;
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
