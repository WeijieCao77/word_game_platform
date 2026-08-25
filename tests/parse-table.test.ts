import { describe, expect, it } from "vitest";
import { isNumericColumn, parseDelimited, parseJsonTable, parseTable, toId, toNumber } from "@/components/editor/data/parse";

describe("表格解析（作者导入的 CSV / TSV / JSON）", () => {
  it("基本 CSV：首行当表头，尾随空行忽略", () => {
    const t = parseDelimited("选手,KDA,评分\n一诺,4.2,1.31\n花海,3.1,1.12\n\n");
    expect(t.columns).toEqual(["选手", "KDA", "评分"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]).toEqual({ 选手: "花海", KDA: "3.1", 评分: "1.12" });
  });

  it("引号里的逗号、换行与双引号转义都不会切错", () => {
    const t = parseDelimited('名字,简介\n"张,三","他说""你好""\n第二行"\n李四,普通');
    expect(t.rows[0]["名字"]).toBe("张,三");
    expect(t.rows[0]["简介"]).toBe('他说"你好"\n第二行');
    expect(t.rows[1]["名字"]).toBe("李四");
  });

  it("认得制表符与分号分隔，也吃掉 BOM 和 CRLF", () => {
    expect(parseDelimited("﻿a\tb\r\n1\t2\r\n").rows[0]).toEqual({ a: "1", b: "2" });
    expect(parseDelimited("a;b\n1;2").columns).toEqual(["a", "b"]);
  });

  it("空表头补名字，重名列自动区分", () => {
    const t = parseDelimited("名字,,名字\n甲,乙,丙");
    expect(t.columns).toEqual(["名字", "列2", "名字_2"]);
    expect(t.rows[0]["名字_2"]).toBe("丙");
  });

  it("行数超上限会截断并标记", () => {
    const rows = Array.from({ length: 600 }, (_, i) => `选手${i},${i}`).join("\n");
    const t = parseDelimited(`名字,战力\n${rows}`);
    expect(t.rows).toHaveLength(500);
    expect(t.truncated).toBe(true);
  });

  it("JSON 对象数组：并集取列，缺失补空", () => {
    const t = parseJsonTable('[{"名字":"甲","战力":90},{"名字":"乙","潜力":80}]');
    expect(t.columns).toEqual(["名字", "战力", "潜力"]);
    expect(t.rows[1]).toEqual({ 名字: "乙", 战力: "", 潜力: "80" });
  });

  it("JSON 二维数组：首行当表头", () => {
    const t = parseJsonTable('[["名字","战力"],["甲",90]]');
    expect(t.columns).toEqual(["名字", "战力"]);
    expect(t.rows).toEqual([{ 名字: "甲", 战力: "90" }]);
  });

  it("parseTable 按内容/扩展名自动选解析器", () => {
    expect(parseTable('[{"a":1}]').columns).toEqual(["a"]);
    expect(parseTable("a,b\n1,2").columns).toEqual(["a", "b"]);
    expect(parseTable('[["a"],["1"]]', "x.json").rows[0]).toEqual({ a: "1" });
  });

  it("数值列识别：允许少量脏数据与千分位、百分号", () => {
    const rows = [{ a: "1", b: "甲" }, { a: "2,300", b: "乙" }, { a: "12%", b: "3" }, { a: "缺", b: "丙" }];
    expect(isNumericColumn(rows, "a")).toBe(true);
    expect(isNumericColumn(rows, "b")).toBe(false);
    expect(toNumber("2,300")).toBe(2300);
    expect(toNumber("不是数字")).toBe(0);
  });

  it("中文列名能转成合法 id 且不重复", () => {
    const used = new Set<string>();
    expect(toId("枪法 (评分)", used)).toBe("枪法_评分");
    expect(toId("枪法 (评分)", used)).toBe("枪法_评分_2");
    expect(toId("", used)).toBe("字段");
  });

  it("空输入不炸", () => {
    expect(parseDelimited("   ").rows).toEqual([]);
    expect(parseJsonTable("[]").rows).toEqual([]);
  });
});

// —— 分批写配置（patch_config 的合并语义）——
import { GameConfigSchema } from "@/lib/schema";

describe("分批写配置：追加与去重", () => {
  const base = {
    schemaVersion: 1,
    meta: { title: "分批测试" },
    driver: { kind: "sim", time: { turnLabel: "周", maxCycles: 3 } },
    vars: [{ id: "资金", name: "资金", initial: 10 }],
    cards: [{ id: "开场", weight: 1, text: "新的一周。" }],
    endings: [{ id: "完", title: "完", kind: "neutral", condition: "turn >= 3" }],
    entityTypes: [{ id: "选手", name: "选手", attributes: [{ id: "枪法", name: "枪法" }] }],
    entities: [{ id: "a", type: "选手", name: "甲", attrs: { 枪法: 80 } }],
  };

  it("追加保留原有条目，同 id 后来居上", () => {
    const before = GameConfigSchema.parse(base);
    const incoming = [
      { id: "a", type: "选手", name: "甲", attrs: { 枪法: 95 } },
      { id: "b", type: "选手", name: "乙", attrs: { 枪法: 70 } },
    ];
    const byId = new Map<string, Record<string, unknown>>();
    for (const it of [...(before.entities ?? []), ...incoming] as Record<string, unknown>[]) {
      byId.set(String(it.id), it);
    }
    const merged = GameConfigSchema.parse({ ...before, entities: [...byId.values()] });
    expect(merged.entities).toHaveLength(2);
    expect(merged.entities?.find((e) => e.id === "a")?.attrs["枪法"]).toBe(95);
    expect(merged.entities?.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("结构不合法的一批会被 zod 挡住（不落盘）", () => {
    const bad = GameConfigSchema.safeParse({ ...base, entities: [{ id: "x", name: "缺 type" }] });
    expect(bad.success).toBe(false);
  });
});
