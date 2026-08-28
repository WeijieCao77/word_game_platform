import { describe, it, expect } from "vitest";
import { errorDetail, explainAiFailure } from "@/lib/ai/failure";

/**
 * 起因是一次真事故：作者发了一句「把采信簿从推理结论改成物理陈述」，
 * 等了一会儿，对话里冒出来一行 **`⚠ terminated`**——就这一个词。
 * 没有原因、没有下一步、也不知道那一轮是不是白花了。
 *
 * 三处叠在一起：
 *   1. `terminated` 是 Node 的 fetch（undici）抛的原话，真正的原因在 `err.cause` 里
 *   2. 调用方只取了 `err.message`，**cause 整个丢了**
 *   3. `explainAiFailure` 的网络分支认 timeout/socket，**偏偏不认 terminated**
 *
 * 这两个函数原来是路由文件里的私有函数，一行都测不到。
 * 而「错误信息说得清不清楚」恰恰是最该被测的东西之一——
 * 作者拿着一个 `terminated` 什么也做不了。
 */

describe("摊平 cause 链", () => {
  it("undici 那个只有一个词的错误，要把起因带出来", () => {
    // 这就是线上那一个：message 只有 "terminated"，全部信息在 cause 上
    const cause = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
    const err = Object.assign(new TypeError("terminated"), { cause });

    const d = errorDetail(err);
    expect(d).toContain("terminated");
    expect(d).toContain("other side closed");
    expect(d).toContain("UND_ERR_SOCKET");
  });

  it("code 也要带上——ECONNRESET 这种只有 code 没有话的错误最常见", () => {
    const err = Object.assign(new Error("read"), { code: "ECONNRESET" });
    expect(errorDetail(err)).toContain("ECONNRESET");
  });

  it("message 里已经有 code 了就不重复说一遍", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:443"), { code: "ECONNREFUSED" });
    const d = errorDetail(err);
    expect(d.match(/ECONNREFUSED/g)?.length).toBe(1);
  });

  it("没有 cause 的普通错误照旧就是那句话", () => {
    expect(errorDetail(new Error("AI 服务返回 429：too many requests"))).toBe(
      "AI 服务返回 429：too many requests"
    );
  });

  it("套很多层也不会无限递归", () => {
    let err: Error = new Error("最里面");
    for (let i = 0; i < 20; i++) err = Object.assign(new Error(`第 ${i} 层`), { cause: err });
    expect(() => errorDetail(err)).not.toThrow();
    expect(errorDetail(err).length).toBeLessThan(500);
  });

  it("扔进来的不是 Error 也不能炸", () => {
    expect(errorDetail("就是一句话")).toBe("就是一句话");
    expect(errorDetail(null)).toBe("");
    expect(errorDetail(undefined)).toBe("");
  });
});

describe("翻译成作者能行动的话", () => {
  it("**terminated 必须被认出来**——这就是那次事故", () => {
    const text = explainAiFailure("terminated（起因：other side closed / UND_ERR_SOCKET）");
    // 光把这个词原样吐出来等于没说
    expect(text).not.toBe("terminated（起因：other side closed / UND_ERR_SOCKET）");
    expect(text).toContain("传到一半断了");
    // 作者最想知道的两件事：已经改的丢没丢、我下一步干什么
    expect(text).toContain("不会丢");
    expect(text).toContain("重发");
  });

  it("同一类的几种写法都要认得", () => {
    for (const d of [
      "TypeError: terminated",
      "socket hang up",
      "read ECONNRESET",
      "Premature close",
      "UND_ERR_SOCKET",
    ]) {
      expect(explainAiFailure(d), `没认出来：${d}`).toContain("传到一半断了");
    }
  });

  it("「传到一半断了」跟「连不上」说的话不一样", () => {
    // 排序很要紧：terminated 里不含 timeout/socket 这些词，
    // 但反过来 socket hang up 里含 socket——不排在前面就会被归错类
    expect(explainAiFailure("connect ETIMEDOUT")).toContain("超时");
    expect(explainAiFailure("socket hang up")).toContain("传到一半断了");
  });

  it("原来就认得的那几类不能改坏", () => {
    expect(explainAiFailure("context_length_exceeded")).toContain("上下文上限");
    expect(explainAiFailure("max_tokens is too large")).toContain("单次输出上限");
    expect(explainAiFailure("429 rate limit reached")).toContain("限流");
    expect(explainAiFailure("401 invalid api key")).toContain("密钥失效");
  });

  it("每一类都要带上原始错误，方便回头查日志", () => {
    for (const d of ["terminated", "connect ETIMEDOUT", "429 rate limit"]) {
      expect(explainAiFailure(d)).toContain(d);
    }
  });

  it("认不出来的照旧原样给出去，但不能给空", () => {
    expect(explainAiFailure("某种没见过的错")).toBe("某种没见过的错");
    expect(explainAiFailure("")).toBe("AI 请求失败");
  });
});
