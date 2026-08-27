import { describe, it, expect } from "vitest";
import {
  MAX_CODE_FILES,
  MAX_DATA_FILES,
  MAX_FILE,
  MAX_TOTAL_BYTES,
  checkFileBudget,
  dataNameOf,
  dataPathFromUpload,
  isDataFile,
} from "@/lib/file-budget";

// 老板问「我的数据文件 csv 有几十个怎么办」问出来的这本账。
// 原来代码和数据表共用 60 个名额，几十张表一传，AI 写代码的空间就被挤没了。

const code = (n: number, size = 1000): { path: string; size: number }[] =>
  Array.from({ length: n }, (_, i) => ({ path: `screens-${i}.js`, size }));
const data = (n: number, size = 1000): { path: string; size: number }[] =>
  Array.from({ length: n }, (_, i) => ({ path: `data/t${i}.csv`, size }));

describe("哪些算数据表", () => {
  it("data/ 下的才算", () => {
    expect(isDataFile("data/roster.csv")).toBe(true);
    expect(isDataFile("game.js")).toBe(false);
    // 名字里带 data 但不在 data/ 下的，不算——不然作者写个 metadata.js 就被归错账
    expect(isDataFile("metadata.js")).toBe(false);
  });
});

describe("两本账分开算", () => {
  it("代码文件满了，数据表照样传得进去", () => {
    const existing = code(MAX_CODE_FILES);
    expect(checkFileBudget(existing, "another.js", 100).ok).toBe(false);
    expect(checkFileBudget(existing, "data/roster.csv", 100).ok).toBe(true);
  });

  it("数据表满了，代码文件照样写得动", () => {
    const existing = data(MAX_DATA_FILES);
    expect(checkFileBudget(existing, "data/one-more.csv", 100).ok).toBe(false);
    expect(checkFileBudget(existing, "game.js", 100).ok).toBe(true);
  });

  it("几十张 csv 不该顶掉代码的名额（这就是老板问的那件事）", () => {
    const existing = [...code(9), ...data(40)];
    // 九个代码文件 + 四十张表，再写代码文件必须还行
    expect(checkFileBudget(existing, "screens-new.js", 5000).ok).toBe(true);
  });

  it("覆盖已有文件不占新名额", () => {
    const existing = data(MAX_DATA_FILES);
    expect(checkFileBudget(existing, "data/t0.csv", 200).ok).toBe(true);
  });
});

describe("单文件与总量两道闸门", () => {
  it("单个文件超上限直接拦", () => {
    const v = checkFileBudget([], "data/big.csv", MAX_FILE + 1);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("拆开");
  });

  it("总量超了要拦——放宽文件数就必须配一道总量闸门", () => {
    // 50 × 80 万 = 正好 40MB，再加一张就超
    const existing = data(50, 800_000);
    const v = checkFileBudget(existing, "data/new.csv", 300_000);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("MB");
  });

  it("覆盖同一个文件按差额算总量，不许越覆盖越大", () => {
    // 正好卡在上限：把其中一个 20 万的文件覆盖成同样 20 万，应当放行
    const each = 200_000;
    const n = Math.floor(MAX_TOTAL_BYTES / each);
    const existing = data(n, each);
    expect(checkFileBudget(existing, "data/t0.csv", each).ok).toBe(true);
    // 但覆盖成更大的就会超
    expect(checkFileBudget(existing, "data/t0.csv", each + 1).ok).toBe(false);
  });
});

describe("选整个文件夹传上来时的路径压平", () => {
  it("子目录压成横线，两个文件夹里的同名文件不会互相覆盖", () => {
    expect(dataPathFromUpload("teams/pacific.csv")).toBe("data/teams-pacific.csv");
    expect(dataPathFromUpload("players/pacific.csv")).toBe("data/players-pacific.csv");
    expect(dataPathFromUpload("teams/pacific.csv")).not.toBe(dataPathFromUpload("players/pacific.csv"));
  });

  it("没有子目录时就是文件名本身", () => {
    expect(dataPathFromUpload("roster.csv")).toBe("data/roster.csv");
  });

  it("穿越目录的段一律丢掉", () => {
    expect(dataPathFromUpload("../../etc/passwd.csv")).toBe("data/etc-passwd.csv");
    expect(dataPathFromUpload("./a/b.csv")).toBe("data/a-b.csv");
  });

  it("中文表名原样留住——取用名就是「队伍表」，不是一串哈希", () => {
    expect(dataPathFromUpload("队伍表.csv")).toBe("data/队伍表.csv");
    expect(dataNameOf(dataPathFromUpload("队伍表.csv"))).toBe("队伍表");
    // 早先一刀切成 ASCII，几十张中文名的表会全撞到 data/csv 这一个路径上
    expect(dataPathFromUpload("队伍表.csv")).not.toBe(dataPathFromUpload("选手表.csv"));
  });

  it("中文里夹的空格换成横线，中文本身不动", () => {
    expect(dataPathFromUpload("地图 表.csv")).toBe("data/地图-表.csv");
    expect(dataPathFromUpload("2026 赛季/队伍表.csv")).toBe("data/2026-赛季-队伍表.csv");
  });

  it("emoji 也算非 ASCII，照样留住", () => {
    expect(dataPathFromUpload("🎮表.csv")).toBe("data/🎮表.csv");
  });

  it("名字清完真的什么都不剩，才退回稳定短哈希兜底", () => {
    const p = dataPathFromUpload("---.csv");
    expect(p).toMatch(/^data\/t-[a-z0-9]+\.csv$/);
    // 兜底也要稳定、且不同输入不撞车
    expect(dataPathFromUpload("---.csv")).toBe(p);
    expect(dataPathFromUpload("___.csv")).not.toBe(p);
  });

  it("反斜杠当成路径分隔符（Windows 上选文件夹会是这个样子）", () => {
    expect(dataPathFromUpload("teams\\pacific.csv")).toBe("data/teams-pacific.csv");
  });

  it("没有扩展名就按 csv 收", () => {
    expect(dataPathFromUpload("roster")).toBe("data/roster.csv");
  });

  it("名字压平之后取用名跟着变，作者得照新名字取", () => {
    const p = dataPathFromUpload("teams/pacific.csv");
    expect(dataNameOf(p)).toBe("teams-pacific");
    expect(dataNameOf("data/roster.json")).toBe("roster");
  });
});
