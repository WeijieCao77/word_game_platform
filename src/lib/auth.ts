import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// 账号与会话的密码学部分——平台自己保管密码，所以这里的每一行都要经得起推敲。
//
// 密码：scrypt（Node 内置，无第三方依赖）+ 每人独立随机盐，永不存明文、永不可逆。
// 会话：随机 token 发给浏览器（httpOnly cookie），数据库只存它的 sha256——
//       即使库被拖走，也无法拿存量数据冒充任何人登录。

const SCRYPT_N = 16384;
const KEY_LEN = 64;
const SESSION_DAYS = 30;

export interface PasswordHash {
  hash: string;
  salt: string;
}

/** 注册/改密时调用：把明文口令变成不可逆的哈希 */
export function hashPassword(password: string): PasswordHash {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N }).toString("hex");
  return { hash, salt };
}

/** 登录校验：定时安全比较，避免用响应时间猜口令 */
export function verifyPassword(password: string, stored: PasswordHash): boolean {
  if (!stored.hash || !stored.salt) return false;
  let derived: Buffer;
  try {
    derived = scryptSync(password, stored.salt, KEY_LEN, { N: SCRYPT_N });
  } catch {
    return false;
  }
  const expected = Buffer.from(stored.hash, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

/** 会话令牌：明文只发给浏览器一次，数据库存指纹 */
export function newSessionToken(): { token: string; tokenHash: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  return { token, tokenHash: sessionTokenHash(token), expiresAt: expires.toISOString() };
}

export function sessionTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const SESSION_COOKIE = "wgp_session";
export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 3600;

/** 用户名规则：3~20 位，字母数字下划线连字符与中文，避免和路由/展示打架 */
export function checkUsername(name: string): string | null {
  const n = name.trim();
  if (n.length < 3 || n.length > 20) return "用户名需要 3~20 个字符";
  if (!/^[\w一-龥-]+$/.test(n)) return "用户名只能用中英文、数字、下划线和连字符";
  return null;
}

/** 口令规则：只挡明显不安全的，不折腾用户 */
export function checkPassword(pw: string): string | null {
  if (pw.length < 8) return "密码至少 8 位";
  if (pw.length > 200) return "密码太长了";
  if (/^\d+$/.test(pw)) return "密码不能是纯数字";
  return null;
}
