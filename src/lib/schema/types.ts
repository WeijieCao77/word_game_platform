// 游戏配置 schema（v1）——从 val manager（类足球经理）倒推抽象出的
// management sim 通用骨架。编辑器 UI、渲染引擎、AI 输出格式共用这一份定义。
//
// 设计目标：同一套结构能表达「足球经理」「修仙宗门经理」「乐队经理」
// 「餐厅经营」——换名词（entityTypes/variables）+ 换公式（表达式字符串）即可换皮。

/** 游戏元信息 */
export interface GameMeta {
  title: string;
  description?: string;
  /** 作者名，用于 /u/:name 作者主页 */
  author?: string;
  /** 开场文案，进入游戏时展示 */
  intro?: string;
}

/**
 * 时间模型。回合制：每回合玩家做决策 → 结算 → 随机事件 → 成长曲线。
 * 例：足球经理里 turnLabel=周、cycleLabel=赛季、turnsPerCycle=14。
 */
export interface TimeModel {
  /** 回合的名称，如「周」「月」「天」 */
  turnLabel: string;
  /** 大周期名称，如「赛季」「年」。不填则没有周期概念 */
  cycleLabel?: string;
  /** 每个周期包含多少回合 */
  turnsPerCycle?: number;
  /** 最多进行多少个周期，超出触发 timeout 结局（防无限游戏） */
  maxCycles?: number;
}

/** 全局数值变量，如资金、声望、联赛积分 */
export interface VariableDef {
  id: string;
  name: string;
  initial: number;
  min?: number;
  max?: number;
  /** 每个周期开始时重置回 initial（如联赛积分每赛季清零） */
  resetEachCycle?: boolean;
  /** 是否展示在玩家面板，默认 true */
  visible?: boolean;
}

/** 实体属性定义，如球员的「射门」「体能」 */
export interface AttributeDef {
  id: string;
  name: string;
  min?: number;
  max?: number;
  visible?: boolean;
}

/** 实体类型，如「球员」「弟子」「菜品」 */
export interface EntityTypeDef {
  id: string;
  name: string;
  attributes: AttributeDef[];
}

/** 实体实例（初始名单） */
export interface EntityInstance {
  id: string;
  type: string;
  name: string;
  attrs: Record<string, number>;
  /** 标签用于状态标记（受伤/在市场/主力…），可被效果增删、被条件查询 */
  tags?: string[];
}

/** 派生值：由表达式计算的只读数值，如 team_power = avg("player","attack") */
export interface DerivedDef {
  id: string;
  name: string;
  expr: string;
  visible?: boolean;
}

/**
 * 效果：对状态的一次修改。
 * - 数值：ref 指向变量 id 或 "target.attr" / "self.attr"，op 为 add/set，value 是表达式
 * - 标签：op 为 add_tag/remove_tag，ref 为 "target"/"self"，tag 为标签名
 */
export interface Effect {
  ref: string;
  op: "add" | "set" | "add_tag" | "remove_tag";
  value?: string;
  tag?: string;
}

/** 玩家决策（每回合可执行的操作），如训练、转会、闭关 */
export interface ActionDef {
  id: string;
  name: string;
  description?: string;
  /** 需要选择一个目标实体时填写；condition 中可用 self.* 过滤候选 */
  target?: { entityType: string; condition?: string };
  /** 可用条件（全局作用域），如 "money >= 100" */
  condition?: string;
  /** 每回合可用次数，默认 1；0 表示本回合不限次数 */
  usesPerTurn?: number;
  effects: Effect[];
  /** 执行后写入日志的文案模板，支持 {表达式} 插值 */
  text?: string;
}

/** 结算的中间量，按顺序计算，后面的可引用前面的 */
export interface SettlementCompute {
  id: string;
  expr: string;
}

/** 结算分支：按顺序找第一个 condition 为真的分支执行 */
export interface SettlementOutcome {
  id: string;
  condition: string;
  effects: Effect[];
  text?: string;
}

/**
 * 结算：每回合自动运行的规则，如一场比赛、一次营业。
 * data 是逐回合数据行（如赛程表），按结算已运行次数循环取行，
 * 行内数值在表达式中以 row.<key> 引用。
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

/** 随机事件 */
export interface EventDef {
  id: string;
  /** 抽取权重，>0 */
  weight: number;
  condition?: string;
  /** 实体事件：从满足条件的实体中随机选一个绑定为 self */
  scope?: { entityType: string; condition?: string };
  effects?: Effect[];
  text: string;
}

/** 事件池：每回合从池中按权重抽 drawsPerTurn 条 */
export interface EventPoolDef {
  id: string;
  name: string;
  drawsPerTurn: number;
  condition?: string;
  events: EventDef[];
}

/**
 * 成长/衰退曲线：按回合或按周期对某类实体批量应用的规则。
 * 例：每赛季 age+1；age>=30 时能力随机下降。
 */
export interface CurveDef {
  id: string;
  name: string;
  entityType: string;
  phase: "turn" | "cycle";
  condition?: string;
  effects: Effect[];
  text?: string;
}

/** 结局：每回合结束后按 priority 从高到低检查，第一个满足的触发 */
export interface EndingDef {
  id: string;
  title: string;
  kind: "victory" | "defeat" | "neutral";
  condition: string;
  text?: string;
  priority?: number;
}

/** 全局文案 */
export interface GameText {
  /** 每回合开始的标题模板，如 "第 {cycle} 赛季 第 {turn} 周" */
  turnHeader?: string;
  /** 周期结束时的文案模板 */
  cycleEnd?: string;
  /** 到达 maxCycles 仍未触发任何结局时的兜底结局 */
  timeoutEnding?: { title: string; text?: string };
}

export interface GameConfig {
  schemaVersion: 1;
  meta: GameMeta;
  time: TimeModel;
  variables: VariableDef[];
  entityTypes: EntityTypeDef[];
  entities: EntityInstance[];
  derived?: DerivedDef[];
  actions: ActionDef[];
  settlements?: SettlementDef[];
  eventPools?: EventPoolDef[];
  curves?: CurveDef[];
  endings: EndingDef[];
  text?: GameText;
}

// ---------------- 运行时状态 ----------------

export interface LogEntry {
  /** header=回合标题, action=玩家操作, settlement=结算, event=随机事件, curve=曲线, ending=结局, system=系统 */
  kind: "header" | "action" | "settlement" | "event" | "curve" | "ending" | "system";
  text: string;
  turn: number;
  cycle: number;
}

export interface EntityState {
  attrs: Record<string, number>;
  tags: string[];
}

export interface GameState {
  /** 当前周期内的回合数，从 1 开始 */
  turn: number;
  /** 当前周期，从 1 开始 */
  cycle: number;
  /** 全局累计回合数，从 1 开始 */
  totalTurn: number;
  vars: Record<string, number>;
  entities: Record<string, EntityState>;
  /** 本回合各决策已用次数 */
  actionsUsed: Record<string, number>;
  /** 各结算已运行次数（用于 data 行循环） */
  counters: Record<string, number>;
  log: LogEntry[];
  ended?: { endingId: string; title: string; kind: "victory" | "defeat" | "neutral"; text?: string };
  rngState: number;
}
