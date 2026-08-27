import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { checkMissingRefs, definedNames, describeMissingRefs, stripLiterals } from "@/lib/js-refs";

/**
 * 「调了一个从来没定义过的函数」——第二级接线体检。
 *
 * 线上真死过一部作品：registerSetup is not defined（game.js:308:3），
 * 玩家点开只剩 64 个字。语法检查查不出来（那行是合法 JS），
 * 接线体检也查不出来（文件都引了）。这一层专门补这个缺口。
 *
 * 这份测试的重点**不是**「能报出多少」，而是**「不许冤枉人」**——
 * 误报会让 AI 去修一个不存在的 bug，一轮几十万 token。
 * 所以下面一半的用例都在证明：这些正常写法一条都不许报。
 */
describe("缺失引用体检", () => {
  const html = (body: string): string => `<!doctype html><html><head></head><body>${body}</body></html>`;

  it("调了一个谁都没定义的函数 → 报出来，带文件和行号", () => {
    const files = {
      "index.html": html('<script src="game.js"></script>'),
      "game.js": "function boot(){\n  registerSetup();\n}\nboot();",
    };
    const found = checkMissingRefs(files);
    expect(found.map((f) => f.name)).toEqual(["registerSetup"]);
    expect(found[0].file).toBe("game.js");
    expect(found[0].line).toBe(2);
    expect(describeMissingRefs(found)).toContain("没有任何地方定义过它");
  });

  it("定义在一个没被加载的文件里 → 直接告诉它少了哪一行 script", () => {
    const files = {
      "index.html": html('<script src="game.js"></script>'),
      "game.js": "registerSetup();",
      "screens-setup.js": "function registerSetup(){ return 1; }",
    };
    const found = checkMissingRefs(files);
    expect(found[0].definedIn).toBe("screens-setup.js");
    const text = describeMissingRefs(found);
    expect(text).toContain('<script src="screens-setup.js">');
  });

  it("正常写法一条都不许报（这是这层能不能上线的门槛）", () => {
    const files = {
      "index.html": html('<script src="a.js"></script><script src="b.js"></script>'),
      "a.js": [
        "const state = { turn: 0 };",
        "function render(list){ (list || []).forEach(function(x){ draw(x); }); }",
        "const draw = (x) => document.body.appendChild(x);",
        "class Team { constructor(n){ this.n = n; } play(){ return this.n; } }",
        "window.newTeam = function(n){ return new Team(n); };",
        "const helpers = { fmt(v){ return String(v); } };",
        "try { render([]); } catch (e) { console.log(e); }",
      ].join("\n"),
      "b.js": [
        "setTimeout(function(){ newTeam('x'); }, 10);",
        "const nums = [1,2].map((n) => Math.round(n));",
        "JSON.parse('[]');",
        "helpers.fmt(1);",
        "requestAnimationFrame(function tick(){ requestAnimationFrame(tick); });",
      ].join("\n"),
    };
    expect(checkMissingRefs(files)).toEqual([]);
  });

  it("字符串和注释里的东西不算调用（文案里写个 foo() 不该被当成代码）", () => {
    const files = {
      "index.html": html('<script src="game.js"></script>'),
      "game.js": ['const tip = "记得调用 registerSetup() 哦";', "// TODO: bootEverything()", "console.log(tip);"].join("\n"),
    };
    expect(checkMissingRefs(files)).toEqual([]);
  });

  it("obj.foo() 一律不管——那是运行时才知道的东西", () => {
    const files = {
      "index.html": html('<script src="game.js"></script>'),
      "game.js": "WGP.save({}); app.router.go('home'); document.querySelector('div');",
    };
    expect(checkMissingRefs(files)).toEqual([]);
  });

  it("内联脚本里的定义也算数", () => {
    const files = {
      "index.html": html("<script>function boot(){ start(); } function start(){}</script>"),
    };
    expect(checkMissingRefs(files)).toEqual([]);
  });

  it("没有 index.html 就不查（快速模式的作品不该被这层碰到）", () => {
    expect(checkMissingRefs({ "game.js": "nope();" })).toEqual([]);
  });

  it("平台自己的运行库通读一遍，一条误报都不许有", () => {
    // 763 行真·浏览器代码。它要是被报出问题，说明这层的判据还不能用。
    const runtime = readFileSync("public/wgp/runtime.js", "utf8");
    const files = {
      "index.html": html('<script src="runtime.js"></script>'),
      "runtime.js": runtime,
    };
    expect(checkMissingRefs(files)).toEqual([]);
  });
});

describe("抹字面量：抹的时候行号不许错位", () => {
  it("多行模板串抹完，后面的行号还是对的", () => {
    const src = ["const t = `第一行", "第二行`;", "boom();"].join("\n");
    const out = stripLiterals(src);
    expect(out.split("\n").length).toBe(3);
    expect(out.split("\n")[2]).toContain("boom()");
    expect(out).not.toContain("第二行");
  });
});

describe("定义收得够不够宽", () => {
  it("函数、类、变量、赋值、window.x、参数、catch 都算定义", () => {
    const d = definedNames(
      [
        "function a(){}",
        "class B {}",
        "const c = 1;",
        "d = 2;",
        "window.e = 3;",
        "function g(f){ return f; }",
        "try {} catch (h) {}",
      ].join("\n")
    );
    for (const n of ["a", "B", "c", "d", "e", "f", "g", "h"]) expect(d.has(n)).toBe(true);
  });
});
