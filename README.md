# 字游 WordPlay · 网页文字游戏创作平台

> 有想法，就能做出一款文字游戏。

给不懂技术的创作者一个工作台：跟 AI 策划聊一聊你的点子——修仙人生、宗门经营、都市怪谈——它帮你把想法变成可以玩的游戏。生成、校验、模拟、试玩，满意后一键发布，一条链接分享给所有人，**打开即玩、无需注册**。

我们是平台，不是游戏公司。一个人的想法有限，一百个人里可能就有一个爆点——平台的使命是把"试一次"的成本降到一次对话。

## 它长什么样

- **玩家**：打开 `/g/:id` 就能玩，免登录，进度自动存在本地浏览器；玩完看到"我也要做一个"，一分钟后成为创作者。
- **创作者**：`/new` 创建 → 进入工作台 `/edit/:id`。左边是 **AI 驻场策划**（对话式创作的主入口），右边是实时预览 / 设计卡 / 配置 / 校验四个页签。预览用的就是玩家页的渲染器——所见即所得。
- **游戏库**：首页陈列所有已发布的游戏，游戏反向为平台引流。

## 核心设计

**内容卡（storylet）底座，不绑定品类。** 一个游戏 = 状态（变量）+ 内容卡（文字+条件+权重+效果+选项）+ 调度器。品类差异全部收敛在调度器里：

| 调度器 | 品类 | 机制 |
| --- | --- | --- |
| `story` | 分支叙事（橙光/Twine 式） | 从起始卡开始，选项显式跳转 |
| `life` | 随机成长（人生重开式） | 时间自动推进，按条件筛选+权重抽卡，`priority` 主线卡强制插入 |
| `sim` | 经营模拟（球队/宗门/餐厅） | 玩家每回合主动决策（训练/转会/团建…）→ 结束回合 → 公式结算 → 随机事件 → 成长曲线 → 赛季滚动 |

调度器数量有限（平台代码），内容卡无限（用户数据）——这是"什么想法都能试"与"不写代码"同时成立的原因。完整设计见 [`docs/schema.md`](docs/schema.md)。

**关键工程决策**（详见 [`docs/HANDOFF.md`](docs/HANDOFF.md) 交接文档）：

- 多租户单应用：一个游戏 = 数据库里一行 JSON，发布 = 标记公开，**不触发任何部署**
- 编辑器与播放器同源：一套引擎两种模式
- 公式绝不用 `eval`：自研受限表达式语言（四则/比较/逻辑/三元/白名单函数），带长度/深度/步数上限；种子化随机数存在存档里，同种子同操作完全可复现
- 三级校验：zod 结构校验 → 语义校验（悬空引用/孤儿卡/不可达结局）→ **模拟校验**（自动跑几百局，直接告诉你哪个结局永远触发不了）
- AI 配额第一天就有：按编辑钥匙记每日请求数与 token

**AI 驻场策划。** 不是"生成按钮"，是带工具的多轮 agent：会反问、会挑战，改完配置自动过校验（错误回喂自动重试），大改后自己跑模拟拿数据说话（"80% 玩家活不过 20 岁，我把伤害调低了"）。因为引擎是纯函数、游戏是数据，AI 可以真的"玩"你的游戏——这是生成代码类平台做不到的。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 表达式/校验/引擎/示例模板 37 例
npm run build && npm start   # 生产模式
```

首次启动会把两个官方示例（《修仙人生重开》《雨夜末班车》）作为已发布游戏种子入库。

## 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `DATA_DIR` | SQLite 数据目录 | `./data` |
| `AI_BASE_URL` | OpenAI 兼容端点，如 `https://api.deepseek.com` | 未配置则 AI 面板降级提示 |
| `AI_API_KEY` | 密钥 | — |
| `AI_MODEL` | 模型名，如 `deepseek-chat` | — |
| `AI_DAILY_REQUESTS` | 每把编辑钥匙每日 AI 次数上限 | `40` |
| `AI_DAILY_TOKENS` | 每把编辑钥匙每日 token 上限 | `400000` |

AI 供应商随环境变量热插拔：DeepSeek / Qwen（DashScope 兼容模式）/ Kimi / 豆包 / GLM 等任何 OpenAI 兼容端点均可，见 `.env.example`。

## 部署到 Railway

仓库已带 `railway.json`（Nixpacks，`npm run build` / `npm start`）。步骤：

1. Railway → New Project → **Deploy from GitHub repo**，选中本仓库
2. 给服务挂一个 **Volume**，挂载点填 `/data`（SQLite 落盘，否则每次重新部署数据清零）
3. Variables 里设置：`DATA_DIR=/data`，以及 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`
4. Settings → Networking → **Generate Domain**，得到 `xxx.up.railway.app` 即可对外分享

注意：微信内打开 Railway 域名容易被拦，内测期让用户复制链接到浏览器打开即可（交接文档已有此结论，不值得为此折腾）。将来要放量/收费时的合规硬墙（备案、许可证、内容审核、实名防沉迷）已记录在 `docs/HANDOFF.md` 第五节，当前阶段全部延后。

## 目录结构

```
src/lib/expr       受限表达式语言（解析/求值/引用收集，无 eval）
src/lib/schema     GameConfig 类型 + zod 结构校验 + 语义校验
src/lib/engine     纯函数引擎（initState/step/choose，种子化 RNG）
src/lib/simulate   批量模拟与报告（校验面板与 AI 共用）
src/lib/store      GameStore 接口 + SQLite 实现（可换 Postgres）
src/lib/ai         驻场策划：OpenAI 兼容 provider + agent 循环 + 四工具
src/app            页面与 API（/ 游戏库、/new、/g/:id、/edit/:id、/u/:name）
src/components     GamePlayer——玩家页与编辑器预览共用的渲染器
templates          官方示例（life / story 各一）
tests              vitest 单测
docs               交接文档 + schema 设计文档
```

## 路线图

- **v1（已上线）**：内容卡底座 + story/life/sim 三调度器 + AI 驻场策划（四阶段创作流程：
  需求对齐 → 方案确认 → 实现 → 调优，配置生成带流程门禁）+ 游戏库；官方示例三款
  （电竞经理 Lite / 修仙人生重开 / 雨夜末班车）
- **v1.5**：sim 阶段进度模块（换地图：每阶段独立对手池/事件池/招募池）、实体运行时生成
  （无限青训/天骄池）、表现层主题扩展、配置导出按钮
- **v2**：账号系统与云存档（editKey 过渡方案退役）、沙箱脚本层（Web Worker 自定义结算，硬核作者逃生舱）、运行时 AI（游戏内动态生成事件卡——卡池结构已留好接口）

旗舰内容 [Val Manager](https://github.com/WeijieCao77/Val_Manager)（无畏契约电竞经理）作为独立作品运营，是平台的机制灵感来源与流量锚点，不迁入平台。
