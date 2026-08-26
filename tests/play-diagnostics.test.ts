import { describe, it, expect } from "vitest";
import { injectPlayDiagnostics } from "@/lib/play-diagnostics";

/**
 * 老板打开一部自由模式作品看到**纯黑一片**，什么提示都没有。
 * 两层问题叠在一起：作品的 js 有语法错误（脚本一行没跑），
 * 而沙箱的不透明源让 window.onerror 的详情被抹成 `Script error.`——
 * 玩家看不出、作者看不出、AI 也看不出。
 *
 * 这一层在服务端出口修：注入兜底诊断 + 给脚本标 crossorigin（配合出口的 ACAO 头）。
 * 关键是**不改作品的任何文件**，所以已有作品立刻受益。
 */
describe("自由模式出口注入：黑屏要变成看得懂的报错", () => {
  it("诊断脚本排在作品自己的脚本之前——晚一步就漏掉第一行就炸的情况", () => {
    const html = '<html><head><title>x</title></head><body><script src="game.js"></script></body></html>';
    const out = injectPlayDiagnostics(html);
    expect(out.indexOf("data-wgp-error")).toBeLessThan(out.indexOf("game.js"));
    // 贴在 <head> 之后，不破坏原有结构
    expect(out).toContain("<head>");
    expect(out).toContain("<title>x</title>");
  });

  it("本地脚本标上 crossorigin，浏览器才肯交出真实行号", () => {
    const out = injectPlayDiagnostics('<head></head><script src="game.js"></script>');
    expect(out).toMatch(/<script[^>]*src="game\.js"[^>]*crossorigin="anonymous"/);
  });

  it("外链与 data:/blob: 不标——标了反而可能加载失败", () => {
    const out = injectPlayDiagnostics(
      '<head></head><script src="https://cdn.example.com/a.js"></script><script src="data:text/javascript,1"></script>'
    );
    expect(out).not.toMatch(/cdn\.example\.com\/a\.js"[^>]*crossorigin/);
    expect(out).not.toMatch(/data:text\/javascript,1"[^>]*crossorigin/);
  });

  it("已经标过 crossorigin 的不重复标", () => {
    const out = injectPlayDiagnostics('<head></head><script src="a.js" crossorigin="use-credentials"></script>');
    expect(out.match(/crossorigin/g) ?? []).toHaveLength(1);
    expect(out).toContain('crossorigin="use-credentials"');
  });

  it("残缺的 html（没有 head）也要注入，不能因为格式不标准就不管", () => {
    const out = injectPlayDiagnostics('<div id="app"></div><script src="g.js"></script>');
    expect(out.startsWith("<script>")).toBe(true);
    expect(out).toContain("data-wgp-error");
  });

  it("注入的脚本自己不能有语法错误——它是最后一道兜底，炸了就真没救了", async () => {
    const out = injectPlayDiagnostics("<head></head>");
    const code = /<script>([\s\S]*?)<\/script>/.exec(out)![1];
    const vm = await import("node:vm");
    expect(() => new vm.Script(code)).not.toThrow();
  });

  it("Script error.（跨域遮蔽）要说清是怎么回事，不能让人以为平台在藏信息", () => {
    expect(injectPlayDiagnostics("<head></head>")).toContain("跨域遮蔽");
  });
});
