"""电竞经理生成器：同一套机制骨架，两种风味。

- vct-manager.json  —— 对标旗舰作品 VAL MANAGER（无畏契约）
- kpl-manager.json  —— 王者荣耀 KPL 版本

两者用完全相同的机制：八项属性、位置配齐、体能与状态、训练/转会/商业/教练组决策、
周薪账本、董事会目标与下课、活积分榜、**季后赛对阵表**、**队内羁绊**、
**待办箱（报价与谈判要等回音）**。差别只在术语、位置名、战队名与文案风味。

写成生成器而不是手敲两份 JSON：机制一处改动，两款同时受益。
"""
import json
import copy

OUT_DIR = "/home/user/word_game_platform/templates"


# ---------------------------------------------------------------- 风味包
VCT = {
    "file": "vct-manager.json",
    "title": "无畏契约经理：凤凰计划",
    "genre": "电竞经营",
    "my_team": "Rising Phoenix",
    "league_name": "VCT 中国",
    "cup_name": "冠军巡回赛",
    "roles": ["决斗者", "先锋", "控场", "哨卫", "自由人"],
    "attrs": ["枪法", "反应", "意识", "道具", "残局", "协同", "沟通", "指挥"],
    "core_attr": "枪法",
    "second_attr": "意识",
    "util_attr": "道具",
    "match_word": "地图",
    "patch_word": "版本",
    "teams": [
        ("EDward Gaming", 84), ("Bilibili Gaming", 81), ("Trace Esports", 79),
        ("FunPlus Phoenix", 78), ("Titan Esports Club", 76), ("Nova Esports", 75),
        ("Wolves Esports", 74), ("Dragon Ranger Gaming", 73), ("TYLOO", 71),
        ("Xi Lai Gaming", 69), ("All Gamers", 72),
    ],
    "intl": [
        ("Paper Rex", 89), ("Fnatic", 88), ("Sentinels", 87), ("Gen.G", 87),
        ("Team Heretics", 85), ("DRX", 84), ("Cloud9", 83), ("FUT Esports", 82),
        ("Leviatán", 81), ("NRG Esports", 80), ("Team Liquid", 83),
    ],
    "squad": [
        ("Haoran", "决斗者", "主力", [93, 91, 78, 62, 84, 71, 68, 40], 19, 96, 38),
        ("Wenbo", "先锋", "主力", [82, 84, 83, 79, 74, 82, 80, 55], 22, 88, 31),
        ("Zhilin", "控场", "主力", [74, 76, 88, 91, 70, 86, 84, 62], 23, 89, 29),
        ("Mochi", "哨卫", "主力", [78, 75, 85, 83, 81, 84, 79, 58], 21, 90, 27),
        ("LaoK", "自由人", "主力", [71, 70, 92, 80, 76, 88, 93, 90], 27, 92, 22),
        ("Xiaoyu", "决斗者", "替补", [80, 83, 72, 60, 73, 70, 66, 35], 18, 94, 19),
        ("Bingo", "控场", "替补", [68, 70, 79, 85, 66, 81, 77, 48], 24, 82, 14),
    ],
    "market": [
        ("Aster", "决斗者", [95, 93, 82, 66, 88, 74, 72, 44], 22, 96, 62),
        ("Nightly", "哨卫", [84, 80, 90, 88, 85, 87, 83, 61], 23, 92, 55),
        ("Qiuye", "控场", [76, 78, 91, 94, 74, 89, 88, 70], 25, 93, 48),
        ("Rin", "先锋", [88, 89, 84, 77, 80, 79, 75, 50], 20, 95, 51),
        ("Tuomu", "自由人", [74, 73, 94, 82, 79, 91, 95, 94], 29, 95, 40),
        ("Kanade", "决斗者", [86, 88, 75, 64, 79, 72, 70, 38], 19, 93, 33),
        ("Shibai", "哨卫", [72, 71, 80, 79, 74, 80, 76, 47], 26, 80, 16),
        ("Yanhe", "先锋", [79, 81, 78, 74, 71, 76, 73, 42], 21, 88, 21),
    ],
    "coaches": [
        ("教练_张", "张沐（战术型）", 62, 88, 55, 6),
        ("教练_李", "李骁（青训型）", 85, 60, 91, 5),
        ("教练_周", "周迟（全能，贵）", 82, 84, 78, 11),
    ],
    "description": (
        "接手一支刚升上 VCT 中国赛区的队伍。八项属性、五个位置、每周三个行动点——"
        "练谁、买谁、卖谁、接不接商业活动，全都是取舍。队内羁绊会影响战力，"
        "报价发出去要等对方回音，赛季末还有四强淘汰赛。"
        "董事会每个赛季给你一个目标，连着两次交不出答卷就换人。"
    ),
    "intro": (
        "签字那天，俱乐部老板只说了一句话：「我们不缺钱，缺的是有人真的懂这支队。」\n"
        "更衣室里五个人抬头看你。最年轻的十九岁，枪法是全联赛前三；"
        "最年长的二十七岁，还能指挥，但手已经慢了。\n"
        "第一个赛季的目标写在白板上：进季后赛。"
    ),
}

KPL = {
    "file": "kpl-manager.json",
    "title": "王者荣耀经理：登顶 KPL",
    "genre": "电竞经营",
    "my_team": "南岭雏鹰",
    "league_name": "KPL 常规赛",
    "cup_name": "王者世界冠军杯",
    "roles": ["对抗路", "打野", "中单", "发育路", "游走"],
    "attrs": ["操作", "意识", "发育", "团战", "视野", "协同", "沟通", "指挥"],
    "core_attr": "操作",
    "second_attr": "意识",
    "util_attr": "视野",
    "match_word": "局",
    "patch_word": "版本",
    "teams": [
        ("成都AG超玩会", 84), ("北京WB", 82), ("武汉eStarPro", 81),
        ("重庆狼队", 79), ("佛山DRG", 77), ("上海EDG.M", 76),
        ("广州TTG", 74), ("南京Hero久竞", 73), ("深圳DYG", 71),
        ("西安WE", 69), ("杭州LGD大鹅", 72),
    ],
    # 世冠的海外参赛队：与国内联赛不重名，否则跨区赛段那张表会出现重复队伍
    "intl": [
        ("Team Falcons", 88), ("Buriram United", 86), ("Kingdom Esports", 85),
        ("Bacon Time", 84), ("Talon Esports", 83), ("EVOS Legends", 82),
        ("RRQ Hoshi", 84), ("Onic Esports", 83), ("SEM9", 80),
        ("Nova Esports MY", 79), ("Team Flash", 81),
    ],
    "squad": [
        ("小炎", "打野", "主力", [94, 88, 79, 83, 62, 72, 70, 42], 18, 97, 40),
        ("阿澈", "中单", "主力", [85, 86, 82, 84, 71, 80, 78, 56], 21, 90, 33),
        ("老墙", "对抗路", "主力", [76, 80, 88, 79, 74, 87, 82, 60], 24, 88, 28),
        ("鹿鸣", "发育路", "主力", [88, 79, 90, 81, 66, 78, 74, 45], 20, 93, 31),
        ("大牛", "游走", "主力", [70, 90, 62, 86, 93, 89, 94, 91], 26, 92, 24),
        ("小满", "打野", "替补", [82, 78, 74, 76, 60, 71, 68, 36], 17, 95, 18),
        ("阿芜", "游走", "替补", [66, 81, 60, 79, 86, 83, 80, 52], 23, 84, 15),
    ],
    "market": [
        ("影翎", "打野", [96, 91, 82, 88, 68, 75, 73, 47], 21, 97, 64),
        ("清昼", "中单", [90, 89, 85, 89, 74, 84, 82, 63], 22, 94, 57),
        ("砚山", "对抗路", [79, 84, 92, 83, 77, 90, 86, 71], 25, 92, 46),
        ("流火", "发育路", [93, 82, 94, 85, 69, 80, 76, 49], 19, 96, 53),
        ("长庚", "游走", [72, 93, 64, 90, 95, 92, 96, 95], 28, 96, 42),
        ("阿岚", "打野", [87, 83, 77, 80, 63, 73, 71, 39], 18, 94, 34),
        ("石斑", "发育路", [74, 72, 81, 75, 62, 79, 75, 44], 26, 81, 17),
        ("云舟", "中单", [81, 80, 79, 78, 68, 77, 74, 43], 20, 89, 22),
    ],
    "coaches": [
        ("教练_韩", "韩野（BP 型）", 60, 90, 54, 6),
        ("教练_苏", "苏白（青训型）", 87, 61, 93, 5),
        ("教练_陆", "陆迢（全能，贵）", 83, 85, 79, 11),
    ],
    "description": (
        "接手一支刚打上 KPL 的青年军。八项能力、五个分路、每周三个行动点——"
        "练谁、买谁、卖谁、接不接商务，全都是取舍。队内默契会影响战力，"
        "报价发出去要等对方回音，赛季末还有四强季后赛。"
        "俱乐部每个赛季给你一个目标，连着两次交不出答卷就换人。"
    ),
    "intro": (
        "签合同那天，老板把手机推过来，屏幕上是上赛季的战报：常规赛第十。\n"
        "「青训营送上来的人，一个都别浪费。」\n"
        "训练室里五个人回过头。打野十八岁，操作是全联赛前三；游走二十六，"
        "视野和指挥还在，但手速已经不是当年了。\n"
        "白板上写着第一个赛季的目标：进季后赛。"
    ),
}


# ---------------------------------------------------------------- 组装
def build(F):
    A = F["attrs"]
    core, second, util = F["core_attr"], F["second_attr"], F["util_attr"]
    MY = F["my_team"]

    def player(name, role, tag, vals, age, pot, price, fit=88):
        attrs = {a: v for a, v in zip(A, vals)}
        attrs.update({"体能": fit, "年龄": age, "潜力": pot, "身价": price})
        return {"id": name, "type": "选手", "name": name, "attrs": attrs, "tags": [tag, role]}

    entities = [player(n, r, t, v, a, p, pr) for n, r, t, v, a, p, pr in F["squad"]]
    entities += [player(n, r, "市场", v, a, p, pr) for n, r, v, a, p, pr in F["market"]]
    entities += [
        {"id": cid, "type": "教练", "name": cname,
         "attrs": {"训练": tr, "战术": ta, "带新": dv, "薪资": sal}, "tags": ["候选"]}
        for cid, cname, tr, ta, dv, sal in F["coaches"]
    ]

    opponents = [t for t in F["teams"] if t[0] != MY]
    intl = [t for t in F["intl"] if t[0] != MY]

    vars_ = [
        {"id": "资金", "name": "资金", "initial": 42, "min": -60, "max": 999},
        {"id": "声望", "name": "声望", "initial": 34, "min": 0, "max": 100},
        {"id": "士气", "name": "士气", "initial": 66, "min": 0, "max": 100},
        {"id": "董事会信任", "name": "俱乐部信任", "initial": 55, "min": 0, "max": 100},
        {"id": "积分", "name": "积分", "initial": 0, "min": 0, "max": 99, "resetEachCycle": True},
        {"id": "冠军数", "name": "冠军数", "initial": 0, "min": 0, "max": 9},
        {"id": "版本理解", "name": f"{F['patch_word']}理解", "initial": 0, "min": 0, "max": 18},
        {"id": "赞助等级", "name": "赞助等级", "initial": 0, "min": 0, "max": 3},
        {"id": "警告次数", "name": "警告次数", "initial": 0, "min": 0, "max": 9, "visible": False},
        {"id": "运势", "name": "运势", "initial": 0, "min": 0, "max": 1, "visible": False},
        {"id": "有主教练", "name": "有主教练", "initial": 0, "min": 0, "max": 1, "visible": False},
        {"id": "教练训练", "name": "教练训练", "initial": 0, "min": 0, "max": 99, "visible": False},
        {"id": "教练战术", "name": "教练战术", "initial": 0, "min": 0, "max": 99, "visible": False},
        {"id": "教练带新", "name": "教练带新", "initial": 0, "min": 0, "max": 99, "visible": False},
        {"id": "谈判中", "name": "谈判中", "initial": 0, "min": 0, "max": 9, "visible": False},
    ]

    derived = [
        {"id": "阵容完整", "name": "阵容完整",
         "expr": 'count("选手", "主力") >= 5 && '
                 + " && ".join(f'count("选手", "{r}") >= 1' for r in F["roles"][:4]) + " ? 1 : 0"},
        {"id": "个人能力", "name": "个人能力",
         "expr": f'avg("选手", "{A[0]}", "主力") * 0.24 + avg("选手", "{A[1]}", "主力") * 0.14 '
                 f'+ avg("选手", "{A[2]}", "主力") * 0.16 + avg("选手", "{A[3]}", "主力") * 0.12 '
                 f'+ avg("选手", "{A[4]}", "主力") * 0.08'},
        {"id": "团队能力", "name": "团队能力",
         "expr": f'avg("选手", "{A[5]}", "主力") * 0.12 + avg("选手", "{A[6]}", "主力") * 0.06 '
                 f'+ max_of("选手", "{A[7]}", "主力") * 0.06'},
        {"id": "默契", "name": "默契", "expr": 'harmony("羁绊", "主力")'},
        {"id": "状态系数", "name": "状态系数",
         "expr": 'clamp(avg("选手", "体能", "主力") / 92, 0.86, 1.05)'},
        {"id": "战力", "name": "战力",
         "expr": '(个人能力 + 团队能力) * 状态系数 * (阵容完整 == 1 ? 1 : 0.84) '
                 '+ 士气 * 0.06 + 版本理解 * 0.35 + 教练战术 * 0.05 + 默契 * 0.25'},
    ]

    relations = [{
        "id": "羁绊", "name": "队内默契", "entityType": "选手",
        # 同龄人天然亲近一点；年龄差越大，起点越低
        "initial": "8 - abs(self.年龄 - other.年龄) * 0.6",
        "min": -12, "max": 24,
    }]

    pendings = [
        {
            "id": "转会报价", "name": "转会报价", "waitTurns": "randint(2, 4)",
            "targetType": "选手",
            "waitingText": "对方俱乐部还在考虑，经纪人说这两天给回话。",
            "outcomes": [
                {"id": "谈成", "condition": "资金 >= target.身价 && chance(0.62)",
                 "effects": [
                     {"ref": "资金", "op": "add", "value": "-target.身价"},
                     {"ref": "target", "op": "remove_tag", "tag": "市场"},
                     {"ref": "target", "op": "add_tag", "tag": "替补"},
                     {"ref": "声望", "op": "add", "value": "2"},
                     {"ref": "士气", "op": "add", "value": "3"},
                     {"ref": "谈判中", "op": "add", "value": "-1"},
                 ],
                 "text": "{target.name} 签了。更衣室里多了一把椅子，也多了一份压力。"},
                {"id": "抬价", "condition": "资金 >= target.身价",
                 "effects": [
                     {"ref": "资金", "op": "add", "value": "-2"},
                     {"ref": "谈判中", "op": "add", "value": "-1"},
                 ],
                 "text": "对方临门一脚抬了价。{target.name} 这笔黄了，违约金还得你出。"},
                {"id": "钱不够", "condition": "1",
                 "effects": [{"ref": "谈判中", "op": "add", "value": "-1"}],
                 "text": "{target.name} 的经纪人只回了四个字：预算不够。"},
            ],
        },
        {
            "id": "赞助洽谈", "name": "赞助洽谈", "waitTurns": "randint(2, 5)",
            "waitingText": "品牌方在走内部流程。",
            "outcomes": [
                {"id": "签下", "condition": "chance(clamp(0.16 + 声望 / 110 + 冠军数 * 0.16, 0.1, 0.85))",
                 "effects": [
                     {"ref": "赞助等级", "op": "add", "value": "1"},
                     {"ref": "声望", "op": "add", "value": "3"},
                     {"ref": "谈判中", "op": "add", "value": "-1"},
                 ],
                 "text": "赞助合同签了。财务那边总算能松一口气。"},
                {"id": "婉拒", "condition": "1",
                 "effects": [{"ref": "谈判中", "op": "add", "value": "-1"}],
                 "text": "品牌方回了一封很客气的邮件，意思是再看看。"},
            ],
        },
        {
            "id": "教练邀约", "name": "教练邀约", "waitTurns": "randint(2, 4)",
            "targetType": "教练",
            "waitingText": "对方在考虑要不要来。",
            "outcomes": [
                {"id": "答应", "condition": "资金 >= target.薪资 * 2 && chance(0.7)",
                 "effects": [
                     {"ref": "target", "op": "remove_tag", "tag": "候选"},
                     {"ref": "target", "op": "add_tag", "tag": "在任"},
                     {"ref": "有主教练", "op": "set", "value": "1"},
                     {"ref": "教练训练", "op": "set", "value": "target.训练"},
                     {"ref": "教练战术", "op": "set", "value": "target.战术"},
                     {"ref": "教练带新", "op": "set", "value": "target.带新"},
                     {"ref": "资金", "op": "add", "value": "-target.薪资"},
                     {"ref": "谈判中", "op": "add", "value": "-1"},
                 ],
                 "text": "{target.name} 上任。第一次开会他只问了一个问题：「你们想赢，还是想赢得好看？」"},
                {"id": "拒绝", "condition": "1",
                 "effects": [{"ref": "谈判中", "op": "add", "value": "-1"}],
                 "text": "{target.name} 婉拒了，说想再看看别家的方案。"},
            ],
        },
    ]

    actions = [
        {"id": "专项特训", "name": f"专项特训（{core}）", "cost": 1, "condition": "资金 >= 3",
         "target": {"entityType": "选手", "condition": 'tag("主力") || tag("替补")'},
         "effects": [
             {"ref": "资金", "op": "add", "value": "-3"},
             {"ref": f"target.{core}", "op": "add",
              "value": f"target.{core} < target.潜力 ? randint(1, 2) + (教练训练 >= 80 ? 1 : 0) : (chance(0.25) ? 1 : 0)"},
             {"ref": "target.体能", "op": "add", "value": "-randint(3, 6)"},
         ],
         "text": "{target.name} 在训练室待到了凌晨。练上去了，脸也白了一圈。"},
        {"id": "复盘课", "name": f"复盘课（{second}）", "cost": 1, "condition": "资金 >= 3",
         "target": {"entityType": "选手", "condition": 'tag("主力") || tag("替补")'},
         "effects": [
             {"ref": "资金", "op": "add", "value": "-3"},
             {"ref": f"target.{second}", "op": "add",
              "value": f"target.{second} < target.潜力 ? randint(1, 2) + (教练战术 >= 80 ? 1 : 0) : (chance(0.25) ? 1 : 0)"},
             {"ref": "target.体能", "op": "add", "value": "-randint(1, 3)"},
         ],
         "text": "复盘室的灯亮了三个小时。{target.name} 把上周那一波看了十一遍。"},
        {"id": "细节课", "name": f"细节课（{util}）", "cost": 1, "condition": "资金 >= 2",
         "target": {"entityType": "选手", "condition": 'tag("主力") || tag("替补")'},
         "effects": [
             {"ref": "资金", "op": "add", "value": "-2"},
             {"ref": f"target.{util}", "op": "add", "value": f"target.{util} < target.潜力 ? randint(1, 3) : 0"},
             {"ref": "target.体能", "op": "add", "value": "-randint(1, 2)"},
         ],
         "text": "{target.name} 把细节一条条重新量了一遍。枯燥，但有用。"},
        {"id": "配合演练", "name": "配合演练", "cost": 1,
         "condition": '资金 >= 4 && count("选手", "主力") >= 5',
         "effects": [
             {"ref": "资金", "op": "add", "value": "-4"},
             {"ref": "版本理解", "op": "add", "value": "randint(2, 3) + (教练战术 >= 84 ? 1 : 0)"},
             {"ref": "羁绊", "op": "relate_group", "tag": "主力", "value": "1"},
         ],
         "text": "整队打了一下午默认配合。有几个点终于不用喊也知道谁去补了。"},
        {"id": "体能调理", "name": "体能调理", "cost": 1, "condition": "资金 >= 2",
         "target": {"entityType": "选手", "condition": 'tag("主力") || tag("替补")'},
         "effects": [
             {"ref": "资金", "op": "add", "value": "-2"},
             {"ref": "target.体能", "op": "add", "value": "randint(8, 14)"},
         ],
         "text": "理疗师按了四十分钟，{target.name} 说手不抖了。"},
        {"id": "谈心", "name": "找队员谈心", "cost": 1,
         "effects": [
             {"ref": "士气", "op": "add", "value": "randint(4, 9)"},
             {"ref": "董事会信任", "op": "add", "value": "1"},
         ],
         "text": "你把人一个个叫到办公室。有些话憋了很久，说出来就散了。"},
        {"id": "团建", "name": "团建", "cost": 1, "condition": "资金 >= 5",
         "effects": [
             {"ref": "资金", "op": "add", "value": "-5"},
             {"ref": "士气", "op": "add", "value": "randint(8, 14)"},
             {"ref": "羁绊", "op": "relate_group", "tag": "主力", "value": "2"},
         ],
         "text": "整队出去吃了一顿。没人聊比赛，这就是重点。"},
        {"id": "提拔首发", "name": "提拔进首发", "cost": 0,
         "target": {"entityType": "选手", "condition": 'tag("替补")'},
         "effects": [
             {"ref": "target", "op": "remove_tag", "tag": "替补"},
             {"ref": "target", "op": "add_tag", "tag": "主力"},
         ],
         "text": "{target.name} 拿到了首发位置。他自己都愣了两秒。"},
        {"id": "下放替补", "name": "放回替补席", "cost": 0,
         "condition": 'count("选手", "主力") >= 6',
         "target": {"entityType": "选手", "condition": 'tag("主力")'},
         "effects": [
             {"ref": "target", "op": "remove_tag", "tag": "主力"},
             {"ref": "target", "op": "add_tag", "tag": "替补"},
             {"ref": "士气", "op": "add", "value": "-2"},
         ],
         "text": "你跟 {target.name} 说了这周先歇一场。他点了点头，没说话。"},
        {"id": "发出报价", "name": "对市场球员发出报价", "cost": 1,
         "condition": "turn <= 5 && 谈判中 < 3",
         "target": {"entityType": "选手", "condition": 'tag("市场") && self.身价 <= 资金'},
         "effects": [
             {"ref": "转会报价", "op": "pend"},
             {"ref": "谈判中", "op": "add", "value": "1"},
         ],
         "text": "给 {target.name} 那边发了报价。接下来就是等。"},
        {"id": "挂牌卖出", "name": "挂牌卖出", "cost": 1,
         "condition": 'turn <= 5 && count("选手", "主力") + count("选手", "替补") >= 6',
         "target": {"entityType": "选手", "condition": '!tag("市场")'},
         "effects": [
             {"ref": "资金", "op": "add", "value": "round(target.身价 * 0.85)"},
             {"ref": "target", "op": "remove_tag", "tag": "主力"},
             {"ref": "target", "op": "remove_tag", "tag": "替补"},
             {"ref": "target", "op": "add_tag", "tag": "市场"},
             {"ref": "士气", "op": "add", "value": "-6"},
         ],
         "text": "{target.name} 收拾了外设。走的时候跟每个人都握了手。"},
        {"id": "联系教练", "name": "联系主教练人选", "cost": 1,
         "condition": "有主教练 == 0 && 资金 >= 12 && 谈判中 < 3",
         "target": {"entityType": "教练", "condition": 'tag("候选")'},
         "effects": [
             {"ref": "教练邀约", "op": "pend"},
             {"ref": "谈判中", "op": "add", "value": "1"},
         ],
         "text": "给 {target.name} 打了电话，约了见面。"},
        {"id": "商业活动", "name": "接商业活动", "cost": 1, "condition": "声望 >= 15",
         "effects": [
             {"ref": "资金", "op": "add", "value": "randint(6, 11) + 赞助等级 * 2"},
             {"ref": "士气", "op": "add", "value": "-4"},
         ],
         "text": "拍了一天广告。队员笑得很职业，回来路上一句话没说。"},
        {"id": "洽谈赞助", "name": "洽谈赞助", "cost": 1,
         "condition": "赞助等级 < 3 && 资金 >= 2 && 谈判中 < 3",
         "effects": [
             {"ref": "资金", "op": "add", "value": "-2"},
             {"ref": "赞助洽谈", "op": "pend"},
             {"ref": "谈判中", "op": "add", "value": "1"},
         ],
         "text": "见了品牌方。对方看了一眼战绩表，又看了一眼你。"},
        {"id": "公关发声", "name": "公关发声", "cost": 1, "condition": "资金 >= 3",
         "effects": [
             {"ref": "资金", "op": "add", "value": "-3"},
             {"ref": "声望", "op": "add", "value": "randint(3, 6)"},
         ],
         "text": "一条长文，几张训练室照片。评论区难得没吵起来。"},
    ]

    def match_settlement(sid, name, cycle, teams):
        return {
            "id": sid, "name": name, "condition": f"cycle == {cycle} && turn <= 12",
            "data": [{"名称": n, "强度": s} for n, s in teams[:10]],
            "compute": [
                {"id": "我方战力", "expr": "round(战力)"},
                {"id": "对手强度", "expr": "row.强度 + round(turn * 0.2)"},
                {"id": "临场发挥", "expr": "randint(-9, 9)"},
                {"id": "对手发挥", "expr": "randint(-9, 9)"},
                {"id": "净胜", "expr": "round(我方战力 + 临场发挥 - 对手强度 - 对手发挥)"},
            ],
            "outcomes": [
                {"id": "横扫", "condition": "净胜 >= 9", "leagueResult": "win",
                 "effects": [{"ref": "积分", "op": "add", "value": "3"},
                             {"ref": "声望", "op": "add", "value": "3"},
                             {"ref": "士气", "op": "add", "value": "5"},
                             {"ref": "羁绊", "op": "relate_group", "tag": "主力", "value": "1"},
                             {"ref": "董事会信任", "op": "add", "value": "3"}],
                 "text": "对 {row.名称} 2:0。第二" + F["match_word"] + "对面中期就不打了——{我方战力} 的战力摆在那儿，赢了 {净胜} 个身位。"},
                {"id": "险胜", "condition": "净胜 > 0", "leagueResult": "win",
                 "effects": [{"ref": "积分", "op": "add", "value": "3"},
                             {"ref": "声望", "op": "add", "value": "1"},
                             {"ref": "士气", "op": "add", "value": "2"},
                             {"ref": "董事会信任", "op": "add", "value": "1"}],
                 "text": "对 {row.名称} 2:1，决胜" + F["match_word"] + "才拿下。赢了 {净胜} 分，但谁都知道这一场悬。"},
                {"id": "惜败", "condition": "净胜 > -9", "leagueResult": "loss",
                 "effects": [{"ref": "士气", "op": "add", "value": "-3"},
                             {"ref": "董事会信任", "op": "add", "value": "-2"}],
                 "text": "对 {row.名称} 1:2。差了 {净胜} 分——不是不能打，是没打好。"},
                {"id": "溃败", "condition": "1", "leagueResult": "loss",
                 "effects": [{"ref": "士气", "op": "add", "value": "-7"},
                             {"ref": "声望", "op": "add", "value": "-2"},
                             {"ref": "羁绊", "op": "relate_group", "tag": "主力", "value": "-1"},
                             {"ref": "董事会信任", "op": "add", "value": "-4"}],
                 "text": "对 {row.名称} 0:2，净负 {净胜}。赛后采访没人愿意上台。"},
            ],
        }

    settlements = [
        match_settlement("赛季一", F["league_name"], 1, opponents),
        match_settlement("赛季二", "跨区赛段", 2, opponents[:5] + intl[:5]),
        match_settlement("赛季三", F["cup_name"], 3, intl),
        {"id": "工资单", "name": "周薪", "condition": "1",
         "compute": [
             {"id": "选手薪资", "expr": 'round((sum("选手", "身价", "主力") + sum("选手", "身价", "替补")) / 46)'},
             {"id": "教练薪资", "expr": "有主教练 == 1 ? 2 : 0"},
             {"id": "本周支出", "expr": "选手薪资 + 教练薪资"},
         ],
         "outcomes": [{"id": "出账", "condition": "1",
                       "effects": [{"ref": "资金", "op": "add", "value": "-本周支出"}],
                       "text": "本周工资单：选手 {选手薪资}，教练组 {教练薪资}，合计 {本周支出}。"}]},
        {"id": "赞助周结", "name": "赞助结算", "condition": "赞助等级 >= 1",
         "outcomes": [{"id": "到账", "condition": "1",
                       "effects": [{"ref": "资金", "op": "add", "value": "赞助等级 * 3"}],
                       "text": "赞助商这周的款到账了。"}]},
        {"id": "赛季总结", "name": "赛季总结", "condition": "turn == 13",
         "compute": [
             {"id": "名次", "expr": 'cycle == 1 ? rank("联赛") : cycle == 2 ? rank("跨区") : rank("世界赛")'},
             {"id": "目标线", "expr": "cycle == 1 ? 8 : cycle == 2 ? 7 : 6"},
             {"id": "达标", "expr": "名次 <= 目标线 ? 1 : 0"},
         ],
         "outcomes": [
             {"id": "达标收官", "condition": "达标 == 1",
              "effects": [{"ref": "资金", "op": "add", "value": "10"},
                          {"ref": "董事会信任", "op": "add", "value": "9"}],
              "text": "第 {cycle} 赛季常规赛第 {名次}，够到了俱乐部的线。"},
             {"id": "未达标", "condition": "1",
              "effects": [{"ref": "警告次数", "op": "add", "value": "1"},
                          {"ref": "董事会信任", "op": "add", "value": "-16"},
                          {"ref": "声望", "op": "add", "value": "-5"}],
              "text": "第 {cycle} 赛季常规赛第 {名次}，没够到目标。办公室那边发来一封措辞客气的邮件。"},
         ]},
    ]

    def league(lid, name, teams, settlement):
        return {"id": lid, "name": name, "playerTeam": MY, "settlement": settlement,
                "playoffs": 4,
                "teams": [{"name": MY, "strength": 78}] + [{"name": n, "strength": s} for n, s in teams[:10]]}

    leagues = [
        league("联赛", F["league_name"], opponents, "赛季一"),
        league("跨区", "跨区赛段", opponents[:5] + intl[:5], "赛季二"),
        league("世界赛", F["cup_name"], intl, "赛季三"),
    ]

    def bracket(bid, name, lid, cycle):
        return {
            "id": bid, "name": name, "league": lid, "size": 4,
            "condition": f"cycle == {cycle} && turn == 13",
            "compute": [
                {"id": "我方战力", "expr": "round(战力)"},
                {"id": "临场", "expr": "randint(-8, 8)"},
                {"id": "净胜", "expr": "round(我方战力 + 临场 - row.强度 - randint(-8, 8))"},
            ],
            "outcomes": [
                {"id": "晋级", "condition": "净胜 > 0", "leagueResult": "win",
                 "effects": [{"ref": "声望", "op": "add", "value": "5"},
                             {"ref": "士气", "op": "add", "value": "4"}],
                 "text": "季后赛第 {round} 轮：{row.名称} 2:1 被拿下，净胜 {净胜}。"},
                {"id": "止步", "condition": "1", "leagueResult": "loss",
                 "effects": [{"ref": "士气", "op": "add", "value": "-4"}],
                 "text": "季后赛第 {round} 轮：不敌 {row.名称}，净负 {净胜}。"},
            ],
            "championEffects": [
                {"ref": "冠军数", "op": "add", "value": "1"},
                {"ref": "声望", "op": "add", "value": "20"},
                {"ref": "资金", "op": "add", "value": "34"},
                {"ref": "董事会信任", "op": "add", "value": "26"},
                {"ref": "羁绊", "op": "relate_group", "tag": "主力", "value": "3"},
            ],
            "championText": "奖杯举起来那一刻，全队都在哭。摄像机对着的那个人，是你签下的第一个青训。",
            "eliminatedText": "季后赛第 {round} 轮止步。更衣室很安静，没人先开口。",
        }

    brackets = [
        bracket("季后赛一", f"{F['league_name']} 季后赛", "联赛", 1),
        bracket("季后赛二", "跨区季后赛", "跨区", 2),
        bracket("季后赛三", f"{F['cup_name']} 淘汰赛", "世界赛", 3),
    ]

    curves = [
        {"id": "每周消耗", "name": "训练与比赛的消耗", "entityType": "选手", "phase": "turn",
         "condition": 'tag("主力")',
         "effects": [{"ref": "self.体能", "op": "add", "value": "-randint(1, 3)"}]},
        {"id": "替补恢复", "name": "替补席的休整", "entityType": "选手", "phase": "turn",
         "condition": 'tag("替补")',
         "effects": [{"ref": "self.体能", "op": "add", "value": "randint(3, 5)"}]},
        {"id": "赛季年龄", "name": "又长一岁", "entityType": "选手", "phase": "cycle",
         "effects": [{"ref": "self.年龄", "op": "add", "value": "1"}]},
        {"id": "新星成长", "name": "年轻人自己会长", "entityType": "选手", "phase": "cycle",
         "condition": f"self.年龄 <= 21 && self.{core} < self.潜力",
         "effects": [{"ref": f"self.{core}", "op": "add", "value": "randint(1, 3) + (教练带新 >= 85 ? 1 : 0)"},
                     {"ref": f"self.{second}", "op": "add", "value": "randint(1, 2)"}]},
        {"id": "老将衰退", "name": "手会慢下来", "entityType": "选手", "phase": "cycle",
         "condition": "self.年龄 >= 26",
         "effects": [{"ref": f"self.{core}", "op": "add", "value": "-randint(1, 3)"},
                     {"ref": "self.体能", "op": "add", "value": "-randint(3, 6)"}]},
        {"id": "休赛期恢复", "name": "休赛期", "entityType": "选手", "phase": "cycle",
         "condition": '!tag("市场")',
         "effects": [{"ref": "self.体能", "op": "add", "value": "randint(10, 18)"}]},
    ]

    return {
        "schemaVersion": 1,
        "meta": {
            "title": F["title"], "genre": F["genre"], "author": "官方示例",
            "description": F["description"], "intro": F["intro"],
        },
        "theme": {"preset": "dark"},
        "driver": {
            "kind": "sim",
            "time": {"turnLabel": "周", "cycleLabel": "赛季", "turnsPerCycle": 13, "maxCycles": 3},
            "actionPoints": 3,
        },
        "vars": vars_,
        "derived": derived,
        "relations": relations,
        "pendings": pendings,
        "entityTypes": [
            {"id": "选手", "name": "选手",
             "attributes": [{"id": a, "name": a} for a in A] + [
                 {"id": "体能", "name": "体能"}, {"id": "年龄", "name": "年龄"},
                 {"id": "潜力", "name": "潜力", "visible": False}, {"id": "身价", "name": "身价"},
             ],
             "groups": [
                 {"tag": "主力", "label": "首发五人"},
                 {"tag": "替补", "label": "替补席"},
                 {"tag": "市场", "label": "转会市场（还不是你的人）"},
             ]},
            {"id": "教练", "name": "教练组",
             "attributes": [{"id": "训练", "name": "训练"}, {"id": "战术", "name": "战术"},
                            {"id": "带新", "name": "带新"}, {"id": "薪资", "name": "周薪"}],
             "groups": [{"tag": "在任", "label": "在任主教练"}, {"tag": "候选", "label": "可以谈的人"}]},
        ],
        "entities": entities,
        "actions": actions,
        "settlements": settlements,
        "leagues": leagues,
        "brackets": brackets,
        "curves": curves,
        "cards": CARDS(F),
        "endings": ENDINGS(F),
        "text": {
            "turnHeader": "第 {cycle} 赛季 · 第 {turn} 周　战力 {round(战力)}　资金 {round(资金)}　士气 {round(士气)}　默契 {round(默契)}　信任 {round(董事会信任)}",
            "timeoutEnding": {
                "title": "合同到期",
                "text": "三个赛季走完，{冠军数} 座奖杯。你把工牌放在前台，没人特别说什么。\n这一行就是这样：记分牌会清零，带过的人不会忘。",
            },
        },
    }


def V(ref, op, value=None, tag=None):
    e = {"ref": ref, "op": op}
    if value is not None:
        e["value"] = value
    if tag is not None:
        e["tag"] = tag
    return e


def CARDS(F):
    W = F["match_word"]
    P = F["patch_word"]
    return [
        {"id": "伤病", "title": "训练室里那一声", "weight": 2, "condition": "turn >= 2",
         "text": "队医把片子举到灯下。手腕，不是急性的，是攒出来的——这种伤没有痊愈那一天，只有管得住和管不住。",
         "textVariants": [
             "肩颈。片子上看不出什么，但他抬手的角度已经不对了。",
             "腱鞘。理疗师说最好停两周，说完自己也知道这不现实。",
             "眼睛。连着三周高强度，视野边缘开始发虚，他自己不肯说。",
         ],
         "choices": [
             {"id": "硬撑", "label": "让他继续打", "effects": [V("士气", "add", "-6"), V("董事会信任", "add", "-2")],
              "text": "他咬着牙说没事。接下来两周他的数据肉眼可见地掉。"},
             {"id": "休整", "label": "按下来，让他休两周", "effects": [V("资金", "add", "-4"), V("士气", "add", "3"), V("羁绊", "relate_group", "1", "主力")],
              "text": "替补顶上去了。名次可能要付代价，但人保住了——队里都看着呢。"},
         ]},
        {"id": "媒体日", "title": "赛前媒体日", "weight": 2,
         "text": "记者问了一个不太友善的问题：升上来的队伍，凭什么？",
         "textVariants": [
             "混采区被围住了。有人把话筒直接怼到你面前：「今天这场，你觉得配得上吗？」",
             "一家门户的记者念了一串数据，然后抬头：「所以，凭什么是你们？」",
             "发布会第三个问题就带刺：「你们的赛程含金量呢？」",
         ],
         "choices": [
             {"id": "硬刚", "label": "「打完再说」", "effects": [V("声望", "add", "4"), V("士气", "add", "3"), V("董事会信任", "add", "-2")],
              "text": "话说得挺硬。队员在后台笑出了声，办公室那边没笑。"},
             {"id": "谦虚", "label": "「我们还在学」", "effects": [V("声望", "add", "1"), V("董事会信任", "add", "3")],
              "text": "标准答案。安全，也没人记住。"},
         ]},
        {"id": "俱乐部问询", "title": "办公室的电话", "weight": 2, "condition": "董事会信任 <= 45",
         "text": "「我们看了这几周的数据。你打算怎么解释？」",
         "choices": [
             {"id": "要资源", "label": "摊牌：要钱要人", "effects": [V("资金", "add", "12"), V("董事会信任", "add", "-6")],
              "text": "钱批下来了，但这笔账他们记着。"},
             {"id": "认账", "label": "认下来，给一个时间表", "effects": [V("董事会信任", "add", "6"), V("士气", "add", "-3")],
              "text": "你替全队扛了。回到基地，没人问你聊了什么。"},
         ]},
        {"id": "挖角", "title": "有人来挖人", "weight": 2, "condition": "turn >= 3",
         "text": "另一家俱乐部开了一个你出不起的价，问 {round(声望)} 声望的你要不要放人。",
         "textVariants": [
             "中介发来一条消息，只有一个数字和一个问号。",
             "对方领队约你吃饭，坐下来第一句话就是「我们直说吧」。",
             "转会窗还没开，报价单已经躺在你邮箱里了。",
         ],
         "choices": [
             {"id": "卖了", "label": "放人，拿钱", "effects": [V("资金", "add", "22"), V("士气", "add", "-9"), V("羁绊", "relate_group", "-2", "主力"), V("声望", "add", "-3")],
              "text": "钱到账了。更衣室安静了一个星期。"},
             {"id": "留人", "label": "一口回绝", "effects": [V("士气", "add", "7"), V("资金", "add", "-6"), V("羁绊", "relate_group", "2", "主力")],
              "text": "你把加薪的钱自己补上了。他知道之后什么都没说，训练来得更早了。"},
         ]},
        {"id": "版本更新", "title": f"{P}更新公告", "weight": 2,
         "text": f"官方改了两个英雄的数值，整个联赛的战术板要重画。",
         "textVariants": [
             "补丁说明有十七条，其中两条足够让半个联赛重画战术板。",
             "新版本上线，一个原本没人选的英雄突然变成必 ban。",
             "官方悄悄改了一处地形。听着很小，但节奏全变了。",
         ],
         "choices": [
             {"id": "抢跑", "label": "全队通宵研究新版本", "effects": [V("版本理解", "add", "4"), V("士气", "add", "-5")],
              "text": "两天两夜。别人还在试，你们已经在练配合了。"},
             {"id": "稳住", "label": "先看别人怎么打", "effects": [V("版本理解", "add", "1"), V("士气", "add", "2")],
              "text": "不冒进。第三周你们才动手，但没走弯路。"},
         ]},
        {"id": "粉丝应援", "title": "看台上的横幅", "weight": 1, "condition": "声望 >= 40",
         "text": "客场看台上出现了一整片你们的队色。有人自费打了应援横幅。",
         "choices": [
             {"id": "回应", "label": "赛后全队去看台致谢", "effects": [V("声望", "add", "5"), V("士气", "add", "5")],
              "text": "十五分钟，谁都没提比分。"},
             {"id": "低调", "label": "先回去复盘", "effects": [V("版本理解", "add", "1"), V("声望", "add", "-1")],
              "text": "专业，但有人在社交平台上有点失望。"},
         ]},
        {"id": "直播邀约", "title": "平台找上门", "weight": 2, "condition": "声望 >= 25",
         "text": "直播平台想签队员的个人时段，价钱不低。",
         "textVariants": [
             "另一家平台把价码抬高了两成，条件是每周三场。",
             "平台方直接找到了队员本人，然后才想起来知会俱乐部一声。",
             "合约条款里塞了一句「优先直播时段」，教练组一眼就看出问题。",
         ],
         "choices": [
             {"id": "签", "label": "签下来", "effects": [V("资金", "add", "16"), V("士气", "add", "-4")],
              "text": "钱是好钱。训练时长少了，教练组皱着眉没说话。"},
             {"id": "推掉", "label": "赛季中不接", "effects": [V("士气", "add", "3"), V("董事会信任", "add", "-2")],
              "text": "队员理解，财务不理解。"},
         ]},
        {"id": "舆论风波", "title": "一条旧录像被翻出来", "weight": 1, "condition": "turn >= 4",
         "text": "两年前的一段语音被人剪出来传得到处都是。",
         "choices": [
             {"id": "道歉", "label": "第一时间道歉", "effects": [V("声望", "add", "-4"), V("董事会信任", "add", "4"), V("士气", "add", "-2")],
              "text": "处理得算快。热度三天就过去了。"},
             {"id": "硬扛", "label": "不回应", "effects": [V("声望", "add", "-9"), V("士气", "add", "4"), V("羁绊", "relate_group", "1", "主力")],
              "text": "队里觉得你护着人。外面骂了整整两周。"},
         ]},
        {"id": "青训试训", "title": "青训营送上来一个人", "weight": 1, "condition": "turn <= 6",
         "text": "十七岁，数据很糙，但有一项特别扎眼。",
         "choices": [
             {"id": "给机会", "label": "留下来跟队训练", "effects": [V("资金", "add", "-5"), V("士气", "add", "2"), V("声望", "add", "2")],
              "text": "他坐在训练室最后一排，一句话不说，练到最后一个走。"},
             {"id": "再看看", "label": "让他明年再来", "effects": [V("资金", "add", "2")],
              "text": "省了一笔。也可能省掉了一个未来。"},
         ]},
        {"id": "更衣室低气压", "title": "更衣室的低气压", "weight": 2, "condition": "士气 <= 45",
         "text": "连输之后，两个人在训练里当众吵了起来。",
         "choices": [
             {"id": "开会", "label": "全队开会摊开说", "effects": [V("士气", "add", "10"), V("羁绊", "relate_group", "2", "主力"), V("版本理解", "add", "-1")],
              "text": "会开到半夜。战术没进展，人心捋顺了。"},
             {"id": "分开练", "label": "拆开分组训练", "effects": [V("版本理解", "add", "2"), V("羁绊", "relate_group", "-2", "主力")],
              "text": "效率上去了。裂缝还在那儿。"},
         ]},
        {"id": "老将谈话", "title": "老将来找你", "weight": 1, "condition": 'count("选手", "主力") >= 5 && turn >= 5',
         "text": "他把手机放在桌上，屏幕朝下：「我还能打几年？你说实话。」",
         "choices": [
             {"id": "实话", "label": "说实话", "effects": [V("士气", "add", "-4"), V("版本理解", "add", "3")],
              "text": "他沉默了很久，然后开始每天多留两个小时。"},
             {"id": "鼓励", "label": "说你还行", "effects": [V("士气", "add", "6"), V("董事会信任", "add", "-2")],
              "text": "他笑了。但你们都知道那不是答案。"},
         ]},
        {"id": "基地断网", "title": "基地断网了", "weight": 1,
         "text": "凌晨两点，训练赛打到一半，整栋楼断了网。",
         "choices": [
             {"id": "修", "label": "自己掏钱连夜修", "effects": [V("资金", "add", "-4"), V("士气", "add", "3"), V("羁绊", "relate_group", "1", "主力")],
              "text": "四点通的网。队员说这事他们记住了。"},
             {"id": "放假", "label": "干脆放一天假", "effects": [V("士气", "add", "5"), V("版本理解", "add", "-1")],
              "text": "难得的休息。教练组的进度表往后挪了一格。"},
         ]},
        {"id": "战术泄露", "title": "战术板泄露", "weight": 1, "condition": "turn >= 5",
         "text": "训练赛的对手在公开赛上打出了你们没用过的套路。",
         "choices": [
             {"id": "换套路", "label": "整套推倒重来", "effects": [V("版本理解", "add", "-2"), V("士气", "add", "-2"), V("董事会信任", "add", "2")],
              "text": "两周白练。但没人能再靠情报吃你们。"},
             {"id": "将计就计", "label": "留着当诱饵", "effects": [V("版本理解", "add", "3"), V("声望", "add", "-1")],
              "text": "赌一把。下一场对面果然按老剧本准备了。"},
         ]},
        {"id": "综艺邀约", "title": "综艺节目找上门", "weight": 1, "condition": "声望 >= 45",
         "text": "一档热门综艺想请队里最出名的那个去录一期。",
         "choices": [
             {"id": "去", "label": "让他去", "effects": [V("声望", "add", "9"), V("资金", "add", "8"), V("士气", "add", "-5")],
              "text": "节目播出那天，俱乐部的关注度翻了一倍。训练室少了个人。"},
             {"id": "不去", "label": "婉拒", "effects": [V("士气", "add", "3"), V("声望", "add", "-2")],
              "text": "他自己也松了口气。"},
         ]},
        {"id": "状态火热", "title": "有人打疯了", "weight": 2, "condition": "士气 >= 70",
         "text": "训练赛数据高得不像话——这种状态留不住，但可以用。",
         "choices": [
             {"id": "加练", "label": "趁热加练", "effects": [V("版本理解", "add", "2"), V("士气", "add", "-3")],
              "text": "把状态压进肌肉记忆里。累，但值。"},
             {"id": "保护", "label": "让他歇一场保住状态", "effects": [V("士气", "add", "4"), V("董事会信任", "add", "-1")],
              "text": "教练组说这叫职业管理。解说说这叫保守。"},
         ]},
        {"id": "训练赛约战", "title": "训练赛约战", "weight": 2,
         "text": "隔壁赛区一支强队发来训练赛邀请，时间在你们的休息日。",
         "choices": [
             {"id": "打", "label": "接下来", "effects": [V("版本理解", "add", "3"), V("士气", "add", "-4")],
              "text": "被打了个 4:14。回来的路上没人说话，但笔记记了满满两页。"},
             {"id": "推", "label": "推到下周", "effects": [V("士气", "add", "3")],
              "text": "休息日还给了队员。教练组的日程表往后挪了一格。"},
         ]},
        {"id": "解说点名", "title": "解说在直播里点了名", "weight": 2, "condition": "turn >= 3",
         "text": "「这支队的细节是全联赛最糙的」——这话上了热搜。",
         "choices": [
             {"id": "练", "label": "把这句话贴在训练室", "effects": [V("版本理解", "add", "2"), V("士气", "add", "-2")],
              "text": "那张纸在墙上贴了整个赛季。"},
             {"id": "回怼", "label": "在官号回一句", "effects": [V("声望", "add", "5"), V("董事会信任", "add", "-3")],
              "text": "转发过万。办公室打电话来问是谁批的。"},
         ]},
        {"id": "直播翻车", "title": "选手直播翻车", "weight": 1, "condition": "turn >= 3",
         "text": "有人在个人直播里说了句不该说的，切片已经在飞了。",
         "choices": [
             {"id": "罚", "label": "内部处罚并公开说明", "effects": [V("声望", "add", "-2"), V("董事会信任", "add", "4"), V("士气", "add", "-4")],
              "text": "处理得干净。当事人一周没怎么说话。"},
             {"id": "护", "label": "对外一个字不提", "effects": [V("声望", "add", "-6"), V("士气", "add", "5"), V("羁绊", "relate_group", "1", "主力")],
              "text": "队里觉得你够意思。外面骂了很久。"},
         ]},
        {"id": "装备赞助", "title": "外设厂商送来一批新装备", "weight": 1,
         "text": "试用装到了，但换手感要时间。",
         "choices": [
             {"id": "换", "label": "全队换上", "effects": [V("资金", "add", "6"), V("士气", "add", "-3")],
              "text": "厂商很满意。队员手感找了两周。"},
             {"id": "不换", "label": "只收钱不换装备", "effects": [V("资金", "add", "2"), V("声望", "add", "-1")],
              "text": "对方脸色不太好看，合作照旧。"},
         ]},
        {"id": "主场首秀", "title": "第一次主场作战", "weight": 1, "condition": "声望 >= 35",
         "text": "俱乐部租下了本地场馆，票在两小时内卖光。",
         "choices": [
             {"id": "造势", "label": "加办粉丝见面会", "effects": [V("资金", "add", "9"), V("声望", "add", "6"), V("士气", "add", "-3")],
              "text": "场馆外排了两百米的队。队员签到手酸。"},
             {"id": "专注", "label": "只打比赛", "effects": [V("士气", "add", "4"), V("版本理解", "add", "1")],
              "text": "赛前两小时，训练室的灯还亮着。"},
         ]},
        {"id": "数据分析师", "title": "有人毛遂自荐", "weight": 1, "condition": "资金 >= 8",
         "text": "一个做数据的年轻人发来一份对手分析报告，写得比你们自己的还细。",
         "choices": [
             {"id": "招", "label": "招进来", "effects": [V("资金", "add", "-8"), V("版本理解", "add", "4")],
              "text": "第一份正式报告交上来那天，教练组沉默了很久。"},
             {"id": "不招", "label": "留个联系方式", "effects": [V("版本理解", "add", "1")],
              "text": "报告白拿了一份。人没留住。"},
         ]},
        {"id": "位置之争", "title": "队内位置之争", "weight": 1, "condition": 'count("选手", "替补") >= 1 && turn >= 4',
         "text": "替补席上那个年轻人在训练赛里连着三天打爆了首发。",
         "choices": [
             {"id": "给位置", "label": "让他上", "effects": [V("士气", "add", "-3"), V("羁绊", "relate_group", "-1", "主力"), V("版本理解", "add", "2")],
              "text": "首发那个当天就走了训练室。但队伍的上限确实抬了。"},
             {"id": "压一压", "label": "先按住", "effects": [V("士气", "add", "2"), V("董事会信任", "add", "-1")],
              "text": "稳。年轻人的眼神暗了一点。"},
         ]},
        {"id": "家里出事", "title": "有人家里出事了", "weight": 1, "condition": "turn >= 5",
         "text": "他请了三天假，回来之后训练数据一塌糊涂。",
         "choices": [
             {"id": "放", "label": "让他回去多待几天", "effects": [V("士气", "add", "7"), V("羁绊", "relate_group", "2", "主力"), V("版本理解", "add", "-2")],
              "text": "他回来那天带了一箱家乡的东西，分给了每个人。"},
             {"id": "催", "label": "赛程紧，先归队", "effects": [V("版本理解", "add", "1"), V("士气", "add", "-8"), V("羁绊", "relate_group", "-2", "主力")],
              "text": "他归队了。人在训练室，心不在。"},
         ]},
        {"id": "旧队友对位", "title": "赛程撞上旧队友", "weight": 1, "condition": "turn >= 6",
         "text": "下一场对手的首发里，有一个是从你们这儿走的。",
         "choices": [
             {"id": "针对", "label": "赛前专门针对他布置", "effects": [V("版本理解", "add", "2"), V("士气", "add", "-2")],
              "text": "战术板上他的名字被圈了三次。"},
             {"id": "平常心", "label": "当成普通一场", "effects": [V("士气", "add", "4")],
              "text": "赛后两人在通道里聊了几句，谁都没提比分。"},
         ]},
        {"id": "默契危机", "title": "有两个人不说话了", "weight": 2, "condition": 'worst_bond("羁绊", "主力") <= -4',
         "text": "训练赛里那一波明显是配合失误，但两个人谁都没开麦复盘。",
         "choices": [
             {"id": "撮合", "label": "把两个人关一间屋子", "effects": [V("羁绊", "relate_group", "3", "主力"), V("士气", "add", "-2")],
              "text": "关了两个小时。出来的时候还是没怎么说话，但下一场配合对上了。"},
             {"id": "隔开", "label": "分开排训练", "effects": [V("版本理解", "add", "2"), V("羁绊", "relate_group", "-1", "主力")],
              "text": "眼不见为净。问题没解决，只是被推后了。"},
         ]},
    ]


def ENDINGS(F):
    G = "cycle == 3 && turn >= 13"
    return [
        {"id": "下课", "title": "解约通知", "kind": "defeat", "condition": "警告次数 >= 2",
         "text": "第二封邮件比第一封短得多，只有三行。\n"
                 "你把办公室的东西装进一个纸箱，比来的时候还少。走廊上遇到队长，他说了句「不怪你」。\n"
                 "冠军数 {冠军数}，声望 {round(声望)}。这一行就是这样。"},
        {"id": "破产", "title": "俱乐部退出", "kind": "defeat", "condition": "资金 <= -25",
         "text": "赞助商撤了，工资拖了两个月。公告写得很体面：「因战略调整，暂别赛场」。\n"
                 "资金 {round(资金)}。你签下的那些人，得自己找下家了。"},
        {"id": "王朝", "title": "一个时代", "kind": "victory",
         "condition": G + " && (冠军数 >= 2)",
         "text": "三个赛季，{冠军数} 座奖杯。\n"
                 "最后一场决赛日，解说说了一句「这已经不是升班马了」。\n"
                 "{round(声望)} 点声望里，有一半是别人替你喊出来的。休赛期有人来挖角，名单一个没动。"},
        {"id": "一冠在手", "title": "那一年，我们拿到了", "kind": "victory",
         "condition": G + " && (冠军数 == 1 && 声望 >= 45)",
         "text": "只有一座奖杯，但那一座谁也拿不走。\n"
                 "休赛期三家俱乐部来挖人，队员一个没走——他们说想再来一次。\n"
                 "声望 {round(声望)}，默契 {round(默契)}。下赛季的名单，你已经在纸上画了。"},
        {"id": "最好的更衣室", "title": "成绩之外的东西", "kind": "neutral",
         "condition": G + " && (默契 >= 14)",
         "text": "没拿到冠军，但这支队最后一场打完是笑着下台的。\n"
                 "默契 {round(默契)}——数字不上榜单，却是每一个待过这里的人都提起的那件事。\n"
                 "三年里走的人不到两个，这在这一行不常见。"},
        {"id": "常客", "title": "年年进季后赛，年年差一口气", "kind": "neutral",
         "condition": G + " && (冠军数 == 0 && 声望 >= 48)",
         "text": "三个赛季没缺席过季后赛，也没走到最后。\n"
                 "媒体给了个不算难听的词：稳。队里最年轻的那个在采访里说，明年他想听点别的。\n"
                 "声望 {round(声望)}——足够体面，不足以传说。"},
        {"id": "人心散了", "title": "最后一个走的是队长", "kind": "defeat",
         "condition": G + " && (士气 <= 32)",
         "text": "最后一次团建没人到齐。队长把队服叠好放在桌上，说了句「不是你的问题」，然后走了。\n"
                 "士气 {round(士气)}，默契 {round(默契)}。有些东西比战绩先垮。"},
        {"id": "重建有望", "title": "账面难看，人还在", "kind": "neutral",
         "condition": G + " && (董事会信任 >= 40)",
         "text": "成绩单不好看，资金 {round(资金)}，声望 {round(声望)}。\n"
                 "但训练室的灯还是每天亮到很晚——你没有卖掉任何一个愿意留下的人。\n"
                 "重建这件事，第一年从来都是这样。"},
    ]


if __name__ == "__main__":
    for F in (VCT, KPL):
        cfg = build(F)
        path = f"{OUT_DIR}/{F['file']}"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        print(F["file"], "entities", len(cfg["entities"]), "actions", len(cfg["actions"]),
              "settlements", len(cfg["settlements"]), "brackets", len(cfg["brackets"]),
              "pendings", len(cfg["pendings"]), "relations", len(cfg["relations"]),
              "cards", len(cfg["cards"]), "endings", len(cfg["endings"]))
