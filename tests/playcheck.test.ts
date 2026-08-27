import { describe, it, expect } from "vitest";
import { parsePlayCheck, summarizePlayCheck, describePlayCheck } from "@/lib/playcheck/report";
import { playCheckHasIssue } from "@/lib/playcheck/types";

// 试玩体检的服务端这一半。真正去点的那段跑在浏览器里（sweep.ts），
// 这里量的是「收得干不干净、说得清不清楚」——尤其是那句
// 「这类问题不抛异常」必须出现，它就是这个功能存在的理由。

const good = {
  bootText: 800,
  steps: [{ label: "开始", filled: [] }],
  stuck: null,
  nav: [
    { label: "阵容", changed: true, textLen: 900, clickable: 12 },
    { label: "赛程", changed: true, textLen: 600, clickable: 8 },
  ],
  notes: [],
  ms: 3000,
};

describe("试玩体检 · 收报告", () => {
  it("外面发什么进来都得洗干净", () => {
    const r = parsePlayCheck({
      bootText: "不是数字",
      steps: new Array(50).fill({ label: "x".repeat(200), filled: ["a"] }),
      stuck: { step: -3, tried: new Array(99).fill("y".repeat(99)), screen: "z".repeat(9999), why: "乱写" },
      nav: new Array(99).fill({ label: "n", changed: "真的", textLen: -5, clickable: 1e12 }),
      notes: new Array(50).fill("n".repeat(500)),
      ms: Number.NaN,
    });
    expect(r.bootText).toBe(0);
    expect(r.steps.length).toBeLessThanOrEqual(12);
    expect(r.steps[0].label.length).toBeLessThanOrEqual(24);
    expect(r.stuck?.step).toBe(0);
    expect(r.stuck?.tried.length).toBeLessThanOrEqual(12);
    expect(r.stuck?.screen.length).toBeLessThanOrEqual(300);
    // why 只认两个值，别的一律当死路
    expect(r.stuck?.why).toBe("dead-end");
    expect(r.nav.length).toBeLessThanOrEqual(20);
    // changed 只认布尔真，字符串「真的」不算
    expect(r.nav[0].changed).toBe(false);
    expect(r.notes.length).toBeLessThanOrEqual(6);
    expect(r.ms).toBe(0);
  });

  it("时间戳由服务端盖章，客户端说了不算", () => {
    const r = parsePlayCheck({ ...good, at: "1999-01-01T00:00:00.000Z" });
    expect(r.at.slice(0, 2)).toBe("20");
    expect(r.at).not.toContain("1999");
  });

  it("空对象也得能收下，不能抛", () => {
    const r = parsePlayCheck(undefined);
    expect(r.bootText).toBe(0);
    expect(r.nav).toEqual([]);
  });
});

describe("试玩体检 · 判有没有问题", () => {
  it("走得通、导航都能切 = 没问题", () => {
    expect(playCheckHasIssue(parsePlayCheck(good))).toBe(false);
  });

  it("白屏算问题", () => {
    expect(playCheckHasIssue(parsePlayCheck({ ...good, bootText: 0 }))).toBe(true);
  });

  it("开局卡住算问题", () => {
    const r = parsePlayCheck({
      ...good,
      stuck: { step: 2, tried: ["下一步"], screen: "你的名字", filled: [], why: "dead-end" },
    });
    expect(playCheckHasIssue(r)).toBe(true);
  });

  it("导航有一项点不动就算问题", () => {
    const r = parsePlayCheck({
      ...good,
      nav: [...good.nav, { label: "积分榜", changed: false, textLen: 900, clickable: 12 }],
    });
    expect(playCheckHasIssue(r)).toBe(true);
  });

  it("切过去了但那页是空壳，也算问题", () => {
    const r = parsePlayCheck({
      ...good,
      nav: [...good.nav, { label: "转会", changed: true, textLen: 8, clickable: 0 }],
    });
    expect(playCheckHasIssue(r)).toBe(true);
  });
});

describe("试玩体检 · 说给 AI 听", () => {
  it("有问题时必须挑明「这类问题不抛异常」", () => {
    // 不写这句的代价是实测里真花掉的四轮：模型照老经验判
    // 「read_errors 是空的 = 没问题」然后收工
    const r = parsePlayCheck({
      ...good,
      stuck: { step: 2, tried: ["下一步", "返回"], screen: "你的名字", filled: ["名字"], why: "dead-end" },
    });
    const text = describePlayCheck(r);
    expect(text).toContain("不抛");
    expect(text).toContain("第 2 步");
    expect(text).toContain("下一步");
    // 已经替玩家填过了还是过不去——这句能挡住「是不是没填名字」的瞎猜
    expect(text).toContain("名字");
  });

  it("点不动的导航要把名字一个个列出来", () => {
    const r = parsePlayCheck({
      ...good,
      nav: [
        { label: "阵容", changed: true, textLen: 900, clickable: 12 },
        { label: "积分榜", changed: false, textLen: 900, clickable: 12 },
        { label: "转会", changed: false, textLen: 900, clickable: 12 },
      ],
    });
    const text = describePlayCheck(r);
    expect(text).toContain("积分榜");
    expect(text).toContain("转会");
  });

  it("没查出问题时不许说成「好游戏」", () => {
    const text = describePlayCheck(parsePlayCheck(good));
    expect(text).toContain("不说明好玩");
  });

  it("体检比改动早，就得说这份可能过时了", () => {
    const r = parsePlayCheck({
      ...good,
      stuck: { step: 1, tried: ["开始"], screen: "x", filled: [], why: "dead-end" },
    });
    const later = new Date(Date.now() + 60_000).toISOString();
    expect(describePlayCheck(r, later)).toContain("过时");
    expect(describePlayCheck(r, "2000-01-01T00:00:00.000Z")).not.toContain("过时");
  });
});

describe("试玩体检 · 一句话结论", () => {
  it("好的时候说走通几步", () => {
    expect(summarizePlayCheck(parsePlayCheck(good))).toContain("试玩通过");
  });
  it("坏的时候把坏在哪说全", () => {
    const r = parsePlayCheck({
      ...good,
      stuck: { step: 3, tried: ["确定"], screen: "x", filled: [], why: "dead-end" },
      nav: [
        { label: "阵容", changed: false, textLen: 900, clickable: 12 },
        { label: "赛程", changed: true, textLen: 5, clickable: 0 },
      ],
    });
    const s = summarizePlayCheck(r);
    expect(s).toContain("第 3 步");
    expect(s).toContain("点不动");
    expect(s).toContain("空壳");
  });
  it("白屏一句话说完", () => {
    expect(summarizePlayCheck(parsePlayCheck({ ...good, bootText: 0 }))).toBe("开局白屏");
  });
});

describe("试玩体检 · 写进 AI 守则", () => {
  it("自由模式的守则里必须挑明「没有报错记录 ≠ 没问题」", async () => {
    // 这条规则是整个功能的落点：体检查出来的东西一个异常都不抛，
    // 模型要是照老经验判「read_errors 空的 = 做好了」，体检白跑。
    const { buildSystemPrompt } = await import("@/lib/ai/prompt");
    const cfg = {
      schemaVersion: 1,
      meta: { title: "t" },
      driver: { kind: "story", startCard: "c1" },
      vars: [],
      cards: [{ id: "c1", text: "…" }],
      endings: [],
    } as never;
    const code = buildSystemPrompt(cfg, "code");
    expect(code).toContain("【试玩体检】");
    expect(code).toContain("一个异常都不抛");
    expect(code).toContain("≠ 没问题");
  });
});

describe("试玩体检 · 自测逼出来的两条", () => {
  // 两条都来自本地真跑一遍坏样例：第一版报告一条对一条错
  it("走通了也要把路上点不动的按钮记下来", () => {
    // 坏样例里「下一步」「返回」都毫无动静，体检接着点到导航上的「阵容」界面才变——
    // 第一版据此判「第 1 步走通了」，而老板撞见的 bug 恰恰就是那两下
    const r = parsePlayCheck({
      ...good,
      steps: [{ label: "阵容", dead: ["下一步", "返回"], filled: [] }],
    });
    expect(playCheckHasIssue(r)).toBe(true);
    const text = describePlayCheck(r);
    expect(text).toContain("下一步");
    expect(text).toContain("返回");
    expect(summarizePlayCheck(r)).toContain("2 个按钮");
  });

  it("「已经在这一页了」不许当成点不动", () => {
    // 体检自己先点开了「阵容」，扫导航时再点一次当然不动——冤枉人
    const r = parsePlayCheck({
      ...good,
      nav: [
        { label: "阵容", changed: false, already: true, textLen: 900, clickable: 12 },
        { label: "赛程", changed: true, textLen: 600, clickable: 8 },
      ],
    });
    expect(playCheckHasIssue(r)).toBe(false);
    expect(describePlayCheck(r)).not.toContain("阵容");
  });
});
