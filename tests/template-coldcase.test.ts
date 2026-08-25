import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateGameConfig } from "@/lib/schema";
import { simulate } from "@/lib/simulate";
import { initState, choose, notebookItems } from "@/lib/engine";

function load(name: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, "..", "templates", name), "utf8"));
}
// 为什么拆成几个文件：worker 与主进程之间的心跳（onTaskUpdate）硬编码 60 秒超时，
// 而模板体检是纯 CPU 的长任务。几条重的挤在同一个文件里，那个 worker 连着
// 阻塞一百多秒，心跳答不上来，vitest 就抛一条 unhandled error——用例全绿、
// 进程却退 1，CI 判失败。按耗时拆开，单个文件不再连续占住 worker 超过一分钟。

describe("官方示例：他不是自己掉下去的（story 社会派推理，含关键词输入门）", () => {
  const raw = load("coldcase-demo.json");

  it("通过结构 + 语义校验，无错误无警告；至少 2 处关键词输入门", () => {
    const r = validateGameConfig(raw);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "warning")).toEqual([]);
    const inputs = (raw as { cards: { input?: unknown }[] }).cards.filter((c) => c.input).length;
    expect(inputs).toBeGreaterThanOrEqual(2);
  });

  it("模拟 600 局：无错误，全结局可达，全卡片触发", { timeout: 120000 }, () => {
    const r = validateGameConfig(raw);
    const report = simulate(r.config!, 600, 88);
    expect(report.errors).toEqual([]);
    expect(report.endings["__unfinished__"]).toBeUndefined();
    expect(report.unreachedEndings).toEqual([]);
    expect(report.unfiredCards).toEqual([]);
  });

  it("采访本开局是空的，读完序章那封信才入本", () => {
    // 以前这三条（死者、信封、案发那晚）没有解锁条件，开局就摆在本子上，
    // 玩家重开一局看见三条线索，第一反应是「上一局的存档没清干净」。
    const config = validateGameConfig(raw).config!;
    let state = initState(config, 1);
    expect(notebookItems(config, state)).toHaveLength(0);

    state = choose(config, state, "摸信封口");
    const after = notebookItems(config, state).map((n) => n.id);
    expect(after).toContain("nb_程小满");
    expect(after).toContain("nb_信封");
    expect(after).toContain("nb_时间线_那一夜");
  });

});
