import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// 平台开发者后台数据（仅限持 ADMIN_KEY 者）。
// ADMIN_KEY 在部署环境变量里配置（Railway Variables），不入库不进代码。

export async function GET(req: NextRequest): Promise<NextResponse> {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return NextResponse.json(
      { error: "开发者后台未启用：请在部署环境变量里设置 ADMIN_KEY（自定的一串口令）" },
      { status: 501 }
    );
  }
  if (req.headers.get("x-admin-key") !== adminKey) {
    return NextResponse.json({ error: "管理密钥不正确" }, { status: 403 });
  }
  return NextResponse.json(getStore().adminStats());
}
