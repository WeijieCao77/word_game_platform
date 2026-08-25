import { describe, expect, it } from "vitest";
import { GameConfig, validateGameConfig } from "@/lib/schema";
import { initState, pendingInput, submitInput, pendingChoices, choose } from "@/lib/engine";
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
