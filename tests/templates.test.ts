import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateGameConfig } from "@/lib/schema";
import { simulate } from "@/lib/simulate";
import { initState, choose, notebookItems } from "@/lib/engine";

function load(name: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, "..", "templates", name), "utf8"));
}

describe("官方示例：修仙人生重开（life）", () => {
  const raw = load("life-demo.json");

  it("通过结构 + 语义校验，无错误无警告", () => {
    const r = validateGameConfig(raw);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "warning")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("模拟 600 局：无错误、正常结束、结局与卡片全可达", { timeout: 120000 }, () => {
    const r = validateGameConfig(raw);
    const report = simulate(r.config!, 600, 2024);
    expect(report.errors).toEqual([]);
    expect(report.endings["__unfinished__"]).toBeUndefined();
    expect(report.unreachedEndings).toEqual([]);
    expect(report.unfiredCards).toEqual([]);
  });
});

describe("官方示例：无畏契约经理（sim）", () => {
  const raw = load("sim-demo.json");

  it("通过结构 + 语义校验，无错误无警告", () => {
    const r = validateGameConfig(raw);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "warning")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("模拟 300 局：无错误、正常结束、王朝与生涯落幕可达、事件卡全部出现过", { timeout: 60000 }, () => {
    const r = validateGameConfig(raw);
    const report = simulate(r.config!, 300, 999);
    expect(report.errors).toEqual([]);
    expect(report.endings["__unfinished__"]).toBeUndefined();
    expect(report.endings["王朝"]?.count ?? 0).toBeGreaterThan(0);
    expect(report.endings["__implicit__"]?.count ?? 0).toBeGreaterThan(0);
    expect(report.unfiredCards).toEqual([]);
  });
});

describe("官方示例：整条巷子都知道我心动了（romance/story）", () => {
  const raw = load("romance-demo.json");

  it("通过结构 + 语义校验，无错误无警告", () => {
    const r = validateGameConfig(raw);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "warning")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("模拟 600 局：无错误，全部结局与卡片可达", { timeout: 60000 }, () => {
    const r = validateGameConfig(raw);
    const report = simulate(r.config!, 600, 20260824);
    expect(report.errors).toEqual([]);
    expect(report.endings["__unfinished__"]).toBeUndefined();
    expect(report.unreachedEndings).toEqual([]);
    expect(report.unfiredCards).toEqual([]);
  });
});

describe("官方示例：雨夜末班车（story）", () => {
  const raw = load("story-demo.json");

  it("通过结构 + 语义校验，无错误无警告", () => {
    const r = validateGameConfig(raw);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "warning")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("模拟 400 局：无错误，15 个结局全部可达", () => {
    const r = validateGameConfig(raw);
    const report = simulate(r.config!, 400, 7);
    expect(report.errors).toEqual([]);
    expect(report.unreachedEndings).toEqual([]);
    expect(report.unfiredCards).toEqual([]);
  });
});

describe("官方示例：栖雪山庄的第八位客人（story 本格推理）", () => {
  const raw = load("manor-demo.json");

  it("通过结构 + 语义校验，无错误无警告", () => {
    const r = validateGameConfig(raw);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "warning")).toEqual([]);
  });

  it("模拟 600 局：无错误，全结局可达，全卡片触发", { timeout: 120000 }, () => {
    const r = validateGameConfig(raw);
    const report = simulate(r.config!, 600, 88);
    expect(report.errors).toEqual([]);
    expect(report.endings["__unfinished__"]).toBeUndefined();
    expect(report.unreachedEndings).toEqual([]);
    expect(report.unfiredCards).toEqual([]);
  });
});

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

describe("官方示例：整栋实验楼都听见我心跳超频了（story 男频恋爱）", () => {
  const raw = load("romance-m-demo.json");

  it("通过结构 + 语义校验，无错误无警告", () => {
    const r = validateGameConfig(raw);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "warning")).toEqual([]);
  });

  it("模拟 600 局：无错误，全结局可达，全卡片触发", { timeout: 120000 }, () => {
    const r = validateGameConfig(raw);
    const report = simulate(r.config!, 600, 88);
    expect(report.errors).toEqual([]);
    expect(report.endings["__unfinished__"]).toBeUndefined();
    expect(report.unreachedEndings).toEqual([]);
    expect(report.unfiredCards).toEqual([]);
  });
});
