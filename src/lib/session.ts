import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getStore } from "@/lib/store";
import { SESSION_COOKIE, SESSION_MAX_AGE, newSessionToken, sessionTokenHash } from "@/lib/auth";
import { UserRecord } from "@/lib/store/types";

// 「当前是谁」的唯一入口。路由用 currentUser(req)，服务端页面用 currentUserFromCookies()。
// 没登录一律返回 null——游客是平台的一等公民，不是错误状态。

export function currentUser(req: NextRequest): UserRecord | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getStore().sessionUser(sessionTokenHash(token));
}

export async function currentUserFromCookies(): Promise<UserRecord | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getStore().sessionUser(sessionTokenHash(token));
}

/** 登录成功：发会话 cookie（httpOnly，浏览器脚本读不到） */
export function startSession(res: NextResponse, userId: string): void {
  const { token, tokenHash, expiresAt } = newSessionToken();
  getStore().sessionCreate(userId, tokenHash, expiresAt);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function endSession(req: NextRequest, res: NextResponse): void {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) getStore().sessionDelete(sessionTokenHash(token));
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

// 登录限频：同一 IP 连续失败 8 次后冷却 15 分钟，挡住撞库脚本（内存计数，多实例时换 Redis）
const fails = new Map<string, { n: number; until: number }>();
const MAX_FAILS = 8;
const COOL_MS = 15 * 60 * 1000;

export function loginBlocked(ip: string): boolean {
  const rec = fails.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.until) {
    fails.delete(ip);
    return false;
  }
  return rec.n >= MAX_FAILS;
}

export function noteLoginFail(ip: string): void {
  const rec = fails.get(ip);
  if (rec && Date.now() <= rec.until) rec.n += 1;
  else fails.set(ip, { n: 1, until: Date.now() + COOL_MS });
  if (fails.size > 10000) fails.clear();
}

export function clearLoginFails(ip: string): void {
  fails.delete(ip);
}

export function ipOf(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
