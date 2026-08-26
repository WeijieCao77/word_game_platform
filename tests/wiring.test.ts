import { describe, it, expect } from "vitest";
import { checkWiring, describeWiring } from "@/lib/wiring";

/**
 * 实测第 4 次跑出来的那次事故，一比一还原：
 *
 *   作品有 9 个文件、145,137 字符、11 个主界面全在，
 *   玩家打开只看到 64 个字符的空白，控制台一句 `registerSetup is not defined`。
 *
 * 原因是 index.html 里少了一行 <script src="screens-setup.js">。
 * 每个文件单独看语法都完全正确，所以第一级校验一路放行——
 * 缺的是「这些文件拼在一起能不能跑起来」这一层。
 */
describe("接线体检：文件都写好了，游戏却打不开", () => {
  const idx = (...srcs: string[]) =>
    `<!doctype html><html><head><meta charset="utf-8"></head><body>` +
    srcs.map((s) => `<script src="${s}"></script>`).join("") +
    `</body></html>`;

  it("写了文件却没在 index.html 里引 —— 就是那次 registerSetup is not defined", () => {
    const r = checkWiring({
      "index.html": idx("game.js"),
      "game.js": "registerSetup();",
      "screens-setup.js": "function registerSetup(){}",
    });
    expect(r.orphans).toEqual(["screens-setup.js"]);
    expect(describeWiring(r)).toContain("screens-setup.js");
    expect(describeWiring(r)).toContain("is not defined");
  });

  it("引了不存在的文件：浏览器静默 404，同样一片空白", () => {
    const r = checkWiring({ "index.html": idx("game.js", "missing.js"), "game.js": "" });
    expect(r.broken).toEqual(["missing.js"]);
    expect(describeWiring(r)).toContain("missing.js");
  });

  it("接好了就一个字都不说——别拿噪音去烦 AI", () => {
    const r = checkWiring({
      "index.html": idx("a.js", "b.js"),
      "a.js": "",
      "b.js": "",
    });
    expect(r).toEqual({ orphans: [], broken: [] });
    expect(describeWiring(r)).toBe("");
  });

  it("css 也算：样式表没引上，界面就是一坨裸文字", () => {
    const r = checkWiring({ "index.html": idx("game.js"), "game.js": "", "style.css": "body{}" });
    expect(r.orphans).toEqual(["style.css"]);
  });

  it("<link> 引的样式表算接好了", () => {
    const r = checkWiring({
      "index.html": '<html><head><link rel="stylesheet" href="style.css"></head><body></body></html>',
      "style.css": "body{}",
    });
    expect(r.orphans).toEqual([]);
  });

  it("平台自己的运行库与外链不算断链——它们不在作品的文件清单里", () => {
    const r = checkWiring({
      "index.html":
        '<html><head><script src="/wgp/runtime.js"></script>' +
        '<script src="https://cdn.example.com/x.js"></script></head><body></body></html>',
    });
    expect(r.broken).toEqual([]);
  });

  it("data/ 下的数据表不算孤儿——它们靠 WGP.data 取，本来就不用 script 引", () => {
    const r = checkWiring({ "index.html": idx("game.js"), "game.js": "", "data/players.csv": "a,b" });
    expect(r.orphans).toEqual([]);
  });

  it("./ 前缀、带查询串的引用都要认出来，别误报成断链", () => {
    const r = checkWiring({
      "index.html": idx("./game.js", "style.css?v=2"),
      "game.js": "",
      "style.css": "",
    });
    expect(r).toEqual({ orphans: [], broken: [] });
  });

  it("还没有 index.html 的时候不下结论——那是刚起步，不是出错", () => {
    expect(checkWiring({ "game.js": "" })).toEqual({ orphans: [], broken: [] });
  });
});
