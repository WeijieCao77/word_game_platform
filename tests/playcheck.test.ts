import { describe, it, expect } from "vitest";
import { parsePlayCheck, summarizePlayCheck, describePlayCheck } from "@/lib/playcheck/report";
import { PlayCheckReport, playCheckHasIssue } from "@/lib/playcheck/types";

// 试玩体检的服务端这一半。真正去点的那段跑在浏览器里（sweep.ts），
// 这里量的是「收得干不干净、说得清不清楚」——尤其是那句
// 「这类问题不抛异常」必须出现，它就是这个功能存在的理由。

const good = {
  bootText: 800,
  steps: [{ label: "开始", filled: [] }],
  // 「走到主界面了」是通过的必要条件之一，样例里必须显式带上——
  // 少了它这份报告就该被判成「没测到」，见下面那一组。
  walked: 1,
  arrived: true,
  stuck: null,
  numbers: { nan: [], huge: [], noisy: [], earlyEnd: "" },
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

// 线上真绿过一次：体检走满一路都没走到主界面，路上没卡住也没坏按钮，
// 于是 stuck 是 null、nav 里是某一屏的四个分区页签——报告长得跟通过一模一样，
// 一句话结论直接写「试玩通过（导航 4 项都能切）」。同一分钟另一个检查器说的是
// 「开局第 4 步走不下去」。**「走了很多步」不等于「走到了」。**
describe("试玩体检 · 走了很多步但没走到主界面", () => {
  const wandered = {
    ...good,
    walked: 14,
    arrived: false,
    steps: new Array(12).fill({ label: "Americas", dead: [], filled: [] }),
    nav: [
      { label: "Americas", changed: true, textLen: 500, clickable: 9 },
      { label: "EMEA", changed: true, textLen: 500, clickable: 9 },
      { label: "Pacific", changed: true, textLen: 500, clickable: 9 },
      { label: "China", changed: true, textLen: 500, clickable: 9 },
    ],
  };

  it("没走到主界面就是有问题，不许算通过", () => {
    expect(playCheckHasIssue(parsePlayCheck(wandered))).toBe(true);
  });

  it("一句话结论里绝不能出现「试玩通过」", () => {
    const s = summarizePlayCheck(parsePlayCheck(wandered));
    expect(s).not.toContain("试玩通过");
    expect(s).toContain("没走到主界面");
  });

  it("给 AI 的话要说清「走了很多步不等于走通了」，还要留下自辩的口子", () => {
    const text = describePlayCheck(parsePlayCheck(wandered));
    expect(text).toContain("始终没走到有导航栏的主界面");
    expect(text).toContain("别把「走了很多步」当成走通了");
    // 纯线性故事本来就没有导航栏，得让 AI 一句话就能打发掉，而不是被逼着乱改
    expect(text).toContain("本来就没有导航栏");
  });

  it("步数说实话：steps 存下来截到 12 条，不许把 14 步说成 12 步", () => {
    const r = parsePlayCheck(wandered);
    expect(r.steps.length).toBe(12);
    expect(r.walked).toBe(14);
    expect(summarizePlayCheck(r)).toContain("14 步");
  });

  it("老报告里没有 arrived 这个字段——一律按「没测到」算，不许当通过", () => {
    const legacy = { ...good };
    delete (legacy as { arrived?: boolean }).arrived;
    delete (legacy as { walked?: number }).walked;
    const r = parsePlayCheck(legacy);
    expect(r.arrived).toBe(false);
    expect(playCheckHasIssue(r)).toBe(true);
    // walked 缺省退回条数，别编数
    expect(r.walked).toBe(1);
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

describe("试玩体检 · 「没测到」不许说成「通过」", () => {
  // 线上第一次真跑就露出来了：报告写「试玩通过（走了 8 步，导航 0 项都能切）」——
  // 一项都没点到，却读起来像全过了。判据浅、把没测到说成没问题，这是第四次栽在同一件事上。
  const noNav = { ...good, arrived: false, steps: [{ label: "开始", dead: [], filled: [] }], nav: [] };

  it("一项导航都没找到时，结论里不许出现「都能切」", () => {
    const s = summarizePlayCheck(parsePlayCheck(noNav));
    expect(s).not.toContain("都能切");
    expect(s).not.toContain("试玩通过");
  });

  it("给 AI 的话也要挑明这一段没测到", () => {
    const text = describePlayCheck(parsePlayCheck(noNav));
    expect(text).toContain("一组导航都没找到");
    expect(text).toContain("别把「走了很多步」当成走通了");
  });

  // 保险丝：万一「走到主界面了」和「一项导航都没扫到」同时出现（页面自己跳走了），
  // 「导航 0 项都能切」照样是句空话
  it("说走到了主界面、却一项导航都没扫到——也不许说成通过", () => {
    const weird = { ...good, arrived: true, nav: [] };
    const s = summarizePlayCheck(parsePlayCheck(weird));
    expect(s).not.toContain("都能切");
    expect(s).toContain("没测到");
    expect(describePlayCheck(parsePlayCheck(weird))).toContain("别当成通过");
  });

  it("真扫到导航时照旧说「都能切」", () => {
    expect(summarizePlayCheck(parsePlayCheck(good))).toContain("都能切");
  });
});

describe("数值这一层", () => {
  // 快速模式有 600 局模拟兜底（全结局可达、开局即死率 0），自由模式一局都不跑——
  // 数值全在 AI 写的 js 里，平台没有形式化模型可模拟。老板原话：
  // 「这个游戏全是问题，不仅是功能，还有数值」。
  // 所以先做通用的那一小步：不懂这个游戏也能判断的那几样。
  const withNumbers = (n: Partial<PlayCheckReport["numbers"]>) =>
    parsePlayCheck({ ...good, numbers: { nan: [], huge: [], noisy: [], earlyEnd: "", ...n } });

  it("玩家眼前出现 NaN = 硬伤，没有辩解余地", () => {
    const r = withNumbers({ nan: ["资金 NaN 万"] });
    expect(playCheckHasIssue(r)).toBe(true);
    expect(summarizePlayCheck(r)).toContain("NaN");
    expect(describePlayCheck(r)).toContain("玩家眼前直接出现了 NaN");
  });

  it("大得不正常的数字只提醒，不算硬伤——有可能是作者故意的", () => {
    const r = withNumbers({ huge: ["10000000000001"] });
    expect(playCheckHasIssue(r)).toBe(false);
    // 但话还是要说到
    expect(describePlayCheck(r)).toContain("大得不正常");
  });

  it("浮点噪声只提醒", () => {
    const r = withNumbers({ noisy: ["30.000000000000004"] });
    expect(playCheckHasIssue(r)).toBe(false);
    expect(describePlayCheck(r)).toContain("小数点后拖了一长串");
  });

  it("开局即死只提醒，而且留一句「真是设计如此就忽略」", () => {
    const r = withNumbers({ earlyEnd: "第 2 步就出现了「游戏结束」" });
    expect(playCheckHasIssue(r)).toBe(false);
    const text = describePlayCheck(r);
    expect(text).toContain("玩家还没玩上就结束了");
    expect(text).toContain("忽略这条");
  });

  it("数值那一段也当外人的输入收：限条数、限长度", () => {
    const r = parsePlayCheck({
      ...good,
      numbers: {
        nan: new Array(50).fill("x".repeat(500)),
        huge: "不是数组",
        noisy: [1, 2, 3],
        earlyEnd: "y".repeat(500),
      },
    });
    expect(r.numbers.nan.length).toBeLessThanOrEqual(6);
    expect(r.numbers.nan[0].length).toBeLessThanOrEqual(60);
    expect(r.numbers.huge).toEqual([]);
    expect(r.numbers.earlyEnd.length).toBeLessThanOrEqual(60);
  });

  it("老报告没有 numbers 这一段也不能炸", () => {
    const legacy = { ...good };
    delete (legacy as { numbers?: unknown }).numbers;
    const r = parsePlayCheck(legacy);
    expect(r.numbers.nan).toEqual([]);
    expect(playCheckHasIssue(r)).toBe(false);
  });
});
