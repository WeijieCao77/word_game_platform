import { NextResponse } from "next/server";
import { aiConfigured, aiRuntimeInfo } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

// 运维健康检查：确认服务活着 + 当前 AI 供应商/模型（只报名字，绝不含密钥）
// + 线上正在跑哪个版本（Railway 会注入 commit sha，用来判断新代码有没有部署上去）。
export async function GET(): Promise<NextResponse> {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  return NextResponse.json({
    ok: true,
    ai: { configured: aiConfigured(), ...aiRuntimeInfo() },
    build: {
      commit: sha ? sha.slice(0, 7) : "unknown",
      // 配额上限一并报出来：看到这里还是 400000 就说明新代码没部署上去
      quota: {
        dailyRequests: Number(process.env.AI_DAILY_REQUESTS ?? 200),
        dailyTokens: Number(process.env.AI_DAILY_TOKENS ?? 1000000),
      },
    },
  });
}
