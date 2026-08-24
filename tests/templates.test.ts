import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateGameConfig } from "@/lib/schema";
import { simulate } from "@/lib/simulate";

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

  it("模拟 600 局：无运行时错误，全部正常结束", () => {
    const r = validateGameConfig(raw);
    const report = simulate(r.config!, 600, 2024);
    expect(report.errors).toEqual([]);
    expect(report.endings["__unfinished__"]).toBeUndefined();
  });

  it("模拟 600 局：每个结局都能触发（无不可达结局）", () => {
    const r = validateGameConfig(raw);
    const report = simulate(r.config!, 600, 2024);
    expect(report.unreachedEndings).toEqual([]);
  });

  it("模拟 600 局：每张卡都出现过（无死内容）", () => {
    const r = validateGameConfig(raw);
    const report = simulate(r.config!, 600, 2024);
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

  it("模拟 400 局：无错误，四个结局全部可达", () => {
    const r = validateGameConfig(raw);
    const report = simulate(r.config!, 400, 7);
    expect(report.errors).toEqual([]);
    expect(report.unreachedEndings).toEqual([]);
    expect(report.unfiredCards).toEqual([]);
  });
});
