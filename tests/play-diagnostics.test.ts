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
    // 注入的东西（viewport + 兜底诊断）整体排在作品内容之前
    expect(out.indexOf("data-wgp-error")).toBeLessThan(out.indexOf('<div id="app">'));
    expect(out).toContain("data-wgp-error");
  });

  it("注入的脚本自己不能有语法错误——它是最后一道兜底，炸了就真没救了", async () => {
    const out = injectPlayDiagnostics("<head></head>");
    const code = /<script>([\s\S]*?)<\/script>/.exec(out)![1];
    const vm = await import("node:vm");
    expect(() => new vm.Script(code)).not.toThrow();
  });

  it("平台自己重启导致的文件加载失败，不许算在作品头上", () => {
    // 被一次真实误诊逼出来的：每次部署重启的那几分钟，作品的 screens-setup.js
    // 502 拿不到，于是报「registerSetup is not defined」，血红一片。
    // 看的人据此判定作品写坏了——而它平时好好的。
    const code = /<script>([\s\S]*?)<\/script>/.exec(injectPlayDiagnostics("<head></head>"))![1];
    expect(code).toContain("resourceFailed");
    expect(code).toContain("刷新一下多半就好");
    expect(code).toContain("不是这部作品的问题");
    // 关键：资源失败那条**不上报**，它引发的连锁 not defined 也不上报
    expect(code).toContain("if (resourceFailed) return;");
  });

  it("开局体检只查「标签指向的控件不存在」这一件板上钉钉的事", () => {
    // 老板撞到的那一次：作品画出了「你的名字」，可下面根本没有输入框，
    // 点「下一步」原地不动——页面渲染正常、控制台干干净净，一个异常都不抛。
    const code = /<script>([\s\S]*?)<\/script>/.exec(injectPlayDiagnostics("<head></head>"))![1];
    expect(code).toContain("label[for]");
    expect(code).toContain("getElementById");
    expect(code).toContain("开局体检");
    // 隐式标签（<label> 包着控件、没有 for）不查——冤枉正常写法比漏掉更糟
    expect(code).not.toContain('querySelectorAll("label")');
  });

  it("Script error.（跨域遮蔽）要说清是怎么回事，不能让人以为平台在藏信息", () => {
    expect(injectPlayDiagnostics("<head></head>")).toContain("跨域遮蔽");
  });

  // 上线第一天就踩到的回归：一个**全新的空作品**顶上挂着血红的
  // 「这部作品有一个没被处理的异步错误：Failed to connect to MetaMask」——
  // 那是玩家浏览器里的加密钱包插件在喊，跟作品毫无关系。
  // 误报比不报还坏：作者以为平台坏了，AI 还会被指使去修一个不存在的 bug。
  it("插件噪音一概不管：MetaMask 这类关键词进过滤名单", () => {
    const code = /<script>([\s\S]*?)<\/script>/.exec(injectPlayDiagnostics("<head></head>"))![1];
    const noise = /var NOISE = (\/.*?\/i);/.exec(code)![1];
    const re = new RegExp(noise.slice(1, -2), "i");
    for (const m of [
      "Failed to connect to MetaMask",
      "ethereum is not defined",
      "ResizeObserver loop completed with undelivered notifications",
    ]) {
      expect(re.test(m), m).toBe(true);
    }
    // 真正的作品报错不能被误伤
    expect(re.test("Unexpected token ')'")).toBe(false);
    expect(re.test("app.textContent is not a function")).toBe(false);
  });

  /**
   * 老板的原话：「游戏在手机端玩不了」。
   *
   * 头号原因是作品的 index.html 丢了 viewport 这一行——手机浏览器于是按
   * 桌面宽度（约 980px）排版再整体缩小，字小得看不清、按钮点不准。
   * 平台的起手骨架本来有这一行，但 AI 用 write_file 重写 index.html 时很容易丢掉，
   * **一丢整部作品在手机上就废了，而且不报任何错**。
   */
  it("作品没写 viewport 就在出口补上——不然手机上按 980px 排版，等于玩不了", () => {
    const out = injectPlayDiagnostics("<html><head></head><body>x</body></html>");
    expect(out).toMatch(/<meta name="viewport"[^>]*width=device-width/);
    // 要排在作品自己的内容之前
    expect(out.indexOf("viewport")).toBeLessThan(out.indexOf("<body>"));
  });

  it("作品自己写了 viewport 就不动它——作者的设置优先", () => {
    const own = '<html><head><meta name="viewport" content="width=420"></head></html>';
    const out = injectPlayDiagnostics(own);
    expect(out.match(/name="viewport"/g) ?? []).toHaveLength(1);
    expect(out).toContain('content="width=420"');
  });

  it("单引号、大小写、属性顺序换一换也认得出来，别重复插一条", () => {
    for (const tag of [
      "<META NAME='viewport' CONTENT='width=device-width'>",
      '<meta content="width=device-width" name="viewport">',
    ]) {
      const out = injectPlayDiagnostics(`<head>${tag}</head>`);
      expect(out.match(/name=["']?viewport/gi) ?? [], tag).toHaveLength(1);
    }
  });

  it("残缺的 html 也补 viewport", () => {
    expect(injectPlayDiagnostics('<div id="app"></div>')).toContain("width=device-width");
  });

  it("顺手关掉 iOS 的自动放大字号——横屏时它会把排好的界面弄错位", () => {
    expect(injectPlayDiagnostics("<head></head>")).toContain("-webkit-text-size-adjust:100%");
  });

  it("没被处理的 Promise 拒绝只记录、不弹横幅——它归不了因，十有八九不是作品的错", () => {
    const code = /<script>([\s\S]*?)<\/script>/.exec(injectPlayDiagnostics("<head></head>"))![1];
    const handler = /unhandledrejection[\s\S]*?\}\);/.exec(code)![0];
    expect(handler).toContain("post(");
    expect(handler).not.toContain("bar(");
  });
});
