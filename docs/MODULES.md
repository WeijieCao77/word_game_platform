# 模块地图

> 这份文档的唯一目的：**你要改某个东西时，知道该打开哪几个文件**——而不是通读整个仓库。
> 代码已经按模块拆过（引擎 9 个模块、玩家界面 10 个模块、样式 6 个文件、工作台按页签拆），
> 每个文件顶部都有 2~4 行注释说明「这个模块管什么、什么时候来改它」。

## 一、速查表：我要改…

| 我要改… | 打开这些 |
| --- | --- |
| 游戏库首页、卡片外观与翻面 | `src/app/page.tsx` + `src/styles/store.css` |
| 玩家看到的界面（某一块） | `src/components/player/`（见下表）+ `src/styles/player.css` |
| 玩法规则：抽卡、选项、结算、行动点、联赛 | `src/lib/engine/`（见下表） |
| AI 会说什么、什么时候建议某个模块 | `src/lib/ai/prompt.ts` |
| AI 的工具与重试逻辑 | `src/lib/ai/agent.ts` |
| 换 AI 供应商/模型 | `src/lib/ai/provider.ts` + 环境变量 `AI_PROVIDER` |
| 设计卡的模板与解析 | `src/lib/ai/designcard.ts` |
| 新增一个游戏配置字段 | `src/lib/schema/types.ts` + `zod.ts` + `validate.ts`（三个都要改） |
| 校验规则（什么算错、什么算警告） | `src/lib/schema/validate.ts` |
| 模拟器的随机策略、早终局检测 | `src/lib/simulate.ts` |
| 表达式语言（加函数、改上限） | `src/lib/expr/` |
| 数据库表、统计口径、后台聚合 | `src/lib/store/sqlite.ts`（接口在 `types.ts`） |
| 密码哈希、会话令牌、用户名口令规则 | `src/lib/auth.ts` |
| 「当前是谁」、编辑权、登录限频、AI 配额口径 | `src/lib/session.ts` |
| 登录注册界面、顶栏账号状态 | `src/app/login/page.tsx` + `src/components/AuthNav.tsx` |
| 创作工作台的某个页签 | `src/components/editor/`（见下表）+ `src/styles/editor.css` |
| 新手引导的步骤与文案 | `src/components/editor/tourSteps.ts`；引导组件本身在 `src/components/Tour.tsx` |
| 开发者后台 | `src/app/admin/page.tsx` + `src/app/api/admin/stats/route.ts` + `store.adminStats()` |
| 封面预设插画 | `src/components/GameCover.tsx` |
| 旗舰位与站内嵌入 | `src/app/flagship/page.tsx` + `src/components/FlagshipFrame.tsx` |
| 全站配色与排版 | `src/styles/base.css` |
| 官方示例游戏的内容 | `templates/*.json`（改完必须过模板门槛，见 `CLAUDE.md`） |

## 二、引擎 `src/lib/engine/`

纯函数、可复现（种子存在存档里）、被播放器/预览/模拟器/AI 共用。
**唯一对外门面是 `index.ts`**，外部一律 `import { … } from "@/lib/engine"`。

| 文件 | 管什么 |
| --- | --- |
| `index.ts` | 门面与模块导航，只做再导出 |
| `internal.ts` | 求值上下文 `GameScope`（变量/实体/内置函数如 `rank()`）、`{}` 文案插值、效果落地、数值夹取 |
| `endings.ts` | 结局判定：具名结局、条件结局优先级、兜底收尾 `timeoutEnd` |
| `cards.ts` | 卡片链 `resolveCard`、随机抽卡、`textVariants` 轮换（防重复） |
| `choices.ts` | 选项可选性与 `choose` |
| `input.ts` | 关键词输入门、全局检索台、档案夹（三者都基于关键词归一化 `src/lib/keyword.ts`） |
| `actions.ts` | sim 决策：可用性、目标选择、行动点扣减 |
| `settle.ts` | sim 回合管线：结算 → 事件 → 曲线 → 结局 → 周期滚动；结算归因快照 |
| `leagues.ts` | 活联赛：玩家记账、对手镜像、NPC 之间互赛、积分榜 |
| `rng.ts` | 确定性随机流（mulberry32） |

依赖方向是严格 DAG：`rng ← internal ← endings ← cards ← state ← settle ← {choices, input}`，
`actions`、`leagues` 各自独立。**新增模块时不要制造反向依赖**——需要共享的东西下沉到 `internal.ts`。

规矩：不用 `Math.random()`（破坏可复现）、不用 `eval`（表达式走 `src/lib/expr`）、
所有改状态的函数都返回新状态或原地改传入的副本，调用方不假设别的。

## 三、玩家界面 `src/components/player/`

`src/components/GamePlayer.tsx` 是编排层（读写存档、调引擎、分发数据），
**玩家页 `/g/:id` 与工作台预览用的是同一个组件**，只差一个 `mode`。

| 文件 | 管什么 |
| --- | --- |
| `util.ts` | 存档键、配置指纹（识别旧存档）、素材地址解析、数字格式化 |
| `hooks.ts` | 统计上报：每次进入/重开计一次游玩、点赞、在线时长 |
| `LogView.tsx` | 叙事流与配图 |
| `Choices.tsx` | 选项按钮 + 关键词输入门表单 |
| `SearchBox.tsx` | 全局检索台（`config.search` 有才出现） |
| `Notebook.tsx` | 档案夹抽屉（`config.notebook` 有才出现） |
| `panels.tsx` | 属性条、下一场预告、结局横幅、结算复盘 |
| `SimView.tsx` | sim 多页签编排 + 行动面板（**页签由配置推导，没数据就没这一页**） |
| `SimSchedule.tsx` | 赛程表与联赛积分榜 |
| `Roster.tsx` | 阵容表 |

## 四、工作台 `src/app/edit/[id]/` 与 `src/components/editor/`

`src/app/edit/[id]/page.tsx` 只做编排：编辑钥匙、加载与保存、AI 对话请求、页签状态，
再把数据分发给下面的模块。

| 文件 | 管什么 |
| --- | --- |
| `ChatPane.tsx` | 左侧对话区：阶段条、职能徽章消息、消息流、输入框 |
| `stages.ts` | 创作流程常量：四个阶段、每阶段活跃的职能与提示语 |
| `tourSteps.ts` | 新手引导的步骤与文案（组件本身是 `src/components/Tour.tsx`） |
| `assets.ts` | 素材纯逻辑：封面压缩（16:9）、素材压缩（长边 900）、设计卡「素材清单」文本生成 |
| `types.ts` | 页签间共享的类型（`Tab` / `ChatMsg` / 素材条目） |
| `tabs/PreviewTab.tsx` | 预览试玩（内嵌 `GamePlayer`，与玩家页同源） |
| `tabs/DesignTab.tsx` | 设计卡 |
| `tabs/ConfigTab.tsx` | 配置 JSON |
| `tabs/CheckTab.tsx` | 校验结果与模拟报告 |
| `tabs/LibraryTab.tsx` | 内容库：推荐排序、装配、分享 |
| `tabs/CoverTab.tsx` | 封面：上传、移除、16 款主题预设网格（素材块由 `children` 传入） |
| `tabs/AssetsSection.tsx` | 游戏内素材：起名、上传、共享到公共库勾选、素材网格、公共库导入 |

顶栏（导出/保存/发布/改名/引导）没有单独拆出去——它 1:1 绑在页面动作上，
拆出去要透传十几个 props，留在编排层更好改。

新手引导靠这些选择器定位，**改结构时不要弄丢**：页签按钮的 `data-tour="tab-*"`、
对话区 `.chat-pane` / `.chat-stagebar` / `.chat-input`、顶栏 `.editor-topbar`。

## 五、schema 与校验 `src/lib/schema/`

| 文件 | 管什么 |
| --- | --- |
| `types.ts` | `GameConfig` 全部类型定义——**新字段一律可选**，老游戏不能因为加字段而失效 |
| `zod.ts` | 结构校验（形状对不对） |
| `validate.ts` | 语义校验（引用存不存在、有没有死局、行动点预算够不够、联赛挂没挂上） |
| `modules.ts` | 后台的「模块功能库」登记表（14 个可选模块）——**不在前台展示** |

三级校验：zod → 语义 → 模拟（`src/lib/simulate.ts` 跑几百局）。AI 生成的配置必须三关全过才写库。

## 六、存储 `src/lib/store/`

`types.ts` 是接口（将来换 Postgres 只需重新实现它），`sqlite.ts` 是当前实现。
一个游戏 = 一行 JSON（配置 + 设计卡 + 对话记录 + 封面 blob），另有素材表、公共素材库、
按日统计表 `game_stats_daily`、内容库表、AI 用量表。

## 七、页面与 API `src/app/`

| 路由 | 是什么 |
| --- | --- |
| `/` | 游戏库首页（卡片翻面看简介） |
| `/g/:id` | 玩家页，免登录 |
| `/new` | 创建游戏（空白或从官方示例起步） |
| `/edit/:id` | 创作工作台 |
| `/mine` | 我的创作（本机编辑钥匙 + 钥匙串导出导入） |
| `/u/:name` | 作者页 |
| `/flagship` | 旗舰作品站内嵌入外壳 |
| `/login` | 登录 / 注册（注册时自动认领本机游客作品） |
| `/admin` | 开发者后台（暗链，凭管理员账号） |

API 在 `src/app/api/` 下，与页面同构：`games`（CRUD/发布/统计/素材/封面/AI 对话）、
`library`（内容库与公共素材库）、`auth`（注册/登录/登出/我是谁/认领/我的作品）、
`users`、`admin/stats`、`health`。

写操作的鉴权只有一处判断——`canEditGame`（`src/lib/session.ts`）：
**作品无主时钥匙即身份；作品一旦归属账号，就只认账号**（钥匙不再单独授权）。
加新的写接口时用它，不要再直接调 `checkEditKey`。

## 八、样式 `src/styles/`

`src/app/globals.css` 只是一份 `@import` 清单。改界面时按模块进对应文件：
`base`（主题变量/排版/导航/按钮/表单）、`store`（首页与卡片）、`editor`（工作台）、
`player`（玩家端）、`admin`（后台）、`tour`（新手引导）。

## 九、两条数据流

**一次游玩**：`/g/:id` 页面从 store 读配置 → `GamePlayer` 用 `initState` 建档（或读本地存档）
→ 玩家操作调 `choose`/`step`/`performAction`/`endTurn`/`searchKeyword` → 新状态渲染成界面并存回 localStorage
→ 统计事件打到 `/api/games/:id/stats`。

**一次创作**：工作台把作者的话 + 设计卡 + 当前配置发给 `/api/games/:id/assistant`
→ `src/lib/ai/agent.ts` 带四个工具跑多轮（改设计卡 / 改配置 / 校验 / 模拟）
→ 配置每次写入都过三级校验，错误回喂重试 → 存库 → 右侧预览用同一个 `GamePlayer` 渲染。
