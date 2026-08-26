import { describe, it, expect } from "vitest";
import { parseCsv, isDatasetPath, datasetSourcesFor, wrapDataset } from "../src/lib/dataset";

/**
 * 数据集要解决的是复刻 VAL MANAGER 那张卡点表的最后一条：
 * 78 支战队、518 名选手不该硬编在 js 里。
 * 表由作者上传或 AI 写成 csv，平台在 /play 下虚拟出孪生 js 给作品引用。
 */

describe("CSV 解析", () => {
  it("第一行当表头，数字自动当数字用", () => {
    const rows = parseCsv("name,rating,role\nTenZ,92,决斗\nChronicle,88,控场\n");
    expect(rows).toEqual([
      { name: "TenZ", rating: 92, role: "决斗" },
      { name: "Chronicle", rating: 88, role: "控场" },
    ]);
    expect(typeof rows[0].rating).toBe("number");
  });

  it("引号里的逗号、换行、双写引号都认", () => {
    const rows = parseCsv('name,note\n"张,三","他说""稳住"""\n"李四","第一行\n第二行"\n');
    expect(rows[0]).toEqual({ name: "张,三", note: '他说"稳住"' });
    expect(rows[1].note).toBe("第一行\n第二行");
  });

  it("\\r\\n 的表（Excel 存出来的）也认，BOM 不会粘进第一个列名", () => {
    const rows = parseCsv("﻿name,age\r\n甲,20\r\n乙,21\r\n");
    expect(Object.keys(rows[0])).toEqual(["name", "age"]);
    expect(rows.length).toBe(2);
  });

  it("空行跳过，列数少了补 null，多了截断——不因为一行坏掉整表报废", () => {
    const rows = parseCsv("a,b,c\n1,2,3\n\n4,5\n6,7,8,9\n");
    expect(rows).toEqual([
      { a: 1, b: 2, c: 3 },
      { a: 4, b: 5, c: null },
      { a: 6, b: 7, c: 8 },
    ]);
  });

  it("前导零的编号保持字符串，不会被吃成数字", () => {
    const rows = parseCsv("id,score\n007,1.5\n-3,0\n");
    expect(rows[0].id).toBe("007");
    expect(rows[0].score).toBe(1.5);
    expect(rows[1].id).toBe(-3);
    expect(rows[1].score).toBe(0);
  });

  it("true/false 照直译，空格子是 null", () => {
    const rows = parseCsv("name,starter,note\n甲,true,\n乙,false,备注\n");
    expect(rows[0]).toEqual({ name: "甲", starter: true, note: null });
    expect(rows[1].starter).toBe(false);
  });

  it("只有表头就是一张空表，空文本不炸", () => {
    expect(parseCsv("name,age\n")).toEqual([]);
    expect(parseCsv("")).toEqual([]);
  });

  it("518 条也扛得住，条数一条不差", () => {
    const lines = ["name,rating"];
    for (let i = 0; i < 518; i++) lines.push(`选手${i},${60 + (i % 40)}`);
    const rows = parseCsv(lines.join("\n"));
    expect(rows.length).toBe(518);
    expect(rows[517]).toEqual({ name: "选手517", rating: 60 + (517 % 40) });
  });
});

describe("孪生 js", () => {
  it("认得出哪条路径是数据表", () => {
    expect(isDatasetPath("data/roster.csv")).toBe(true);
    expect(isDatasetPath("data/teams.json")).toBe(true);
    expect(isDatasetPath("roster.csv")).toBe(false);
    expect(isDatasetPath("data/game.js")).toBe(false);
    expect(isDatasetPath("data/../secret.csv")).toBe(false);
  });

  it("data/roster.js 找的是 roster.csv 再 roster.json", () => {
    expect(datasetSourcesFor("data/roster.js")).toEqual({
      name: "roster",
      candidates: ["data/roster.csv", "data/roster.json"],
    });
    expect(datasetSourcesFor("data/roster.csv")).toBeNull();
    expect(datasetSourcesFor("game.js")).toBeNull();
  });

  it("包出来的是一段赋值语句，不用 fetch 也不用 eval", () => {
    const js = wrapDataset("roster", "data/roster.csv", "name,rating\nTenZ,92\n");
    expect(js).toContain("window.WGP_DATA");
    expect(/\bfetch\s*\(/.test(js)).toBe(false);
    expect(/\beval\s*\(/.test(js)).toBe(false);

    // 真跑一遍，看挂上去的东西对不对
    const win: Record<string, unknown> = {};
    new Function("window", "console", js)(win, console);
    expect((win.WGP_DATA as Record<string, unknown>).roster).toEqual([{ name: "TenZ", rating: 92 }]);
  });

  it("json 表原样挂上去", () => {
    const js = wrapDataset("teams", "data/teams.json", '[{"id":"drx","name":"DRX"}]');
    const win: Record<string, unknown> = {};
    new Function("window", "console", js)(win, console);
    expect((win.WGP_DATA as Record<string, unknown>).teams).toEqual([{ id: "drx", name: "DRX" }]);
  });

  it("json 坏了不让整部作品白屏：挂空表 + 控制台说清哪张表坏了", () => {
    const js = wrapDataset("teams", "data/teams.json", "{这不是 json");
    const win: Record<string, unknown> = {};
    const errs: string[] = [];
    new Function("window", "console", js)(win, { error: (m: string) => errs.push(m) });
    expect((win.WGP_DATA as Record<string, unknown>).teams).toEqual([]);
    expect(errs[0]).toContain("data/teams.json");
  });

  it("内容里带 </script> 或引号也不会把宿主页面拆了", () => {
    const js = wrapDataset("x", "data/x.csv", 'name\n"</script><b>坏事</b>"\n');
    const win: Record<string, unknown> = {};
    new Function("window", "console", js)(win, console);
    const rows = (win.WGP_DATA as Record<string, unknown>).x as Array<{ name: string }>;
    expect(rows[0].name).toBe("</script><b>坏事</b>");
    // JSON.stringify 会把 < 原样留着，但它是在 .js 文件里、不是内联 script，拆不了页面
    expect(js).toContain("WGP_DATA");
  });
});
