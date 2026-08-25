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
  /**
   * 题材，用于游戏库分类（推理 / 恋爱 / 经营 / 修仙 / 怪谈 / 校园 …）。
   * 和 driver.kind 是两回事：kind 是「怎么玩」（叙事/成长/经营），genre 是「讲什么」。
   * 不填就按 kind 归类。
   */
  genre?: string;
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
  /** 不填 = 开放式生涯：赛季无上限，游戏不会因为「打完」而结束 */
  maxCycles?: number;
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
  /**
   * add/set 改数值，add_tag/remove_tag 改标签，
   * pend 发起一件「要等回音的事」（ref 写待办 id，见 PendingDef），
   * relate/relate_group 改两个角色之间的关系（ref 写关系 id，见 RelationDef）。
   */
  op: "add" | "set" | "add_tag" | "remove_tag" | "pend" | "relate" | "relate_group";
  value?: string;
  tag?: string;
}

// ---------------- sim 专用（实体/决策/结算/曲线） ----------------

/**
 * 淘汰赛对阵表：常规赛打完，前 N 名进季后赛，一轮一轮淘汰到只剩一个。
 *
 * 联赛（LeagueDef）只解决「谁排第几」，解决不了「谁淘汰了谁」。而一切赛事题材——
 * 体育、武道会、选秀、辩论赛、宗门大比——最紧张的部分恰恰在淘汰赛。
 *
 * 种子从挂接的联赛积分榜里取；玩家自己的比赛用 outcomes 判定（row 里是对手），
 * NPC 之间的对局按强度加随机数直接算出来。整张表在触发的那个回合里一次打完，
 * 每一轮都会写进日志。
 */
export interface BracketDef {
  id: string;
  name: string;
  /** 种子从哪个联赛的积分榜取 */
  league: string;
  /** 参赛队数：2 / 4 / 8 / 16 */
  size: number;
  /** 什么时候开打（表达式，如 "turn == 12"） */
  condition: string;
  /** 中间量，可用 row.名称 / row.强度 / round（第几轮，1 起） */
  compute?: SettlementCompute[];
  /** 玩家每一轮的结果分支；按序取第一个满足的 */
  outcomes: SettlementOutcome[];
  /** 玩家夺冠时额外生效的效果 */
  championEffects?: Effect[];
  /** 玩家夺冠的文案 */
  championText?: string;
  /** 玩家被淘汰的文案，可用 {round} */
  eliminatedText?: string;
}

/**
 * 关系网：两个角色**之间**的状态。
 *
 * 平台原本只有两种状态：全局变量、以及每个角色自己的属性。谁和谁的关系无处安放——
 * 恋爱、宗门、宫斗、群像、队内羁绊，全都卡在这一条上。
 *
 * 存储是惰性的：只有被读过或改过的那一对才进存档，没碰过的按 initial 现算，
 * 所以 500 个角色也不会铺开 12 万条记录。
 *
 * 表达式里这样用：
 *   bond("羁绊")                 self 与 target 之间的值（两个绑定都要有）
 *   harmony("羁绊", "主力")      带该标签的角色两两之间的平均值
 *   worst_bond("羁绊", "主力")   其中最差的一对
 * 效果里这样改：
 *   { ref: "羁绊", op: "relate", value: "3" }                 self↔target
 *   { ref: "羁绊", op: "relate_group", tag: "主力", value: "1" }  组内两两都变
 */
export interface RelationDef {
  id: string;
  name: string;
  /** 参与这张关系网的实体类型 */
  entityType: string;
  /** 没碰过的一对默认是多少（表达式，可用 self.* 与 other.*）；不填按 0 */
  initial?: string;
  min?: number;
  max?: number;
}

/**
 * 待办：发出去要等回音的事——转会报价、赞助洽谈、招聘邀约、跳槽求职。
 *
 * 这类玩法的共同形状是「现在做一个动作，过几回合才知道结果」，而不是当场结算。
 * 少了它，经理类游戏里所有的谈判都只能压扁成一次性的「点一下就成」。
 *
 * 用法：某个决策（或选项）挂一条 { op: "pend", ref: "转会报价" } 的效果，
 * 引擎按 waitTurns 算出到期回合，到期时按 outcomes 顺序取第一个满足的分支。
 */
export interface PendingDef {
  id: string;
  name: string;
  /** 等几个回合出结果（表达式，可用 randint(3, 10)）；至少 1 */
  waitTurns: string;
  /**
   * 发起时绑定的实体类型 id。填了才能在结果分支里用 target.*
   * （比如「给某个选手的报价」到期时，还要知道是给谁的）。
   */
  targetType?: string;
  /** 挂起期间在待办面板上显示的一句话 */
  waitingText?: string;
  /** 结果分支，按序求值，第一个满足条件的生效 */
  outcomes: SettlementOutcome[];
}

/** 一条挂起中的待办（存档里的运行时状态） */
export interface PendingItem {
  /** 唯一实例 id */
  key: string;
  /** 对应的 PendingDef.id */
  def: string;
  /** 到期的全局回合数 */
  dueTurn: number;
  /** 发起时绑定的目标实体（结果分支里可用 target.*） */
  target?: string;
}

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
  /**
   * 名单分组（可选）：按标签把表格拆成几段，各带小标题与人数。
   * 不配就是一张大表（老游戏不受影响）。
   * 用途是把身份完全不同的实体分开——自家阵容和转会市场的选手混在一张表里，
   * 玩家分不清哪些是自己的人。按 tag 顺序匹配，第一个命中的分组收下它；
   * 一个都没命中的落进 restLabel 那一组。
   */
  groups?: { tag: string; label: string }[];
  /** 没命中任何分组的实体归到这一组；不填就叫「其他」 */
  restLabel?: string;
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
  /** 活联赛：此分支代表玩家在挂接联赛中的胜/负（触发联赛记账与 NPC 互赛一轮） */
  leagueResult?: "win" | "loss";
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

/** 活联赛参赛队 */
export interface LeagueTeamDef {
  name: string;
  /** 强度（与玩家结算里的对手强度同一量纲），NPC 互赛用 logistic 胜率 */
  strength: number;
}

/**
 * 活联赛：没有玩家参与的比赛也在发生。挂接一个带 data 赛程的结算——
 * 玩家场次由结算 outcome 的 leagueResult 记账（对手镜像记账），
 * 同轮其余队伍两两互赛（确定性配对+强度胜率），积分榜存进 state，
 * 表达式用 rank("联赛id") 取玩家当前排名。
 */
export interface LeagueDef {
  id: string;
  name: string;
  /** 参赛队（含玩家队） */
  teams: LeagueTeamDef[];
  /** 玩家队伍名（必须在 teams 中） */
  playerTeam: string;
  /** 挂接的结算 id：该结算每运行一次=联赛推进一轮 */
  settlement: string;
  /** 结算 data 行里表示对手名的字段，默认「名称」 */
  opponentKey?: string;
  /** 积分榜上标注前 N 名晋级线（纯展示） */
  playoffs?: number;
  /** 每个新周期重置战绩（赛季制联赛），默认 true */
  resetEachCycle?: boolean;
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

/** 全局检索台词条：一份可被玩家随时查到的「档案」 */
export interface SearchEntryDef {
  id: string;
  /** 可命中的关键词（归一化匹配，同输入门） */
  keywords: string[];
  /** 解锁条件：不满足时查询视为无果（如需先拿到某线索才能查出深层档案） */
  condition?: string;
  /** 档案内容，支持 {表达式} 插值 */
  text: string;
  /** 配图（素材名或 https 外链） */
  image?: string;
  /** 首次查到时的效果（只生效一次；重复查询只重看档案） */
  effects?: Effect[];
}

/** 档案夹条目：可随时翻看的线索/人物/物证卡（满足条件才出现） */
export interface NotebookItemDef {
  id: string;
  name: string;
  /** 分组，如 人物/物证/线索；不填归入「档案」 */
  category?: string;
  /** 显示条件：不填=开局即可翻看（人物档案）；填了=拿到线索才出现（线索索引） */
  condition?: string;
  /** 内容，支持 {表达式} 插值——可随进度显示更多信息 */
  text: string;
  image?: string;
}

/**
 * 档案夹（推理/叙事类的随身索引）：玩家随时翻看已解锁的线索、人物档案、物证。
 * 纯展示模块（不改状态）：查阅性内容放这里，不要做成繁琐的选项。
 */
export interface NotebookDef {
  /** 按钮名，默认「档案」 */
  label?: string;
  /** 常驻在页面哪一侧，默认 right；窄屏自动降级为折叠面板 */
  side?: "left" | "right";
  items: NotebookItemDef[];
}

/**
 * 全局检索台（鲁特里一家死了 / MISSING 式）：常驻检索框，玩家随时输入关键词查档案。
 * 与卡片级 input 的分工：检索台是随时可查的百科/数据库，解锁线索变量全局生效；
 * 卡片 input 用于剧情关键时刻的一次性输入。
 */
export interface SearchDef {
  /** 检索框按钮/页签名，默认「检索」 */
  label?: string;
  /** 输入框提示语 */
  prompt?: string;
  /** 查无结果的反馈，默认「没有查到相关结果。」 */
  fallbackText?: string;
  /** 检索框常驻在页面哪一侧，默认 right——推理游戏里它要一直看得见，不能随正文滚走 */
  side?: "left" | "right";
  entries: SearchEntryDef[];
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
  /**
   * sim 界面页签的自定义名称（贴合题材：宗门游戏的 schedule 可以叫「大比日程」）。
   * 页签本身按配置推导显隐：没有 actions 就没有行动页，结算没有 data 行就没有日程页。
   */
  tabLabels?: { overview?: string; actions?: string; roster?: string; schedule?: string; log?: string };
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
  /** 全局检索台（可选）：调查/解谜类的常驻检索框 */
  search?: SearchDef;
  /** 档案夹（可选）：随时翻看的线索索引与人物/物证档案 */
  notebook?: NotebookDef;
  /** 活联赛（sim 可选）：NPC 之间也比赛，产生会变化的积分榜 */
  leagues?: LeagueDef[];
  // ---- sim 模块（driver.kind === "sim" 时使用）----
  entityTypes?: EntityTypeDef[];
  entities?: EntityInstance[];
  derived?: DerivedDef[];
  actions?: ActionDef[];
  settlements?: SettlementDef[];
  curves?: CurveDef[];
    /** 待办：发出去要等回音的事（报价/申请/谈判） */
  pendings?: PendingDef[];
  /** 关系网：两个角色之间的状态（羁绊/好感/恩怨） */
  relations?: RelationDef[];
  /** 淘汰赛对阵表：常规赛之后的季后赛 */
  brackets?: BracketDef[];
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
  /** 打完的淘汰赛：bracketId → { 冠军, 玩家走到第几轮, 每轮对阵 } */
  brackets?: Record<string, { champion: string; playerRounds: number; rounds: { round: number; pairs: [string, string][]; winners: string[] }[] }>;
  /** 关系网：relationId → "A|B"（两个 id 排序后拼接）→ 关系值。只存碰过的那些对 */
  relations?: Record<string, Record<string, number>>;
  /** 挂起中的待办：报价/申请/谈判，到期自动出结果 */
  pendings?: PendingItem[];
  /** 全局检索台：各词条被查到的次数（效果只在首次生效） */
  searched?: Record<string, number>;
  /** 活联赛积分榜：leagueId → 队名 → 战绩 */
  leagues?: Record<string, Record<string, { w: number; l: number; diff: number }>>;
  /** 最近一次各结算的归因快照：中间量与结果（「为什么是这个结果”面板的数据源） */
  lastSettlements?: Record<
    string,
    { name: string; row?: Record<string, number | string>; locals: Record<string, number>; text?: string }
  >;
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
