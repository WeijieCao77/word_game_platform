import { describe, it, expect } from "vitest";
import { KEEP_GOING, MAX_AUTO_ROUNDS, clampRounds, runRounds, Turn } from "@/lib/ai/auto-build";

/**
 * 连续搭建。
 *
 * 老板问「为什么做出来的游戏和 VAL MANAGER 差距这么大」，最大的一条是算术：
 * 实测最好的一次 12 轮搭到约 4,500 行，而原作是 13,132 行——照同样效率要三四十轮。
 * 而工作台里靠人一句句说「继续」，一次坐下最多几轮。
 *
 * 这一层把「你陪着熬」换成「你去忙别的，回来看」。但它是个会自己烧额度的东西，
 * 所以三个出口每一个都得真的会走到。
 */
describe("连续搭建：AI 照剩余清单自己往下跑", () => {
  const start: Turn[] = [{ role: "user", content: "照说明书开搭" }];
  const echo = (n: number) => async () => ({ reply: `第 ${n} 轮做完了` });

  it("要几轮跑几轮，最后一轮的结果原样交出去", async () => {
    let seen = 0;
    const r = await runRounds({
      rounds: 4,
      history: start,
      runOne: async () => ({ reply: `r${++seen}` }),
    });
    expect(seen).toBe(4);
    expect(r.roundsRun).toBe(4);
    expect(r.reply).toBe("r4");
    expect(r.stoppedBecause).toBeUndefined();
  });

  it("每一轮之间替作者说「接着做」，而且明说不许反问要不要继续", async () => {
    const seen: Turn[][] = [];
    await runRounds({
      rounds: 3,
      history: start,
      runOne: async (h, n) => {
        seen.push(h);
        return echo(n)();
      },
    });
    // 第二轮看到的历史 = 原话 + 上一轮的回复 + 那句「接着做」
    expect(seen[1].map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(seen[1][2].content).toBe(KEEP_GOING);
    expect(KEEP_GOING).toContain("不要问我要不要继续");
    // 第三轮接着长
    expect(seen[2]).toHaveLength(5);
    expect(seen[2][1].content).toBe("第 1 轮做完了");
  });

  it("作者按「放弃这一轮」→ 下一轮不开，并说清停在第几轮", async () => {
    let ran = 0;
    let live = true;
    const r = await runRounds({
      rounds: 10,
      history: start,
      alive: () => live,
      runOne: async () => {
        ran += 1;
        if (ran === 2) live = false; // 第二轮跑的途中作者收手
        return { reply: "ok" };
      },
    });
    expect(ran).toBe(2);
    expect(r.roundsRun).toBe(2);
    expect(r.stoppedBecause).toContain("中止");
    expect(r.stoppedBecause).toContain("第 2 轮");
  });

  it("额度不够就停，不许一路烧下去", async () => {
    let ran = 0;
    const r = await runRounds({
      rounds: 10,
      history: start,
      quotaBlocked: () => (ran >= 3 ? "今日额度已用完" : null),
      runOne: async () => {
        ran += 1;
        return { reply: "ok" };
      },
    });
    expect(ran).toBe(3);
    expect(r.roundsRun).toBe(3);
    expect(r.stoppedBecause).toContain("额度不够");
    expect(r.stoppedBecause).toContain("今日额度已用完");
  });

  it("第一轮不查额度——入口已经查过了，这里查会白白少跑一轮", async () => {
    let asked = 0;
    await runRounds({
      rounds: 1,
      history: start,
      quotaBlocked: () => {
        asked += 1;
        return "不该被问到";
      },
      runOne: async () => ({ reply: "ok" }),
    });
    expect(asked).toBe(0);
  });

  it("历史不会无限长——连搭二十轮也不能把上下文撑爆", async () => {
    let longest = 0;
    await runRounds({
      rounds: 20,
      history: start,
      trim: (h) => h.slice(-8),
      runOne: async (h) => {
        longest = Math.max(longest, h.length);
        return { reply: "ok" };
      },
    });
    expect(longest).toBeLessThanOrEqual(8);
  });

  it("默认就按字符预算裁——二十轮下来历史不该无限膨胀", async () => {
    let longestChars = 0;
    await runRounds({
      rounds: 20,
      history: start,
      runOne: async (h) => {
        longestChars = Math.max(longestChars, h.reduce((n, t) => n + t.content.length, 0));
        return { reply: "回".repeat(6000) }; // 每轮都吐一大段
      },
    });
    expect(longestChars).toBeLessThan(60_000);
  });

  it("轮数会夹住：不合法的、负的、超上限的都要变成能跑的数", () => {
    expect(clampRounds(1)).toBe(1);
    expect(clampRounds(10)).toBe(10);
    expect(clampRounds(0)).toBe(1);
    expect(clampRounds(-5)).toBe(1);
    expect(clampRounds(9999)).toBe(MAX_AUTO_ROUNDS);
    expect(clampRounds("abc")).toBe(1);
    expect(clampRounds(undefined)).toBe(1);
    expect(clampRounds(3.9)).toBe(3);
  });

  it("某一轮抛错要往上抛，不能吞掉当成搭完了", async () => {
    await expect(
      runRounds({
        rounds: 5,
        history: start,
        runOne: async (_h, n) => {
          if (n === 2) throw new Error("AI 服务限流了");
          return { reply: "ok" };
        },
      })
    ).rejects.toThrow("限流");
  });
});
