import { describe, expect, it } from "vitest";
import { GameConfig, validateGameConfig } from "@/lib/schema";
import { initState, pendingInput, submitInput, pendingChoices, choose, searchKeyword, notebookItems } from "@/lib/engine";
import { normalizeKeyword } from "@/lib/keyword";
import { simulate } from "@/lib/simulate";

// 关键词输入门（MISSING 式调查玩法）：输对了才解锁，未命中停留原卡。

const CONFIG: GameConfig = {
  schemaVersion: 1,
  meta: { title: "档案检索测试" },
  driver: { kind: "story", startCard: "检索台" },
  vars: [{ id: "线索", name: "线索", initial: 0, visible: false }],
  cards: [
    {
      id: "检索台",
      text: "泛黄的档案检索机嗡嗡作响。屏幕上有一行小字：陈默，1998。",
      input: {
        prompt: "输入检索关键词",
        answers: [
          {
            id: "查人名",
            keywords: ["陈默", "chenmo"],
            effects: [{ ref: "线索", op: "add", value: "1" }],
            text: "档案弹出：陈默，失踪于 1998 年冬。",
            goto: "档案页",
          },
          { id: "查年份", condition: "线索 >= 1", keywords: ["1998"], goto: "深层档案" },
        ],
        fallbackText: "档案库里没有这个词条。",
      },
      choices: [{ id: "离开", label: "离开档案室", ending: "放弃" }],
    },
    { id: "档案页", text: "你把名字抄了下来。屏幕退回检索界面。", goto: "检索台" },
    { id: "深层档案", text: "加密卷宗展开了。", ending: "真相" },
  ],
  endings: [
    { id: "真相", title: "真相", kind: "victory" },
    { id: "放弃", title: "放弃", kind: "neutral" },
  ],
  text: { timeoutEnding: { title: "夜深了" } },
};

describe("关键词输入门", () => {
  it("归一化：全角/空白/大小写都能命中", () => {
    expect(normalizeKeyword("　陈 默 ")).toBe("陈默");
    expect(normalizeKeyword("ＣｈｅｎＭｏ")).toBe("chenmo");
  });

  it("配置通过校验（零错误零警告）", () => {
    const r = validateGameConfig(CONFIG);
    expect(r.issues).toEqual([]);
  });

  it("未命中停留原卡并给 fallback；命中走 goto；条件答案要线索到位才认", () => {
    let s = initState(CONFIG, 7);
    expect(pendingInput(CONFIG, s)?.prompt).toBe("输入检索关键词");

    // 条件答案未解锁：输 1998 视为未命中
    s = submitInput(CONFIG, s, "1998");
    expect(s.pendingCard).toBe("检索台");
    expect(s.log.some((l) => l.text.includes("没有这个词条"))).toBe(true);

    // 命中人名（全角空白混排）→ 线索+1 → 回到检索台
    s = submitInput(CONFIG, s, " 陈　默 ");
    expect(s.vars["线索"]).toBe(1);
    expect(s.pendingCard).toBe("检索台");

    // 现在 1998 解锁 → 真相结局
    s = submitInput(CONFIG, s, "１９９８");
    expect(s.ended?.endingId).toBe("真相");
  });

  it("输入门与选项并存：仍可点选项离开", () => {
    let s = initState(CONFIG, 7);
    expect(pendingChoices(CONFIG, s).map((c) => c.id)).toContain("离开");
    s = choose(CONFIG, s, "离开");
    expect(s.ended?.endingId).toBe("放弃");
  });

  it("模拟器能自主通关：两个结局都可达", () => {
    const report = simulate(CONFIG, 200, 99);
    expect(report.errors).toEqual([]);
    expect(report.endings["__unfinished__"]).toBeUndefined();
    expect(report.unreachedEndings).toEqual([]);
  });
});

describe("全局检索台（config.search）", () => {
  const SEARCH_CONFIG: GameConfig = {
    schemaVersion: 1,
    meta: { title: "检索台测试" },
    driver: { kind: "story", startCard: "开场" },
    vars: [
      { id: "线索A", name: "线索A", initial: 0, visible: false },
      { id: "线索B", name: "线索B", initial: 0, visible: false },
    ],
    search: {
      label: "查档案",
      entries: [
        { id: "查甲", keywords: ["赵四海"], text: "赵四海，十年前的船老大。", effects: [{ ref: "线索A", op: "set", value: "1" }] },
        { id: "查乙", condition: "线索A >= 1", keywords: ["望江楼"], text: "望江楼的账本残页。", effects: [{ ref: "线索B", op: "set", value: "1" }] },
      ],
      fallbackText: "档案库里没有这个词条。",
    },
    cards: [
      {
        id: "开场",
        text: "案卷摊在桌上。",
        choices: [
          { id: "结案", label: "就此结案", ending: "草草结案" },
          { id: "真相", label: "指出真相", condition: "线索B >= 1", ending: "真相大白" },
        ],
      },
    ],
    endings: [
      { id: "草草结案", title: "草草结案", kind: "neutral" },
      { id: "真相大白", title: "真相大白", kind: "victory" },
    ],
    text: { timeoutEnding: { title: "结案" } },
  };

  it("配置过校验；随时可查；条件词条按序解锁；效果只生效一次；解锁后条件选项出现", () => {
    const r = validateGameConfig(SEARCH_CONFIG);
    expect(r.issues).toEqual([]);
    let s = initState(SEARCH_CONFIG, 5);
    // 待选卡挂着也能查
    expect(s.pendingCard).toBe("开场");
    expect(pendingChoices(SEARCH_CONFIG, s).map((c) => c.id)).toEqual(["结案"]);
    // 没解锁前查望江楼无果
    s = searchKeyword(SEARCH_CONFIG, s, "望江楼");
    expect(s.vars["线索B"]).toBe(0);
    // 查人名 → 线索A → 解锁望江楼
    s = searchKeyword(SEARCH_CONFIG, s, "赵四海");
    expect(s.vars["线索A"]).toBe(1);
    s = searchKeyword(SEARCH_CONFIG, s, "望江楼");
    expect(s.vars["线索B"]).toBe(1);
    // 效果只生效一次（重复查不叠加）
    s = searchKeyword(SEARCH_CONFIG, s, "赵四海");
    expect(s.vars["线索A"]).toBe(1);
    expect(s.searched?.["查甲"]).toBe(2);
    // 解锁后条件选项出现
    expect(pendingChoices(SEARCH_CONFIG, s).map((c) => c.id)).toContain("真相");
    s = choose(SEARCH_CONFIG, s, "真相");
    expect(s.ended?.endingId).toBe("真相大白");
  });

  it("模拟器会自己检索：真相大白结局可达", () => {
    const report = simulate(SEARCH_CONFIG, 300, 11);
    expect(report.errors).toEqual([]);
    expect(report.unreachedEndings).toEqual([]);
  });
});

describe("档案夹（config.notebook）", () => {
  const NB_CONFIG: GameConfig = {
    schemaVersion: 1,
    meta: { title: "档案夹测试" },
    driver: { kind: "story", startCard: "开场" },
    vars: [{ id: "线索_怀表", name: "线索_怀表", initial: 0, visible: false }],
    notebook: {
      label: "手帐",
      items: [
        { id: "嫌疑人甲", name: "账房柳先生", category: "人物", text: "欠了赌债的账房。" },
        { id: "怀表", name: "停摆的怀表", category: "物证", condition: "线索_怀表 >= 1", text: "表冠有拨动痕迹。" },
      ],
    },
    cards: [
      {
        id: "开场",
        text: "你进了藏书楼。",
        choices: [
          { id: "查表", label: "检查怀表", effects: [{ ref: "线索_怀表", op: "set", value: "1" }], ending: "收工" },
          { id: "走", label: "离开", ending: "收工" },
        ],
      },
    ],
    endings: [{ id: "收工", title: "收工", kind: "neutral" }],
    text: { timeoutEnding: { title: "完" } },
  };

  it("零错误零警告；开局可翻人物档案；条件条目拿到线索才出现", () => {
    const r = validateGameConfig(NB_CONFIG);
    expect(r.issues).toEqual([]);
    let s = initState(NB_CONFIG, 3);
    let items = notebookItems(NB_CONFIG, s);
    expect(items.map((i) => i.id)).toEqual(["嫌疑人甲"]);
    s = choose(NB_CONFIG, s, "查表");
    items = notebookItems(NB_CONFIG, s);
    expect(items.map((i) => i.id).sort()).toEqual(["嫌疑人甲", "怀表"]);
    expect(items.find((i) => i.id === "怀表")!.category).toBe("物证");
  });

  it("条件里用随机函数会被校验器警告", () => {
    const bad = structuredClone(NB_CONFIG);
    bad.notebook!.items[0].condition = "chance(0.5)";
    const r = validateGameConfig(bad);
    expect(r.issues.some((i) => i.severity === "warning" && i.message.includes("随机函数"))).toBe(true);
  });
});

describe("检索不该做成选项", () => {
  const withSearch = (label: string) => ({
    schemaVersion: 1 as const,
    meta: { title: "查案" },
    driver: { kind: "story" as const, startCard: "开场" },
    vars: [{ id: "线索", name: "线索", initial: 0 }],
    cards: [
      {
        id: "开场",
        text: "巷口贴着旧改公告。",
        choices: [
          { id: "a", label, goto: "开场" },
          { id: "b", label: "去螺蛳巷 37 号看看", goto: "开场" },
        ],
      },
    ],
    endings: [{ id: "完", title: "完", kind: "neutral" as const, condition: "线索 >= 99" }],
    search: {
      label: "查档",
      entries: [{ id: "e1", keywords: ["程小满"], text: "档案薄得只有几行。" }],
    },
  });

  it("把「检索『程小满』」写成选项会收到警告", () => {
    const r = validateGameConfig(withSearch("检索「程小满」"));
    const hit = r.issues.filter((i) => i.severity === "warning" && i.message.includes("把检索做成了选项"));
    expect(hit).toHaveLength(1);
  });

  it("换成行动式选项就没有这个警告", () => {
    const r = validateGameConfig(withSearch("去报社资料室找小柯"));
    expect(r.issues.filter((i) => i.message.includes("把检索做成了选项"))).toHaveLength(0);
  });

  it("「搜索:xxx」「查档「xxx」」这类写法同样会被点出来", () => {
    for (const label of ["搜索：海国栋", "查档「螺蛳巷」", 'search "chengxiaoman"']) {
      const r = validateGameConfig(withSearch(label));
      expect(r.issues.some((i) => i.message.includes("把检索做成了选项"))).toBe(true);
    }
  });
});

describe("只加不用的变量：只对玩家看得见的报警", () => {
  const make = (visible: boolean | undefined) => ({
    schemaVersion: 1 as const,
    meta: { title: "计数器" },
    driver: { kind: "story" as const, startCard: "a" },
    vars: [
      { id: "计数", name: "计数", initial: 0, ...(visible === undefined ? {} : { visible }) },
      { id: "真门槛", name: "真门槛", initial: 0 },
    ],
    cards: [
      {
        id: "a",
        text: "……",
        choices: Array.from({ length: 12 }, (_, i) => ({
          id: `c${i}`,
          label: `选项 ${i}`,
          effects: [{ ref: "计数", op: "add" as const, value: "1" }, { ref: "真门槛", op: "add" as const, value: String(i) }],
          goto: "a",
        })),
      },
    ],
    endings: [{ id: "完", title: "完", kind: "neutral" as const, condition: "真门槛 >= 10" }],
  });

  it("可见变量只加不用 → 警告（玩家被状态栏误导）", () => {
    const r = validateGameConfig(make(undefined));
    expect(r.issues.some((i) => i.message.includes("盯着状态栏上这个数字"))).toBe(true);
  });

  it("设了 visible: false 就不再打扰", () => {
    const r = validateGameConfig(make(false));
    expect(r.issues.some((i) => i.message.includes("盯着状态栏上这个数字"))).toBe(false);
  });
});
