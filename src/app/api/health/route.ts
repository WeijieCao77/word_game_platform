import { NextResponse } from "next/server";
import { aiConfigured, aiRuntimeInfo } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

// 运维健康检查：确认服务活着 + 当前 AI 供应商/模型（只报名字，绝不含密钥）。
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    ai: { configured: aiConfigured(), ...aiRuntimeInfo() },
  });
}
