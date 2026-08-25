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

/**
 * 管理员兜底：可选环境变量 ADMIN_USERS（逗号分隔用户名）里的账号，登录时自动提升为管理员。
 * 正常情况用不到——平台第一个注册者就是管理员；这是「管理员位被别人抢注了」时的自救通道。
 */
export function applyAdminAllowlist(username: string, userId: string, role: "user" | "admin"): "user" | "admin" {
  const list = (process.env.ADMIN_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (role === "admin" || !list.includes(username)) return role;
  getStore().userSetRole(userId, "admin");
  return "admin";
}

export function ipOf(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * 编辑权：编辑钥匙对得上，或者已登录且是这部作品的归属人。
 * 两条路并存——游客靠钥匙，注册用户靠账号，换设备也不丢。
 */
export function canEditGame(req: NextRequest, gameId: string): boolean {
  const store = getStore();
  if (store.checkEditKey(gameId, req.headers.get("x-edit-key") ?? "")) return true;
  const user = currentUser(req);
  return !!user && store.gameOwner(gameId) === user.id;
}

/** AI 配额的计数口径：登录用账号，游客用编辑钥匙 */
export function quotaKeyOf(req: NextRequest, fallback: string): string {
  const user = currentUser(req);
  return user ? `u:${user.id}` : fallback;
}
