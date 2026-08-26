import { NextResponse } from "next/server";
import { aiConfigured, aiRuntimeInfo } from "@/lib/ai/provider";
import { buildCommit } from "@/lib/build-info";
import { guestDailyRequests, guestDailyTokens, userGrantDefault } from "@/lib/ai/quota";

export const dynamic = "force-dynamic";

// 运维健康检查：确认服务活着 + 当前 AI 供应商/模型（只报名字，绝不含密钥）
// + 线上正在跑哪个版本（Railway 会注入 commit sha，用来判断新代码有没有部署上去）。
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    ai: { configured: aiConfigured(), ...aiRuntimeInfo() },
    build: {
      commit: buildCommit(),
      // 配额上限一并报出来，报的必须是真实生效的闸门（此前读的是早已没人用的
      // AI_DAILY_* 遗留变量，报出来的数和实际拦截毫无关系，等于在骗运维）。
      // 规矩：游客 40 万/天、注册 200 万总量、管理员不限量。
      quota: {
        guestDailyRequests: guestDailyRequests(),
        guestDailyTokens: guestDailyTokens(),
        userGrant: userGrantDefault(),
      },
    },
  });
}
