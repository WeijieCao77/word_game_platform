import { describe, it, expect } from "vitest";
import { recoverInlineToolCalls, looksInline } from "../src/lib/ai/inline-tools";

/**
 * 这份测试的原始素材是线上实测第 9 次的日志——AI 想改配置，
 * 结果把整个调用当正文吐给了创作者，那一轮的活全白干、token 照收。
 * 下面第一例就是当时日志里那一坨的原样。
 */

const 实测原样 = `<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="update_config">
<｜｜DSML｜｜parameter name="config" string="false">{"schemaVersion": 1, "driver": {"kind": "sim"}, "meta": {"title": "星澜电竞经理"}}</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>`;

describe("把混在正文里的工具调用捞回来", () => {
  it("线上实测那一坨：认出来、参数是对象、正文抹干净", () => {
    const out = recoverInlineToolCalls(实测原样);
    expect(out.calls.length).toBe(1);
    expect(out.calls[0].function.name).toBe("update_config");
    const args = JSON.parse(out.calls[0].function.arguments);
    expect(args.config.meta.title).toBe("星澜电竞经理");
    expect(args.config.driver.kind).toBe("sim");
    // 创作者不该看见这些标记
    expect(out.text).toBe("");
  });

  it("前面有正常说明的，说明留着，标记去掉", () => {
    const out = recoverInlineToolCalls("校验器要求 ending 必须存在于 endings 里。补上：\n\n" + 实测原样);
    expect(out.calls.length).toBe(1);
    expect(out.text).toBe("校验器要求 ending 必须存在于 endings 里。补上：");
  });

  it("一次两个调用，顺序按正文里的先后", () => {
    const two = `<｜｜DSML｜｜invoke name="write_file">
<｜｜DSML｜｜parameter name="path">index.html</｜｜DSML｜｜parameter>
<｜｜DSML｜｜parameter name="content">hello</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
<｜｜DSML｜｜invoke name="validate">
<｜｜DSML｜｜parameter name="reason">看看有没有问题</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>`;
    const out = recoverInlineToolCalls(two);
    expect(out.calls.map((c) => c.function.name)).toEqual(["write_file", "validate"]);
    expect(JSON.parse(out.calls[0].function.arguments)).toEqual({ path: "index.html", content: "hello" });
  });

  it("没有 DSML 前缀的裸 invoke 也认", () => {
    const bare = `<invoke name="patch_file">
<parameter name="path">game.js</parameter>
<parameter name="edits" string="false">[{"find":"a","replace":"b"}]</parameter>
</invoke>`;
    const out = recoverInlineToolCalls(bare);
    expect(out.calls[0].function.name).toBe("patch_file");
    expect(JSON.parse(out.calls[0].function.arguments).edits).toEqual([{ find: "a", replace: "b" }]);
  });

  it("另一种漏法 <tool_call>{json}</tool_call> 也认", () => {
    const out = recoverInlineToolCalls(
      '先看一眼原文。<tool_call>{"name":"read_file","arguments":{"path":"game.js"}}</tool_call>'
    );
    expect(out.calls[0].function.name).toBe("read_file");
    expect(JSON.parse(out.calls[0].function.arguments)).toEqual({ path: "game.js" });
    expect(out.text).toBe("先看一眼原文。");
  });

  it("arguments 是字符串形式的 JSON 也解得开", () => {
    const out = recoverInlineToolCalls('<tool_call>{"name":"validate","arguments":"{\\"reason\\":\\"检查\\"}"}</tool_call>');
    expect(JSON.parse(out.calls[0].function.arguments)).toEqual({ reason: "检查" });
  });

  it("标了 string=false 的值当 JSON 读，没标注的原样当字符串", () => {
    const mix = `<invoke name="t">
<parameter name="obj" string="false">{"a":1}</parameter>
<parameter name="say">{这不是 json</parameter>
<parameter name="n">42</parameter>
</invoke>`;
    const args = JSON.parse(recoverInlineToolCalls(mix).calls[0].function.arguments);
    expect(args.obj).toEqual({ a: 1 });
    expect(args.say).toBe("{这不是 json");
    expect(args.n).toBe("42");
  });

  it("普通回复原样放行，一个字都不动", () => {
    const plain = "【主策】骨架记下了。现在三个问题请你拍板：\n1. 单局节奏……";
    const out = recoverInlineToolCalls(plain);
    expect(out.calls).toEqual([]);
    expect(out.text).toBe(plain);
    expect(looksInline(plain)).toBe(false);
  });

  it("长得像但解不出参数的，原样留着——宁可让创作者看见，也不要吞掉内容", () => {
    const broken = '<invoke name="update_config">这里面什么都没有</invoke>';
    const out = recoverInlineToolCalls(broken);
    expect(out.calls).toEqual([]);
    expect(out.text).toBe(broken);
  });

  it("正文里聊到 <invoke> 这个词不会被误伤", () => {
    const talk = "你可以在代码里写 <invoke> 这种标签吗？";
    expect(recoverInlineToolCalls(talk).calls).toEqual([]);
  });

  it("空正文不炸", () => {
    expect(recoverInlineToolCalls("")).toEqual({ text: "", calls: [] });
  });
});
