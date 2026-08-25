import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { verifyPassword } from "@/lib/auth";
import { clearLoginFails, ipOf, loginBlocked, noteLoginFail, startSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = ipOf(req);
  if (loginBlocked(ip)) {
    return NextResponse.json({ error: "登录失败次数太多，请 15 分钟后再试" }, { status: 429 });
  }
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  const user = getStore().userByName(username);
  // 用户名不存在与密码错误给同一句提示，不泄露「这个账号存在」
  if (!user || !verifyPassword(password, { hash: user.passwordHash, salt: user.salt })) {
    noteLoginFail(ip);
    return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
  }
  clearLoginFails(ip);
  const res = NextResponse.json({ user: { username: user.username, role: user.role } });
  startSession(res, user.id);
  return res;
}
