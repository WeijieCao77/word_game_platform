# VAL MANAGER 复刻实测素材

老板定的验收标准只有一条：**用这个平台一比一复刻出 VAL MANAGER，功能和 UI 完全一样。**
这个目录放的就是量这把尺子要用的东西。

- `spec.md` —— 发给线上 AI 的建造说明书。不是我编的题材梗概，是从原作
  （github.com/WeijieCao77/Val_Manager，13,132 行）里逐项抽出来的：
  八个赛段的日历、行动点预算、ban/pick 顺序、逐回合模拟与战术暂停、
  三条关系轴、11 个主界面与一批弹层。
- `data/teams.csv`（78 队）、`data/players.csv`（518 人）、`data/analysts.csv`
  —— **原作真实用的那份世界数据**（src/data/world.json）转成的表。
  实测时由 workflow 传进作品的 data/ 目录，AI 用 `WGP.data("players")` 取。

为什么数据要平台传、不让 AI 生成：518 名选手一条条写要烧掉整轮预算，
而且编出来的名单跟「一模一样」根本不沾边。这也正是平台数据表功能存在的理由。

数据来源是原作仓库里已经抓好并公开的世界档案，只做了格式转换，没有改动数值。
