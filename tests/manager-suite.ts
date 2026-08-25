import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateGameConfig } from "@/lib/schema";
import { simulate } from "@/lib/simulate";

// 两款电竞经理的体检是同一套，只是模板文件不同。
//
// 为什么一款一个文件：worker 与主进程之间的心跳（onTaskUpdate）硬编码 60 秒超时，
// 而 600 局模拟是纯 CPU 的长任务，一款就要三十多秒。两款挤在一个文件里，
// 那个 worker 连着阻塞一分多钟，心跳答不上来，vitest 抛一条 unhandled error——
// 用例全绿、进程却退 1，CI 判失败。
export function managerTemplateSuite(name: string, file: string, minCards = 20): void {
  describe(`官方示例：${name}（sim 电竞经营，含羁绊/待办/季后赛）`, () => {
    const raw = JSON.parse(readFileSync(path.join(__dirname, "..", "templates", file), "utf8"));

    it("通过结构 + 语义校验，无错误无警告", () => {
      const r = validateGameConfig(raw);
      expect(r.issues.filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`)).toEqual([]);
      expect(r.issues.filter((i) => i.severity === "warning").map((i) => `${i.path}: ${i.message}`)).toEqual([]);
    });

    it("三个新模块都真的用上了：关系网、待办箱、淘汰赛对阵表", () => {
      const cfg = raw as { relations?: unknown[]; pendings?: unknown[]; brackets?: unknown[]; cards: unknown[] };
      expect(cfg.relations?.length ?? 0).toBeGreaterThan(0);
      expect(cfg.pendings?.length ?? 0).toBeGreaterThan(0);
      expect(cfg.brackets?.length ?? 0).toBeGreaterThan(0);
      expect(cfg.cards.length).toBeGreaterThanOrEqual(minCards);
    });

    it("模拟 600 局：无错误，全结局可达，无开局即死", { timeout: 120000 }, () => {
      const r = validateGameConfig(raw);
      const report = simulate(r.config!, 600, 77);
      expect(report.errors).toEqual([]);
      expect(report.unreachedEndings).toEqual([]);
      expect(report.earlyEndRate).toBeLessThanOrEqual(0.03);
    });
  });
}
