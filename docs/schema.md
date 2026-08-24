# 内容卡底座设计文档（schema v1）

本文是平台的地基文档：schema、表达式语言、引擎语义、三级校验，以及把交接文档
（`docs/HANDOFF.md`）落到这个形态的讨论结论。编辑器 UI、渲染引擎、AI 输出格式
都照着本文长。

## 0. 讨论结论（对交接文档的三处升级）

**① 底座从"经营 sim schema"升级为"内容卡（storylet）底座"。**
交接文档建议从 val manager 倒推一套 management sim schema。讨论后确认平台定位是
**文字游戏平台**而非经营类平台——故事类、叙事类、随机成长、经营类的想法都要能做。
拆到原子级别，所有文字游戏共享同一结构：

- **状态**：一组变量（可扩展为实体）
- **内容卡**：一段文字 + 出现条件 + 效果 + 选项（各品类里叫"节点/事件/剧情"，结构相同）
- **调度器**：决定下一张卡是哪张——**品类差异全部在这里**

| 调度器 | 品类 | 先例 |
| --- | --- | --- |
| story：选项显式跳转（图结构） | 分支叙事 | 橙光、Twine |
| life：时间推进 + 条件筛选 + 权重抽卡 | 随机成长 | 人生重开模拟器 |
| sim（v1.5）：回合管线 决策→结算→抽卡→曲线 | 经营/养成 | Football Manager、中国式家长 |

调度器有限（三四种，平台代码）；内容卡无限（用户数据）。"什么想法都能试"与
"用户不写代码"同时成立，靠的就是这条分界线。Fallen London 一系（storylet /
quality-based narrative）验证过这套结构能同时承载叙事与模拟。

**② val manager 不迁移。** 实际读代码后确认它是 Valorant 电竞经理，引擎约 7000 行
（BP/逐回合比赛模拟/三线关系/多维合同/化学反应/教练组/商务/经理生涯）。任何声明式
schema 要表达它就得进化成编程语言——正是要避开的陷阱。它的角色改为：旗舰内容 +
流量锚点 + 机制清单来源（它验证过的循环骨架以简化形态进 schema）+ 品质天花板参照。
平台因此分两层：手写旗舰层 + schema 驱动的 UGC 层。

**③ AI 从"生成按钮"升级为"驻场策划"。** 工作台主界面是与 AI 的多轮对话。AI 带四个
工具（设计卡/改配置/校验/模拟），会反问、会挑战；因为引擎是纯函数、游戏是数据，AI
能真的"玩"用户的游戏（批量模拟）后拿数据讨论。这是对生成代码类平台的结构性差异点。

**自由度与反同质化**：橙光的同质化来自素材经济与激励结构，不是引擎表达力（反例：
Minecraft 只有方块）。本底座真正自由的面：文字本身（文字游戏最大的表达面）、状态
空间设计、卡池条件网络、公式手感、调度器混搭。真正受限的面：交互动词（读/选/看数值），
要对创作者明说。反同质化杠杆：分层逃生舱（配置层→组合层→未来的沙箱脚本层→平台新
模块）、表现层主题化、AI 把"深卡池"的成本从一个月降到一个下午。

## 1. GameConfig 结构

一个游戏 = 一个 JSON 对象 = 数据库一行。TypeScript 定义见 `src/lib/schema/types.ts`，
zod 结构校验见 `src/lib/schema/zod.ts`（`gameConfigJsonSchema()` 可导出 JSON Schema）。

```
GameConfig
├─ schemaVersion: 1
├─ meta        { title, description?, author?, intro? }
├─ theme?      { preset?: paper|dark|terminal, accent?: #rrggbb }
├─ driver      story: { kind, startCard }
│              life : { kind, time: {label,start,step,max}, drawsPerTurn? }
├─ vars[]      { id, name, initial, min?, max?, visible? }
├─ cards[]     { id, title?, condition?, weight?, priority?, once?,
│                text, effects?, choices?, goto?, ending? }
│    choices[] { id, label, condition?, effects?, text?, goto?, ending? }
│    effects[] { ref: 变量id, op: add|set, value: 表达式 }
├─ endings[]   { id, title, kind: victory|defeat|neutral, condition?, text?, priority? }
└─ text?       { turnHeader?, timeoutEnding?: {title, text?} }
```

要点：

- **id 可用中文**（`[A-Za-z_一-鿿][A-Za-z0-9_一-鿿]*`，不能以数字或 `__` 开头），
  创作者直接写「灵根」「测灵根」，配置可读性高
- 卡片有 `choices` 时，卡级 `goto`/`ending` 禁用（放进选项里）；`goto` 与 `ending` 互斥
- `weight > 0` 才进入 life 的随机池；`priority` 卡在条件满足的回合强制触发（主线节拍），
  同回合只触发数值最大的一张；`once` 整局一次
- 结局触发两条路：`condition` 满足自动触发（每次卡结算后检查，`priority` 大者先），
  或被卡/选项的 `ending` 显式引用；life 到 `time.max` 走 `timeoutEnding` 兜底
- 主题（`theme`）是反同质化的第一步：三个预设 + 强调色，后续扩展排版/节奏

## 2. 受限表达式语言

实现：`src/lib/expr`（手写词法/递归下降解析 + 树求值），**绝不 eval**。

- 语法：数字、字符串字面量（仅比较与插值文案用）、点分标识符、`+ - * / %`、
  `== != < <= > >=`、`&& || !`、三元 `?:`、括号、函数调用
- 函数白名单：`min max abs floor ceil round sqrt clamp` +
  `rand() randint(a,b) chance(p) fired("卡id")`
- 特殊变量：`time`（life 当前时间）、`turn`（已触发卡数）
- 安全护栏：长度 ≤1000 字符、token ≤300、嵌套 ≤32 层、求值 ≤5000 步、
  除零/溢出即错、标识符经 `hasOwnProperty` 查表（防 `__proto__` 原型链穿透，
  schema 层同时禁止 `__` 开头 id）、作用域只认白名单——不存在触达 JS 对象的路径
- 文案插值：`text` 里 `{表达式}` 在**效果执行之后**渲染，数字自动格式化

随机数：mulberry32，完整内部状态就是一个 32 位整数，存在 `GameState.rngState` 里。
同配置 + 同种子 + 同操作序列 ⇒ 完全相同的过程（存档恢复、回放、模拟、测试全靠它）。

## 3. 引擎语义（`src/lib/engine`）

纯函数三件套，输入状态返回新状态（structuredClone，不改入参）：

- `initState(config, seed)`：变量归位（带 min/max 收拢）、记 intro；story 立即触发起始卡
- `step(config, state)`（仅 life）：时间 +step → 回合标题 → 触发一张卡：
  1. 条件满足的 `priority` 卡（大者先，一回合最多一张）
  2. 否则按权重从随机池抽 `drawsPerTurn` 张（条件过滤 + once 过滤）
- `choose(config, state, choiceId)`：应用选项效果/文案，随 `goto` 链继续或触发结局
- 卡片触发流程：计数 fired → 执行 effects（按序，后面的表达式能读到前面的写入）→
  渲染 text → 有可用选项则挂起等待选择 → 否则沿 `goto` 链继续（链长 ≤32 防循环）
- 每次卡结算后（无挂起选项时）检查条件结局；story 的死端卡走隐式"完"结局

`pendingChoices(config, state)` 给出当前挂起卡的可用选项（渲染后的 label）。

## 4. 三级校验（`src/lib/schema/validate.ts` + `src/lib/simulate.ts`）

交接文档的判断成立：这层的工作量远大于"调 API"，也是 AI 生成质量的地基。

1. **结构校验**（zod）：类型/取值范围/互斥关系，AI 输出与用户保存都先过这层
2. **语义校验**：id 重复与保留字、悬空 goto/ending/fired、未知变量与函数、
   表达式解析错误、效果引用不存在的变量、story 从起始卡的可达性分析（孤儿卡）与
   死端提示、life 的"既不进池也没人指向"检测、结局可达启发式（条件里引用的变量
   从未被任何效果修改 ⇒ 警告）、模板插值逐个检查
3. **模拟校验**：随机策略跑 N 局（`simulate`），输出：结局覆盖率、**从未触发的结局**、
   **从未出现的卡**、平均/最短/最长局长、变量终值均值、运行时错误去重。
   这是"不可达结局"最有力的检测——静态分析做不到的，跑 600 局一目了然。
   编辑器「校验」页签与 AI 的 `simulate` 工具共用同一实现。

错误信息全部是中文人话（带路径），能直接展示给创作者，也能回喂给 AI 自动修。

## 5. 实战模式（模板与 AI 共同遵守）

- **掷点一致性**：随机结果要文案与数值一致——先 `set` 隐藏变量存掷点
  （如 `运势`），效果与 `{运势 == 1 ? "…" : "…"}` 文案统一引用它
- **主线节拍**：`priority` + `condition: "time == 8"`；按状态分叉的主线 =
  几张同 priority、条件互斥的卡（见示例里的测灵根三张卡）
- **埋线回收**：`fired("某卡")` 做前后呼应；隐藏变量做路线/阵营标记（如 `仙途`）
- **阶段分层**：life 事件卡用 condition 圈定人生阶段，避免不合时宜
- **尺度**：life 3~6 个核心变量、30~80 张卡、4~8 个结局、单局 3~10 分钟；
  story 10~40 张卡、3~6 个结局。首版宁小勿大

两个官方示例即模式样板：《修仙人生重开》（38 张卡，全套模式）、《雨夜末班车》
（条件选项 + 双变量门控多结局）。

## 6. 路线图与留口

- **v1.5 · sim 调度器与模块**（下一批，电竞经理 Lite / 宗门经营的落点）：
  实体（entityTypes/entities，含属性与标签）、聚合函数（`avg("弟子","修为")`）、
  结算（settlement：data 赛程行 + compute 中间量 + outcomes 分支）、
  成长曲线（按回合/周期批量规则）、**阶段进度**（换地图，带各自的对手池/事件池/招募池）、
  **招募**（从候选池获得实体——宗门流"收天骄"与转会的共同本质）。
  这些以可选模块挂在同一底座上，内容卡结构不变
- **运行时 AI**：静态优先不变；动态版 = AI 现场生成一张卡塞进同一个池子，渲染
  结算全复用（交接文档 §2-5 的架构要求已满足）；上下文管理用滚动摘要（§3-4）
- **沙箱脚本层**：Web Worker + 超时，硬核作者的自定义结算逃生舱（交接文档 §3-1 方案二）
- **账号系统**：v1 用 editKey（创建时发放，凭 `x-edit-key` 写入）适配邀请制内测；
  云存档/跨设备时上真 auth
- **导出**：游戏本体就是一份 JSON，天然可导出——这是对橙光"锁死作者"的直接回应，
  编辑器加"下载配置"按钮即可（低成本高价值，尽早做）

## 7. 合规备忘

内测期策略照交接文档执行：境外域名（Railway 自带域名）+ 一分钱不收 + 邀请制 +
人工过每个游戏。放量/收费前的硬墙清单见 `docs/HANDOFF.md` §5。
