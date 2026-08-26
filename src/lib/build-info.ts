import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 线上正在跑哪个版本。
 *
 * 这东西存在的理由写在 CLAUDE.md 里：「代码改了、线上没变」这类事故要先能判断，
 * 而判断的唯一办法是让服务自己报出它是从哪个 commit 构建的。
 *
 * 麻烦在于这个项目有**两条部署路子**，只有一条带得上 git 元数据：
 *   1. Railway 自己的 GitHub 集成 —— 会注入 RAILWAY_GIT_COMMIT_SHA
 *   2. Actions 里的 `railway up` —— 上传的是目录，Railway 那边根本不知道 git 是什么，
 *      于是 sha 是空的，健康检查只能报 unknown
 *
 * 第 10 次实测就栽在这上面：等部署的 gate 盯着 sha 等了十分钟，等到的一直是 unknown
 * ——服务其实好好的，只是那一次上线走的是第 2 条路。所以补第二个来源：
 * CI 在构建前把 sha 写进 public/build.json，运行时读它。
 */

let cached: string | null = null;

export function buildCommit(): string {
  if (cached !== null) return cached;
  const env =
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.APP_COMMIT ??
    "";
  if (env) return (cached = env.slice(0, 7));
  try {
    const raw = readFileSync(join(process.cwd(), "public/build.json"), "utf8");
    const commit = String((JSON.parse(raw) as { commit?: unknown }).commit ?? "");
    // 仓库里那份占位的写着 dev，别把它当成真的版本号报出去
    if (commit && commit !== "dev") return (cached = commit.slice(0, 7));
  } catch {
    /* 没有这个文件是正常的（本地开发） */
  }
  return (cached = "unknown");
}
