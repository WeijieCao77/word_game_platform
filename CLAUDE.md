# 给接手这个项目的人（和 AI）

「字游 WordPlay」是一个**平台化的游戏制作 agent**：创作者只提想法，一支 AI 团队按专业流程把它做成
一款完整的网页文字游戏，发布后一条链接即玩、无需注册、零部署。

## 上手顺序（别一上来就读代码）

1. [`docs/STATUS.md`](docs/STATUS.md) — 平台现在能干什么、做到哪一步、有哪些坑
2. [`docs/MODULES.md`](docs/MODULES.md) — **模块地图：要改某个东西，该看哪几个文件**
3. [`docs/schema.md`](docs/schema.md) — 底层设计：内容卡 schema、表达式语言、三级校验
4. [`docs/ROADMAP.md`](docs/ROADMAP.md) — 下一步做什么，以及怎么判断一个新想法该不该做
5. [`docs/HANDOFF.md`](docs/HANDOFF.md) — 最初的交接文档（历史决策的来源）

代码只读你要改的那个模块。模块地图就是为了让你不必通读上千行。

## 两条铁律

1. **所有游戏都必须能"用平台做出来"**，而不是手写代码塞进去。官方示例也一样——它们全部由平台自己的
   schema + 工作流产出，过同一套门槛。如果一个功能只能靠改代码实现，那平台就是没有这个能力。
2. **固化的是工作流，不是游戏模板**。创意讨论 → 数值设计 → 机制设计 → 人设画像是固定的；
   页签、栏目、机制全部由配置推导——没有赛程数据就不该有赛程页。给所有游戏套同一个模板是重大错误。

## 加一个新的游戏功能，是"六件套"

任何游戏机制（检索台、档案夹、行动点、活联赛……）要成为平台能力，都要走完这六步，缺一不可：

| # | 位置 | 做什么 |
| --- | --- | --- |
| 1 | `src/lib/schema/types.ts` + `zod.ts` | 定义结构，**可选字段**（老游戏不受影响） |
| 2 | `src/lib/schema/validate.ts` | 语义校验：引用是否存在、预算是否够、有没有写成死局 |
| 3 | `src/lib/engine/` | 引擎实现，纯函数、可复现，不用 `Math.random()` |
| 4 | `src/lib/simulate.ts` | 让随机策略会用这个机制，否则模拟覆盖不到 |
| 5 | `src/components/player/` | 玩家界面（**按配置显隐**，没配就完全不出现） |
| 6 | `src/lib/ai/prompt.ts` | 写进 AI 守则：什么时候建议作者用、怎么用才不翻车 |

再加 `src/lib/schema/modules.ts` 里登记一条——那是后台的模块功能库。
**注意：模块库不在前台显性展示**，作者不需要学它；作者提需求时装上，AI 觉得需要时主动建议。

## 验收门槛（做完必须跑）

```bash
npm test                                  # 全绿（当前 83 passed / 1 skipped）
npx tsc --noEmit                          # 零错误
npm run build                             # 通过
TEMPLATE=xxx.json npx vitest run tests/adhoc-template.test.ts   # 改了模板才跑
```

模板的门槛是：**零错误零警告 + 600 局模拟全结局可达全卡片触发 + 开局即死率 0**。

改了界面就起本地服务用 Playwright 截图看一眼再交：

```bash
DATA_DIR=/tmp/verify PORT=3100 npm start
# 浏览器在 /opt/pw-browsers/chromium-1194/chrome-linux/chrome
```

## 这个远程容器会「回退」——先读这一条

在 Claude Code 远程环境里干活时，**容器闲置一段时间会被回收，重建后文件系统回到一个较旧的快照**
（本项目实测：两次回退都退回同一个 commit，`git reflog` 里当天的提交记录一条都不剩，
`.git` 目录的创建时间就是会话开始那一刻）。也就是说：

- 只存在于容器里的东西（未推送的提交、未提交的改动）**会整批消失**，且每次都退到同一个旧点
- 已经 push 到 GitHub 的东西**一点不少**——远端是唯一的安全网

**每次会话开始、以及任何时候发现文件/目录莫名其妙不见了，第一件事是核对远端：**

```bash
git fetch origin <branch>
git log --oneline -1 FETCH_HEAD          # 远端到哪了
git status --short                        # 本地有没有未提交的改动（有就先备份 diff）
git reset --hard origin/<branch>          # 工作区没有要保留的改动时，直接对齐远端
```

所以下面这条不是洁癖，是这个环境的生存法则：

## 「代码改了，线上没变」——先查是不是没部署

Railway 是靠 GitHub 推送事件自动部署的，这条链路**断过一次**（2026-08-25，12:40 之后
所有推送都没触发构建，线上停在 8e5286c 整整两小时；期间连着报了三个「功能没实现」，
其实全都写完推上去了）。判断方法，按顺序：

1. `GET /api/health` 看 `build.commit` 是不是最新 commit 的前 7 位。
   没有 `build` 段 = 跑的是 2026-08-25 14:13 之前的老代码。
2. 跑 `Railway variables` workflow（不填 set_vars 就是只读），看「最近部署」那一段：
   最新一条的时间戳如果早于你最后一次 push，就是自动部署断了。
3. 断了只能人去 Railway 控制台修：服务 → Settings → Source，确认还连着
   `WeijieCao77/word_game_platform` 的 `claude/text-game-platform-handoff-op7cmd` 分支；
   断开就重新 Connect（GitHub App 授权过期会导致静默失效，控制台不报错）。
   临时应急可以在 Deployments 页手动 Deploy 一次。

**注意 `railway redeploy` 不会拉新代码**——它只是把同一个 commit 再部署一遍。
workflow 里改变量后触发的那次重新部署也一样，只能让**环境变量**生效，不能让新代码上线。
反过来说这也是个应急手段：能用环境变量控制的东西（配额上限、模型、旗舰位署名），
改 Railway 变量就能立刻生效，不必等代码部署。

## 工作约定

- **每完成一段就 commit + push**。容器会回收，没推送的工作会丢——这在本项目真实发生过三次，
  每次都靠远端完好而零损失。
- 提交信息用中文写清「做了什么、为什么」，不要写模型名或工具名。
- **密钥永远不进代码、不进对话**：走 Railway Variables 或 GitHub Actions Secrets。
- 容器出口屏蔽了 `railway.app` 与 `api.github.com`：Railway 操作走 GitHub Actions workflow，
  GitHub 操作走 MCP 工具。
- 引擎里不要用 `Math.random()`，随机一律走存档里的种子（模拟器和测试都依赖可复现）。
- 表达式绝不用 `eval`：加函数要进 `src/lib/expr` 的白名单。

## 判断一个新想法该不该做

1. 它是**平台能力**还是某个游戏的需求？平台要的是"用户有这个想法时做得出来"，不是把现有游戏都改成那样。
2. 作者能不能**只靠对话**把它用起来？需要作者读 schema 才会用的功能，等于没做。
3. 它是**可选模块**吗？任何"每个游戏都必须有"的东西都要非常谨慎。
4. 过得了三级校验和 600 局模拟吗？过不了就不是完整的游戏能力。
