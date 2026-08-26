import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteGameStore } from "@/lib/store/sqlite";

const MINI_CONFIG = {
  schemaVersion: 1,
  meta: { title: "任务测试" },
  driver: { kind: "life", time: { label: "年", start: 0, step: 1, max: 3 } },
  vars: [],
  cards: [{ id: "c1", weight: 1, text: "……" }],
  endings: [],
};

function newStore(): SqliteGameStore {
  const dir = mkdtempSync(path.join(tmpdir(), "wgp-jobs-"));
  return new SqliteGameStore(path.join(dir, "test.db"));
}

/**
 * 异步 AI 任务的存储层。
 *
 * 为什么要落库而不是放内存：容器随时可能重启，重启之后前端还得问得到
 * 「我刚才那一轮怎么样了」。这也是 502 根治的地基——请求立刻返回，
 * 活在后台跑，单轮时间不再受网关脸色。
 */
describe("AI 任务（异步跑一轮对话）", () => {
  it("开一条任务，能查到、能收尾，结果原样取回", () => {
    const store = newStore();
    const { id } = store.create({ config: MINI_CONFIG });
    expect(store.jobCreate(id, "job1")).toBe(true);

    const running = store.jobRunning(id);
    expect(running?.id).toBe("job1");
    expect(running?.status).toBe("running");

    store.jobNote("job1", "正在写 game.js…");
    expect(store.jobGet("job1")?.note).toBe("正在写 game.js…");

    store.jobDone("job1", { reply: "搭好了", filesChanged: true });
    const done = store.jobGet("job1");
    expect(done?.status).toBe("done");
    expect((done?.result as { reply: string }).reply).toBe("搭好了");
    // 收尾之后不再算「在跑」，创作者可以发下一句
    expect(store.jobRunning(id)).toBeNull();
  });

  it("同一部作品同时只允许一条在跑——两轮并发改同一份配置只会互相覆盖", () => {
    const store = newStore();
    const { id } = store.create({ config: MINI_CONFIG });
    expect(store.jobCreate(id, "a")).toBe(true);
    expect(store.jobCreate(id, "b")).toBe(false);
    store.jobDone("a", {});
    expect(store.jobCreate(id, "b")).toBe(true);
  });

  it("不同作品互不干扰", () => {
    const store = newStore();
    const g1 = store.create({ config: MINI_CONFIG });
    const g2 = store.create({ config: MINI_CONFIG });
    expect(store.jobCreate(g1.id, "x")).toBe(true);
    expect(store.jobCreate(g2.id, "y")).toBe(true);
    expect(store.jobRunning(g1.id)?.id).toBe("x");
    expect(store.jobRunning(g2.id)?.id).toBe("y");
  });

  it("失败要留下能看懂的原因", () => {
    const store = newStore();
    const { id } = store.create({ config: MINI_CONFIG });
    store.jobCreate(id, "j");
    store.jobFail("j", "AI 服务限流了，等一两分钟再试。");
    const j = store.jobGet("j");
    expect(j?.status).toBe("error");
    expect(j?.error).toContain("限流");
    expect(store.jobRunning(id)).toBeNull();
  });

  it("重启导致的僵尸任务不会把作者永久锁住", () => {
    const store = newStore();
    const { id } = store.create({ config: MINI_CONFIG });
    store.jobCreate(id, "zombie");
    // 直接把心跳改成 40 分钟前，模拟「服务重启，任务再也没人推进」
    const old = new Date(Date.now() - 40 * 60_000).toISOString();
    (store as unknown as { db: { prepare: (q: string) => { run: (...a: unknown[]) => void } } }).db
      .prepare("UPDATE ai_jobs SET updated_at = ? WHERE id = ?")
      .run(old, "zombie");
    expect(store.jobRunning(id)).toBeNull(); // 判死
    expect(store.jobGet("zombie")?.status).toBe("error");
    expect(store.jobCreate(id, "fresh")).toBe(true); // 可以接着发下一句
  });

  it("每部作品只留最近 20 条任务，这张表不会无限长", () => {
    const store = newStore();
    const { id } = store.create({ config: MINI_CONFIG });
    for (let i = 0; i < 25; i++) {
      store.jobCreate(id, `j${i}`);
      store.jobDone(`j${i}`, {});
    }
    const kept = Array.from({ length: 25 }, (_, i) => store.jobGet(`j${i}`)).filter(Boolean);
    expect(kept.length).toBeLessThanOrEqual(20);
    expect(store.jobGet("j24")).not.toBeNull(); // 最新的一定在
  });
});
