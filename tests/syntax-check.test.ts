import { describe, it, expect } from "vitest";
import { checkFileSyntax, describeProblem } from "@/lib/syntax-check";

/**
 * 第 3 次 VAL MANAGER 实测的真卡点：AI 写出的 js 里多了一个 `)`，
 * 浏览器解析失败 → 游戏脚本一行没跑 → 玩家看到黑屏。
 * 而 AI 拿到的线索只有跨域遮蔽后的 `Script error.`，
 * 它读完 808 行也没找到，花了四轮去争论「这是检查器误判」。
 *
 * 所以这一层要保证的不是「能发现错误」，而是**当场把文件名 + 行号 + 那一行原文交出来**。
 */
describe("自由模式第一级校验：语法不过不许落盘", () => {
  it("多一个括号：报出行号和那一行原文", () => {
    const code = ["function boot() {", "  return 1;", "}", "console.log(boot()));", ""].join("\n");
    const p = checkFileSyntax("game.js", code);
    expect(p).not.toBeNull();
    expect(p!.line).toBe(4);
    expect(p!.message).toContain(")");
    expect(p!.lineText).toBe("console.log(boot()));");
    // 给 AI 看的那段话要能直接照着改
    expect(describeProblem(p!)).toContain("game.js 第 4 行");
    expect(describeProblem(p!)).toContain("黑屏");
  });

  it("写对的代码原样放行", () => {
    expect(checkFileSyntax("game.js", "const a = [1,2,3].map((x) => x * 2);\n")).toBeNull();
  });

  it("html 里的内联脚本也查，行号按整个文件算", () => {
    const html = ["<!doctype html>", "<body>", "<div id=app></div>", "<script>", "  let a = (1;", "</script>"].join("\n");
    const p = checkFileSyntax("index.html", html);
    expect(p).not.toBeNull();
    expect(p!.path).toBe("index.html");
    expect(p!.line).toBe(5); // <script> 在第 4 行，出错的是第 5 行
  });

  it("html 里带 src 的、以及不是 js 的 script 块不当代码查", () => {
    const html =
      '<script src="game.js"></script>\n' +
      '<script type="application/json">{"这不是代码": (((}</script>\n';
    expect(checkFileSyntax("index.html", html)).toBeNull();
  });

  it("ES module 写法一律放行——script type=module 引它是合法的，不能误伤", () => {
    expect(checkFileSyntax("game.js", 'import { a } from "./x.js";\nconsole.log(a);\n')).toBeNull();
    expect(checkFileSyntax("game.js", "export const a = 1;\n")).toBeNull();
    expect(checkFileSyntax("game.js", "const x = await fetch();\n")).toBeNull();
  });

  it("json 坏了也拦，别让数据表把作品拖黑", () => {
    expect(checkFileSyntax("data/x.json", '{"a": 1}')).toBeNull();
    expect(checkFileSyntax("data/x.json", '{"a": 1,,}')).not.toBeNull();
  });

  it("css / csv 这类不是代码的，一概不管", () => {
    expect(checkFileSyntax("style.css", "body { color: red; }")).toBeNull();
    expect(checkFileSyntax("data/roster.csv", "名字,战力\n阿强,99")).toBeNull();
  });
});
