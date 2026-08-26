import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { aiConfigured, aiRuntimeInfo } from "@/lib/ai/provider";
import { buildCommit } from "@/lib/build-info";
import { guestDailyRequests, guestDailyTokens, userGrantDefault } from "@/lib/ai/quota";

export const dynamic = "force-dynamic";

/**
 * 这个进程的编号，启动时生成一次。
 *
 * 用途只有一个，但很要紧：**判断线上是不是跑了多个实例**。
 * 平台的数据存在容器本地的 SQLite 文件里——一旦有第二个实例，
 * 两边各写各的库：你在电脑上收录的作品落在 A，手机那次请求打到 B 就查无此人。
 * 连着问几次 /api/health，instance 变来变去就是这个毛病。
 */
const INSTANCE = randomUUID().slice(0, 8);
const STARTED_AT = new Date().toISOString();

// 运维健康检查：确认服务活着 + 当前 AI 供应商/模型（只报名字，绝不含密钥）
// + 线上正在跑哪个版本（Railway 会注入 commit sha，用来判断新代码有没有部署上去）。
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    ai: { configured: aiConfigured(), ...aiRuntimeInfo() },
    build: {
      commit: buildCommit(),
      // 连问几次：instance 变了 = 多实例，本地 SQLite 会被劈成两半（见上面的注释）
      instance: INSTANCE,
      startedAt: STARTED_AT,
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
