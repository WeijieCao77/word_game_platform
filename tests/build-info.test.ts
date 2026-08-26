import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * 「代码改了、线上没变」是这个项目真出过的事故（CLAUDE.md 记着），
 * 判断它的唯一依据就是服务自己报的 commit。所以这一行不能糊。
 *
 * 难点是有两条部署路子，只有一条带 git 元数据——第 10 次实测就因为
 * 走了不带元数据的那条，gate 盯着 unknown 白等十分钟。
 */

const orig = { ...process.env };
beforeEach(() => {
  vi.resetModules();
  process.env = { ...orig };
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.APP_COMMIT;
});
afterEach(() => {
  process.env = { ...orig };
  vi.restoreAllMocks();
});

describe("线上报的 commit", () => {
  it("Railway 注入了 sha 就用它，只取前 7 位", async () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = "059dc3a6cad4aafa4229424793393eef3b3c27c0";
    const { buildCommit } = await import("../src/lib/build-info");
    expect(buildCommit()).toBe("059dc3a");
  });

  it("APP_COMMIT 也认（自托管或别的平台）", async () => {
    process.env.APP_COMMIT = "abcdef1234567";
    const { buildCommit } = await import("../src/lib/build-info");
    expect(buildCommit()).toBe("abcdef1");
  });

  it("没有环境变量时退到 CI 写进去的 public/build.json —— 这就是补的那条路", async () => {
    vi.doMock("node:fs", () => ({ readFileSync: () => '{"commit":"3e8bf1d"}' }));
    const { buildCommit } = await import("../src/lib/build-info");
    expect(buildCommit()).toBe("3e8bf1d");
  });

  it("仓库里那份占位的 dev 不当成版本号报出去", async () => {
    vi.doMock("node:fs", () => ({ readFileSync: () => '{"commit":"dev"}' }));
    const { buildCommit } = await import("../src/lib/build-info");
    expect(buildCommit()).toBe("unknown");
  });

  it("文件读不到、内容坏掉都不炸，报 unknown", async () => {
    vi.doMock("node:fs", () => ({
      readFileSync: () => {
        throw new Error("ENOENT");
      },
    }));
    const { buildCommit } = await import("../src/lib/build-info");
    expect(buildCommit()).toBe("unknown");
  });
});
