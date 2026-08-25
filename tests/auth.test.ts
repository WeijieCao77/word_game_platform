import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteGameStore } from "@/lib/store/sqlite";
import { checkPassword, checkUsername, hashPassword, newSessionToken, sessionTokenHash, verifyPassword } from "@/lib/auth";

const MINI_CONFIG = {
  schemaVersion: 1,
  meta: { title: "测试游戏" },
  driver: { kind: "life", time: { label: "年", start: 0, step: 1, max: 3 } },
  vars: [],
  cards: [{ id: "c1", weight: 1, text: "……" }],
  endings: [],
};

function newStore(): SqliteGameStore {
  const dir = mkdtempSync(path.join(tmpdir(), "wgp-auth-"));
  return new SqliteGameStore(path.join(dir, "test.db"));
}

function register(store: SqliteGameStore, username: string, password: string) {
  const { hash, salt } = hashPassword(password);
  return store.userCreate({ username, passwordHash: hash, salt });
}

describe("密码存储", () => {
  it("同一个口令两次哈希结果不同（每人独立盐），但都能验证通过", () => {
    const a = hashPassword("correct horse battery");
    const b = hashPassword("correct horse battery");
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
    expect(verifyPassword("correct horse battery", a)).toBe(true);
    expect(verifyPassword("correct horse battery", b)).toBe(true);
  });

  it("错误口令、空口令、被篡改的哈希都验证失败", () => {
    const stored = hashPassword("s3cret-passphrase");
    expect(verifyPassword("s3cret-passphras", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
    expect(verifyPassword("s3cret-passphrase", { hash: "00", salt: stored.salt })).toBe(false);
    expect(verifyPassword("s3cret-passphrase", { hash: stored.hash, salt: "" })).toBe(false);
  });

  it("明文口令不出现在存下来的任何字段里", () => {
    const stored = hashPassword("plaintext-should-not-leak");
    expect(JSON.stringify(stored)).not.toContain("plaintext-should-not-leak");
  });

  it("用户名与口令规则", () => {
    expect(checkUsername("ab")).toBeTruthy();
    expect(checkUsername("正常用户名")).toBeNull();
    expect(checkUsername("bad name!")).toBeTruthy();
    expect(checkPassword("1234567")).toBeTruthy();
    expect(checkPassword("12345678")).toBeTruthy(); // 纯数字不行
    expect(checkPassword("goodenough1")).toBeNull();
  });
});

describe("账号与会话", () => {
  it("第一个注册的人是管理员，后来的是普通用户", () => {
    const store = newStore();
    expect(register(store, "老板", "boss-password-1").role).toBe("admin");
    expect(register(store, "路人", "someone-password").role).toBe("user");
    expect(store.userCount()).toBe(2);
  });

  it("会话只存 token 的指纹：拿库里的值当 cookie 用不了", () => {
    const store = newStore();
    const user = register(store, "作者甲", "author-password");
    const { token, tokenHash, expiresAt } = newSessionToken();
    store.sessionCreate(user.id, tokenHash, expiresAt);
    expect(token).not.toBe(tokenHash);
    expect(store.sessionUser(sessionTokenHash(token))?.username).toBe("作者甲");
    // 把库里存的指纹当 cookie 用：服务端会再哈希一次，对不上 → 冒充失败
    expect(store.sessionUser(sessionTokenHash(tokenHash))).toBeNull();
    store.sessionDelete(tokenHash);
    expect(store.sessionUser(sessionTokenHash(token))).toBeNull();
  });

  it("过期会话不认", () => {
    const store = newStore();
    const user = register(store, "过期君", "expired-password");
    const token = "deadbeef";
    store.sessionCreate(user.id, sessionTokenHash(token), new Date(Date.now() - 1000).toISOString());
    expect(store.sessionUser(sessionTokenHash(token))).toBeNull();
  });

  it("管理员可以提拔别人", () => {
    const store = newStore();
    register(store, "老板", "boss-password-1");
    const u = register(store, "同事", "colleague-password");
    store.userSetRole(u.id, "admin");
    expect(store.userById(u.id)?.role).toBe("admin");
  });
});

describe("作品归属与认领", () => {
  it("登录创建的作品直接归账号；游客作品无主", () => {
    const store = newStore();
    const user = register(store, "作者乙", "author-password");
    const mine = store.create({ config: MINI_CONFIG, author: "作者乙", ownerId: user.id });
    const guest = store.create({ config: MINI_CONFIG });
    expect(store.gameOwner(mine.id)).toBe(user.id);
    expect(store.gameOwner(guest.id)).toBeNull();
    expect(store.listByOwner(user.id).map((g) => g.id)).toEqual([mine.id]);
  });

  it("凭正确的编辑钥匙才能认领；错钥匙、别人的作品都认领不走", () => {
    const store = newStore();
    const user = register(store, "作者丙", "author-password");
    const other = register(store, "别人", "other-password");
    const a = store.create({ config: MINI_CONFIG });
    const b = store.create({ config: MINI_CONFIG });
    const taken = store.create({ config: MINI_CONFIG, ownerId: other.id });

    const claimed = store.claimGames(user.id, [
      { id: a.id, editKey: a.editKey },          // 正确钥匙 → 认领成功
      { id: b.id, editKey: "wrong-key" },        // 错钥匙 → 不动
      { id: taken.id, editKey: taken.editKey },  // 已有主人 → 不动（钥匙对也不行）
      { id: "not-exist", editKey: "x" },
    ]);
    expect(claimed).toBe(1);
    expect(store.gameOwner(a.id)).toBe(user.id);
    expect(store.gameOwner(b.id)).toBeNull();
    expect(store.gameOwner(taken.id)).toBe(other.id);
  });

  it("后台统计里能看到账号数与管理员数", () => {
    const store = newStore();
    register(store, "老板", "boss-password-1");
    register(store, "作者", "author-password");
    const stats = store.adminStats();
    expect(stats.accounts).toEqual({ total: 2, admins: 1 });
  });
});
