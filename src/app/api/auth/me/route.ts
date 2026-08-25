import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** 当前登录者；游客返回 user: null（不是错误） */
export function GET(req: NextRequest): NextResponse {
  const user = currentUser(req);
  return NextResponse.json({ user: user ? { username: user.username, role: user.role } : null });
}
