import { describe, it, expect } from "vitest";
import { validateGameConfig } from "@/lib/schema";
import { initState, searchKeyword, choose, pendingChoices } from "@/lib/engine";

// 两个平台窟窿的回归测试，都是整改《他不是自己掉下去的》时撞出来的：
// ① story 调度器下输入门答案漏写 goto，玩家答对了反而被兜底结局结束游戏
// ② 没有 searched()，内容没法真正门槛在「玩家用过检索台」上

const withSearch = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1 as const,
  meta: { title: "查档" },
  driver: { kind: "story" as const, startCard: "开场" },
  vars: [{ id: "铁证", name: "铁证", initial: 0 }],
  search: {
    label: "查档",
    entries: [{ id: "档_当票", keywords: ["当票", "典当行"], text: "收当登记簿上有他的名字。", effects: [{ ref: "铁证", op: "add" as const, value: "1" }] }],
  },
  cards: [
    {
      id: "开场",
      text: "一张当票的存根。",
      choices: [
        { id: "指认", label: "拿这份登记簿去指认", condition: 'searched("档_当票")', ending: "成" },
        { id: "收手", label: "算了", ending: "败" },
      ],
    },
  ],
  endings: [
    { id: "成", title: "成", kind: "victory" as const },
    { id: "败", title: "败", kind: "defeat" as const },
  ],
  ...extra,
});

describe('searched()：把内容门槛在「玩家自己查过」上', () => {
  it("校验通过，且没查过时那个选项不出现、查过之后出现", () => {
    const r = validateGameConfig(withSearch());
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);

    const config = r.config!;
    let state = initState(config, 7);
    expect(pendingChoices(config, state).map((c) => c.id)).toEqual(["收手"]);

    state = searchKeyword(config, state, "当票");
    expect(pendingChoices(config, state).map((c) => c.id)).toContain("指认");

    state = choose(config, state, "指认");
    expect(state.ended?.endingId).toBe("成");
  });

  it("引用不存在的词条 → 报错", () => {
    const cfg = withSearch();
    cfg.cards[0].choices[0].condition = 'searched("档_不存在")';
    const errs = validateGameConfig(cfg).issues.filter((i) => i.severity === "error");
    expect(errs.some((e) => e.message.includes("不存在的检索词条"))).toBe(true);
  });

  it("压根没配检索台却用了 searched() → 报错", () => {
    const cfg = withSearch();
    delete (cfg as { search?: unknown }).search;
    const errs = validateGameConfig(cfg).issues.filter((i) => i.severity === "error");
    expect(errs.some((e) => e.message.includes("需要先配置全局检索台"))).toBe(true);
  });

  it("结局条件只用 searched() 时不会被误判成「死条件」", () => {
    const cfg = withSearch();
    cfg.endings = [
      { id: "成", title: "成", kind: "victory" as const, condition: 'searched("档_当票")' },
      { id: "败", title: "败", kind: "defeat" as const },
    ] as never;
    const warns = validateGameConfig(cfg).issues.filter((i) => i.severity === "warning");
    expect(warns.some((w) => w.message.includes("从未被任何效果修改"))).toBe(false);
  });
});

describe("输入门答案必须有去向（story 调度器）", () => {
  const withGate = (answer: Record<string, unknown>) => ({
    schemaVersion: 1 as const,
    meta: { title: "输入门" },
    driver: { kind: "story" as const, startCard: "问" },
    vars: [],
    cards: [
      { id: "问", text: "他叫什么名字？", input: { prompt: "写下名字", answers: [{ id: "对", keywords: ["程小满"], text: "没错。", ...answer }] } },
      { id: "下一张", text: "于是你去了螺蛳巷。", ending: "完" },
    ],
    endings: [{ id: "完", title: "完", kind: "neutral" as const }],
  });

  it("既没 goto 也没 ending → 报错（玩家答对了反而掉进兜底结局）", () => {
    const errs = validateGameConfig(withGate({})).issues.filter((i) => i.severity === "error");
    expect(errs.some((e) => e.message.includes("既没有 goto 也没有 ending"))).toBe(true);
  });

  it("写了 goto 就没问题", () => {
    const r = validateGameConfig(withGate({ goto: "下一张" }));
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("写了 ending 也没问题", () => {
    const r = validateGameConfig(withGate({ ending: "完" }));
    expect(r.issues.filter((i) => i.severity === "error").map((e) => e.message)).toEqual([]);
  });
});
