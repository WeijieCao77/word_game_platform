import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// 平台开发者后台数据。鉴权靠账号角色：平台的第一个注册者是管理员，
// 之后可由管理员提拔别人。不再依赖任何环境变量。

export function GET(req: NextRequest): NextResponse {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "这个页面只对管理员开放" }, { status: 403 });
  return NextResponse.json(getStore().adminStats());
}
