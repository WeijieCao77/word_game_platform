import { describe, it, expect } from "vitest";
import { HISTORY_BUDGET_CHARS, MAX_TURN_CHARS, MIN_TURNS, Turn, trimHistory } from "@/lib/ai/history";

const say = (n: number, who: "user" | "assistant" = "user"): Turn => ({ role: who, content: "字".repeat(n) });

/**
 * 老板问过「我只是七轮对话就用了四十多万 token，这对吗」。不对。
 * 其中一条是历史按**条数**截：最近 24 条 × 每条 8000 字符 = 每轮最坏重发 19 万字符。
 * 连续搭建之后更要紧——一次请求跑二十轮，就是二十次重发。
 */
describe("对话历史按字符数截，不按条数", () => {
  it("短对话原样带上，一个字都不该丢", () => {
    const h = [say(10), say(20, "assistant"), say(30)];
    expect(trimHistory(h)).toEqual(h);
  });

  it("超预算就从**前面**丢——最近的话最有用", () => {
    const h = [say(100), say(100), say(100), say(100), say(100), say(100)];
    const kept = trimHistory(h, 250, 1);
    expect(kept).toHaveLength(2); // 250 装得下两条 100，第三条会超
    expect(kept.every((t) => t.content.length === 100)).toBe(true);
  });

  it("一条巨长的消息不许把整个预算吃光——单条先截到上限", () => {
    const kept = trimHistory([say(500), say(MAX_TURN_CHARS * 3)], 999_999);
    expect(kept[1].content.length).toBe(MAX_TURN_CHARS);
  });

  it("预算再紧也要保底留几条，不然一句上下文都不剩", () => {
    const h = Array.from({ length: 10 }, () => say(MAX_TURN_CHARS));
    const kept = trimHistory(h, 100); // 预算只够零点几条
    expect(kept).toHaveLength(MIN_TURNS);
    // 保底留的是**最后**那几条
    expect(kept[kept.length - 1]).toEqual(h[h.length - 1]);
  });

  it("比条数截省得多：二十条长回复，字符预算能砍掉一大半", () => {
    const h = Array.from({ length: 24 }, () => say(MAX_TURN_CHARS));
    const byCount = h.reduce((n, t) => n + t.content.length, 0); // 旧做法：全带上
    const byChars = trimHistory(h).reduce((n, t) => n + t.content.length, 0);
    expect(byCount).toBe(24 * MAX_TURN_CHARS);
    expect(byChars).toBeLessThanOrEqual(HISTORY_BUDGET_CHARS + MAX_TURN_CHARS);
    expect(byChars).toBeLessThan(byCount / 2);
  });

  it("空历史不炸", () => {
    expect(trimHistory([])).toEqual([]);
  });

  it("角色原样保留——把 assistant 说成 user 会让模型彻底乱套", () => {
    const kept = trimHistory([say(10, "assistant"), say(10, "user")], 1000, 1);
    expect(kept.map((t) => t.role)).toEqual(["assistant", "user"]);
  });
});
