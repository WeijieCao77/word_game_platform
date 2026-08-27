import { describe, it, expect } from "vitest";
import { describeRuntimeErrors, freshRuntimeErrors, RuntimeError } from "@/lib/ai/runtime-errors";

/**
 * 运行报错自动进上下文。
 *
 * 起因很具体：老板照 AI 说的「你先在预览里玩一把」点进去，迎面一条血红的
 * 「(kids || []).forEach is not a function」——作品根本打不开，而 AI 已经宣布做好了。
 * 报错早就存下来了，缺的是「自动摆到 AI 面前」这最后一公里。
 *
 * 这里量三件事：有错要说得够狠、没错不占一个字、旧错不许冒充新错（误报比不报还坏）。
 */
const err = (at: string, message: string, extra: Partial<RuntimeError> = {}): RuntimeError => ({
  at,
  message,
  stack: "",
  source: "",
  ...extra,
});

const NOW = Date.parse("2026-08-27T02:00:00.000Z");

describe("【运行报错】怎么写给 AI 看", () => {
  it("一条报错都没有 = 这一段整块不出现（不占额度）", () => {
    expect(describeRuntimeErrors([], "2026-08-27T01:00:00.000Z", NOW)).toBe("");
  });

  it("报错发生在最后一次写文件之后 = 现在这份代码就是坏的，话要说死", () => {
    const text = describeRuntimeErrors(
      [err("2026-08-27T01:30:00.000Z", "(kids || []).forEach is not a function", { source: "game.js:412:18" })],
      "2026-08-27T01:20:00.000Z",
      NOW
    );
    expect(text).toContain("现在打不开或跑不动");
    expect(text).toContain("这一版抛的");
    expect(text).toContain("(kids || []).forEach is not a function");
    expect(text).toContain("game.js:412:18");
    // 修完要清记录，不然下一轮分不出修没修好
    expect(text).toContain("clear: true");
  });

  it("报错比最后一次写文件还老 = 可能早修好了，只能提醒，不能当成新问题", () => {
    const text = describeRuntimeErrors(
      [err("2026-08-27T01:00:00.000Z", "老早以前的错")],
      "2026-08-27T01:30:00.000Z",
      NOW
    );
    expect(text).toContain("可能已经修好");
    expect(text).not.toContain("现在打不开或跑不动");
  });

  it("堆栈只留最上面三行——再往下全是运行库的帧，占地方还没用", () => {
    const text = describeRuntimeErrors(
      [err("2026-08-27T01:50:00.000Z", "炸了", { stack: "a\nb\nc\nd\ne" })],
      "2026-08-27T01:40:00.000Z",
      NOW
    );
    expect(text).toContain("a");
    expect(text).toContain("c");
    expect(text).not.toContain("\n     d");
  });

  it("最多贴六条——再多是同一个坏页面的回声，只会挤掉真正有用的上下文", () => {
    const many = Array.from({ length: 12 }, (_, i) => err("2026-08-27T01:50:00.000Z", `错 ${i}`));
    const text = describeRuntimeErrors(many, "2026-08-27T01:40:00.000Z", NOW);
    expect(text).toContain("错 5");
    expect(text).not.toContain("错 6");
  });
});

describe("哪些报错算「上一轮把作品写炸了」", () => {
  const list = [
    err("2026-08-27T01:50:00.000Z", "新的"),
    err("2026-08-27T01:10:00.000Z", "旧的"),
  ];

  it("只算写文件之后抛的那些", () => {
    const fresh = freshRuntimeErrors(list, "2026-08-27T01:30:00.000Z");
    expect(fresh.map((e) => e.message)).toEqual(["新的"]);
  });

  it("拿不到写文件的时间就一条都不算——宁可漏，不可冤", () => {
    expect(freshRuntimeErrors(list, undefined)).toEqual([]);
    expect(freshRuntimeErrors(list, "不是个时间")).toEqual([]);
  });
});
