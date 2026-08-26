import { describe, it, expect } from "vitest";
import { viewFile } from "../src/lib/ai/file-view";

/**
 * 复刻 VAL MANAGER 绕不过去的一关：原作 13,132 行。
 * read_file 原来的做法是「前三万字符，剩下截断」——文件一长过三万字，
 * 后面的代码 AI 就再也看不见、也就再也改不动了（patch_file 要先看准原文）。
 * 作品长到一半就卡死。这份测试盯的就是「大文件还改不改得动」。
 */

function bigGame(): string {
  const parts: string[] = ["// 星澜电竞经理", "var state = {};", ""];
  for (let i = 0; i < 40; i++) {
    parts.push(`// ── ${i} 号分节 ──`);
    parts.push(`function 结算第${i}周(队伍) {`);
    for (let k = 0; k < 30; k++) parts.push(`  队伍.评分 += ${k}; // 填充行让文件真的变大填充填充填充填充`);
    parts.push("}");
    parts.push(`WGP.screen("面板${i}", function (root) { root.textContent = "第 ${i} 页"; });`);
    parts.push("");
  }
  return parts.join("\n");
}

describe("小文件照旧给全文", () => {
  it("没超过三万字符就是原样，不加任何包装", () => {
    const small = "var a = 1;\nvar b = 2;\n";
    expect(viewFile("game.js", small)).toBe(small);
  });
});

describe("大文件给目录", () => {
  const src = bigGame();

  it("确实是个大文件，而且不再被截断成半截代码", () => {
    expect(src.length).toBeGreaterThan(30_000);
    const out = viewFile("game.js", src);
    expect(out).not.toContain("已截断");
    expect(out).toContain("目录");
  });

  it("目录里有函数、界面和分节，每条都带行号", () => {
    const out = viewFile("game.js", src);
    expect(out).toMatch(/\d+\| function 结算第0周/);
    expect(out).toContain("界面 面板0");
    expect(out).toMatch(/\d+\| \/\/ ── 0 号分节/);
  });

  it("告诉 AI 接下来怎么取——不然它只会重写整份", () => {
    const out = viewFile("game.js", src);
    expect(out).toContain("from:");
    expect(out).toContain("find:");
  });

  it("目录本身也有上限，不会又变成一大坨", () => {
    const many = Array.from({ length: 500 }, (_, i) => `function f${i}() {\n  return ${i};\n}`).join("\n");
    const out = viewFile("game.js", many + "\n" + "// 补长".repeat(6000));
    expect(out).toContain("只列了前 200 条");
  });
});

describe("按行取某一段", () => {
  const src = bigGame();

  it("给的是带行号的窗口，行号能对上原文", () => {
    const out = viewFile("game.js", src, { from: 5, lines: 3 });
    expect(out).toContain("第 5–7 行");
    const all = src.split("\n");
    expect(out).toContain(`5| ${all[4]}`);
    expect(out).toContain(`7| ${all[6]}`);
    expect(out).not.toContain(`8| ${all[7]}`);
  });

  it("后面还有内容时，直接告诉它下一段从哪开始", () => {
    expect(viewFile("game.js", src, { from: 1, lines: 10 })).toContain("from: 11");
  });

  it("一次要太多行会被压到上限，越界也不炸", () => {
    const out = viewFile("game.js", src, { from: 1, lines: 99999 });
    expect(out).toMatch(/第 1–400 行/);
    const past = viewFile("game.js", "a\nb\nc\n", { from: 999 });
    expect(past).toContain("第 4–4 行");
  });
});

describe("搜一段原文（patch_file 之前该做的那一步）", () => {
  const src = "行一\n关键的一句\n行三\n行四\n关键的一句\n行六\n";

  it("报出现几次、在第几行，并带上下文", () => {
    const out = viewFile("game.js", src, { find: "关键的一句" });
    expect(out).toContain("出现 2 次");
    expect(out).toContain("2|>");
  });

  it("不唯一时直接点破——patch_file 的 find 必须唯一，早说一句省一次失败", () => {
    const out = viewFile("game.js", src, { find: "关键的一句" });
    expect(out).toContain("不唯一");
  });

  it("找不到就说找不到，并劝它别照印象改", () => {
    const out = viewFile("game.js", src, { find: "根本没有这句" });
    expect(out).toContain("没有");
    expect(out).toContain("别照着印象改");
  });

  it("出现太多次时只展示前几处，其余报行号", () => {
    const many = Array.from({ length: 9 }, () => "重复的一行").join("\n");
    const out = viewFile("game.js", many, { find: "重复的一行" });
    expect(out).toContain("出现 9 次");
    expect(out).toContain("另外还有 6 处");
  });
});

describe("按文件类型认目录", () => {
  it("css 认选择器与 @media", () => {
    const css = ".panel {\n  color: red;\n}\n@media (max-width: 560px) {\n  .panel { color: blue; }\n}\n" + "/* 填充 */\n".repeat(4000);
    const out = viewFile("style.css", css);
    expect(out).toContain(".panel");
    expect(out).toContain("@media (max-width: 560px)");
  });

  it("html 认带 id 的区块与标题", () => {
    const html = '<section id="squad">\n<h2>阵容</h2>\n</section>\n' + "<p>填充</p>\n".repeat(4000);
    const out = viewFile("index.html", html);
    expect(out).toContain('<section id="squad">');
    expect(out).toContain("<h2> 阵容");
  });
});
