import { describe, it, expect } from "vitest";
import { checkCodePublish, gateBlocks, describeGate } from "@/lib/publish-gate";
import { blankCodeFiles } from "@/lib/blank-code";
import { PlayCheckReport } from "@/lib/playcheck/types";

// 自由模式的发布门槛。
//
// 这道门槛之前**根本不存在**：发布跑的是 validateGameConfig(record.config)，
// 而自由模式作品的 config 是一份不参与运行的空白故事配置，于是永远绿。
// 老板那句「游戏库里新出现的 val manager 根本玩不了」就是从这个口子进去的——
// 那部作品开局抛 registerSetup is not defined，一路发布进了公开游戏库。
//
// 这里逐条钉住：该拦的拦住、该放的放行、**每一条拦住的都要告诉作者怎么解**。

const T0 = "2026-08-27T10:00:00.000Z";
const T1 = "2026-08-27T11:00:00.000Z";

const file = (path: string, content: string, updatedAt = T0): { path: string; content: string; updatedAt: string } => ({
  path,
  content,
  updatedAt,
});

/** 一份「体检通过」的报告 */
const passing = (at = T1): PlayCheckReport => ({
  at,
  bootText: 800,
  steps: [{ label: "开始", dead: [], filled: [] }],
  walked: 1,
  arrived: true,
  stuck: null,
  numbers: { nan: [], huge: [], noisy: [], earlyEnd: "" },
  nav: [
    { label: "阵容", changed: true, already: false, textLen: 900, clickable: 12 },
    { label: "赛程", changed: true, already: false, textLen: 600, clickable: 8 },
  ],
  notes: [],
  ms: 3000,
});

const INDEX = `<!doctype html><html><body><div id=app></div><script src="game.js"></script></body></html>`;
const GAME = `function start(){ document.getElementById("app").textContent = "开局"; }\nstart();\n`;

/** 一部各方面都好的作品 */
const healthy = (): { path: string; content: string; updatedAt: string }[] => [
  file("index.html", INDEX),
  file("game.js", GAME),
];

const errorsOf = (issues: ReturnType<typeof checkCodePublish>): string[] =>
  issues.filter((i) => i.level === "error").map((i) => i.what);

describe("好作品放行", () => {
  it("语法、接线、引用、体检都过 = 能发", () => {
    const issues = checkCodePublish(healthy(), passing());
    expect(gateBlocks(issues)).toBe(false);
  });
});

describe("拦得住的那几样", () => {
  it("没有 index.html —— 玩家点开是一片空白", () => {
    const issues = checkCodePublish([file("game.js", GAME)], passing());
    expect(gateBlocks(issues)).toBe(true);
    expect(errorsOf(issues)[0]).toContain("index.html");
  });

  it("语法错 —— 带着它上线，玩家看到的是黑屏", () => {
    const issues = checkCodePublish(
      [file("index.html", INDEX), file("game.js", "function start(){ 这里少个括号 ")],
      passing()
    );
    expect(gateBlocks(issues)).toBe(true);
  });

  it("index.html 引了一个不存在的文件 —— 浏览器会 404", () => {
    const issues = checkCodePublish(
      [file("index.html", `<script src="missing.js"></script><div id=app></div>`)],
      passing()
    );
    expect(gateBlocks(issues)).toBe(true);
    expect(errorsOf(issues).join()).toContain("missing.js");
  });

  it("调了一个谁都没定义的名字 —— 这就是那部死掉的 val manager", () => {
    const issues = checkCodePublish(
      [file("index.html", INDEX), file("game.js", "registerSetup({ id: 1 });\n")],
      passing()
    );
    expect(gateBlocks(issues)).toBe(true);
    const e = errorsOf(issues).join();
    expect(e).toContain("registerSetup");
    expect(e).toContain("is not defined");
  });
});

describe("试玩体检这一层：没测到不许当没问题", () => {
  it("从来没体检过 —— 拦住，而且要告诉作者去哪儿点", () => {
    const issues = checkCodePublish(healthy(), null);
    expect(gateBlocks(issues)).toBe(true);
    const miss = issues.find((i) => i.level === "error" && i.what.includes("还没做过试玩体检"));
    expect(miss).toBeTruthy();
    // 光说「不行」不告诉人怎么解，等于没说
    expect(miss?.how).toContain("体检");
  });

  it("体检是改文件**之前**跑的 —— 那是给上一版背书，拦住", () => {
    // 文件改于 T1，体检跑在 T0：报告比文件旧
    const files = healthy().map((f) => ({ ...f, updatedAt: T1 }));
    const issues = checkCodePublish(files, passing(T0));
    expect(gateBlocks(issues)).toBe(true);
    expect(errorsOf(issues).join()).toContain("改文件之前");
  });

  it("体检跑在改文件之后 —— 放行", () => {
    const files = healthy().map((f) => ({ ...f, updatedAt: T0 }));
    expect(gateBlocks(checkCodePublish(files, passing(T1)))).toBe(false);
  });

  it("体检查出问题 —— 拦住，并把结论原样带出来", () => {
    const bad: PlayCheckReport = { ...passing(), arrived: false, walked: 14 };
    const issues = checkCodePublish(healthy(), bad);
    expect(gateBlocks(issues)).toBe(true);
    expect(errorsOf(issues).join()).toContain("没走到主界面");
  });
});

describe("只警告、不拦的那几样", () => {
  it("文件在那儿但 index.html 没引 —— 可能是被别的模块 import 的", () => {
    const issues = checkCodePublish(
      [file("index.html", INDEX), file("game.js", GAME), file("extra.js", "const x = 1;\n")],
      passing()
    );
    expect(gateBlocks(issues)).toBe(false);
    expect(issues.some((i) => i.level === "warn" && i.what.includes("extra.js"))).toBe(true);
  });
});

describe("说给作者听的那段话", () => {
  it("每一条拦住的都带「怎么办」", () => {
    const issues = checkCodePublish([file("game.js", "foo();\n")], null);
    for (const e of issues.filter((i) => i.level === "error")) {
      expect(e.how, `这条 error 没写怎么办：${e.what}`).toBeTruthy();
    }
  });

  it("全过的时候说全过", () => {
    expect(describeGate(checkCodePublish(healthy(), passing()))).toContain("全过");
  });

  it("拦住的时候先说有几处要修，再一条条列", () => {
    const text = describeGate(checkCodePublish(healthy(), null));
    expect(text).toContain("发不了");
    expect(text).toContain("怎么办");
  });
});

describe("平台自己的空白模板必须过得了自己的门槛", () => {
  // 端到端自测第一关撞出来的：模板的 index.html 引的是 wgp.css / wgp.js，
  // 那是 /play 那一层虚拟出来的运行库，不在作品的文件列表里。
  // 接线体检原来只挡住带斜杠的 wgp/...，于是**每一部新建的作品**都被报
  // 「index.html 引用了 wgp.css，可作品里没有这个文件」——门槛一接上去，
  // 平台就把自己发的模板拦在了发布之外。
  //
  // 拿真模板测，不要自己另写一份 index.html：假样例测不出这种事。
  const files = blankCodeFiles("模板自测").map((f) => ({ ...f, updatedAt: T0 }));

  it("除了「还没体检」之外，一条 error 都不该有", () => {
    const issues = checkCodePublish(files, null);
    const errs = issues.filter((i) => i.level === "error").map((i) => i.what);
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain("还没做过试玩体检");
  });

  it("体检过了就能发", () => {
    expect(gateBlocks(checkCodePublish(files, passing()))).toBe(false);
  });

  it("不许把平台的虚拟运行库报成缺文件", () => {
    const text = describeGate(checkCodePublish(files, passing()));
    expect(text).not.toContain("wgp.css");
    expect(text).not.toContain("wgp.js");
  });
});
