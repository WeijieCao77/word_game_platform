import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { checkPassword, checkUsername, hashPassword } from "@/lib/auth";
import { ipOf, loginBlocked, noteLoginFail, startSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** 注册。平台的第一个注册者自动成为管理员（没有别人能给他授权）。 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = ipOf(req);
  if (loginBlocked(ip)) {
    return NextResponse.json({ error: "尝试太频繁了，请 15 分钟后再试" }, { status: 429 });
  }
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  const nameErr = checkUsername(username);
  if (nameErr) return NextResponse.json({ error: nameErr }, { status: 400 });
  const pwErr = checkPassword(password);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });

  const store = getStore();
  if (store.userByName(username)) {
    noteLoginFail(ip);
    return NextResponse.json({ error: "这个用户名已经有人用了" }, { status: 409 });
  }
  const { hash, salt } = hashPassword(password);
  const user = store.userCreate({ username, passwordHash: hash, salt });
  const res = NextResponse.json({ user: { username: user.username, role: user.role } });
  startSession(res, user.id);
  return res;
}
