import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteGameStore } from "@/lib/store/sqlite";
import { checkQuota, recordSpend, quotaView } from "@/lib/ai/quota";
import type { UserRecord } from "@/lib/store/types";

// AI 额度：注册用户是「总量额度池」（用完由管理员手动批），游客是按日额度，
// 管理员不限量；另有一条与身份无关的熔断——烧了不少却一张卡都没搭出来。

const MINI = {
  schemaVersion: 1,
  meta: { title: "测试" },
  driver: { kind: "life", time: { label: "年", start: 0, step: 1, max: 3 } },
  vars: [],
  cards: [{ id: "c1", weight: 1, text: "……" }],
  endings: [],
};
const EMPTY = { ...MINI, cards: [] };

function newStore(): SqliteGameStore {
  const dir = mkdtempSync(path.join(tmpdir(), "wgp-quota-"));
  return new SqliteGameStore(path.join(dir, "test.db"));
}

let store: SqliteGameStore;
let placeholderAdmin: UserRecord;
const env = { ...process.env };

beforeEach(() => {
  process.env.AI_USER_GRANT = "1000";
  process.env.AI_GUEST_DAILY_TOKENS = "400";
  process.env.AI_GUEST_DAILY_REQUESTS = "50";
  process.env.AI_NO_OUTPUT_TOKENS = "500";
  store = newStore();
  // 平台的第一个注册者自动是管理员（= 不限量），先占掉这个位子，
  // 后面 makeUser 造出来的才是普通用户
  placeholderAdmin = store.userCreate({ username: "占位管理员", passwordHash: "h", salt: "s" });
});
afterEach(() => {
  process.env = { ...env };
});

function makeUser(name: string): UserRecord {
  return store.userCreate({ username: name, passwordHash: "h", salt: "s" });
}

describe("注册用户：总量额度池，用完不是等明天而是等审批", () => {
  it("额度没用完就放行；用完拒绝并自动开一条待批申请", () => {
    const user = makeUser("普通作者");
    expect(placeholderAdmin.role).toBe("admin"); // 平台第一个注册者
    expect(user.role).toBe("user");

    const g = store.create({ config: MINI, ownerId: user.id });
    const args = { user, quotaKey: `u:${user.id}`, gameId: g.id, cardsCount: 1 };

    expect(checkQuota(store, args).allowed).toBe(true);
    recordSpend(store, { user, quotaKey: args.quotaKey, gameId: g.id, tokens: 900 });
    expect(checkQuota(store, args).allowed).toBe(true);

    recordSpend(store, { user, quotaKey: args.quotaKey, gameId: g.id, tokens: 200 });
    const v = checkQuota(store, args);
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("user_exhausted");

    const pending = store.quotaRequestList();
    expect(pending).toHaveLength(1);
    expect(pending[0].username).toBe("普通作者");
    expect(pending[0].used).toBe(1100);
  });

  it("同一个人反复撞额度，只留一条待批（不刷屏）", () => {
    const user = makeUser("只此一条");
    const g = store.create({ config: MINI, ownerId: user.id });
    const args = { user, quotaKey: `u:${user.id}`, gameId: g.id, cardsCount: 1 };
    recordSpend(store, { user, quotaKey: args.quotaKey, gameId: g.id, tokens: 1000 });
    checkQuota(store, args);
    checkQuota(store, args);
    checkQuota(store, args);
    expect(store.quotaRequestList()).toHaveLength(1);
  });

  it("管理员批准后额度真的加上了，人能接着用", () => {
    const user = makeUser("等批的人");
    const g = store.create({ config: MINI, ownerId: user.id });
    const args = { user, quotaKey: `u:${user.id}`, gameId: g.id, cardsCount: 1 };
    recordSpend(store, { user, quotaKey: args.quotaKey, gameId: g.id, tokens: 1000 });
    expect(checkQuota(store, args).allowed).toBe(false);

    const req = store.quotaRequestList()[0];
    expect(store.quotaRequestResolve(req.id, 2000)).toEqual({ userId: user.id, granted: 2000 });
    expect(checkQuota(store, args).allowed).toBe(true);
    expect(store.userQuota(user.id)).toEqual({ grant: 3000, used: 1000, flagship: false });

    // 处理过的单子不能再批第二次
    expect(store.quotaRequestResolve(req.id, 2000)).toBeNull();
    expect(store.quotaRequestList()).toHaveLength(0);
  });

  it("拒绝（批 0）不加额度，单子落成 denied", () => {
    const user = makeUser("被拒的人");
    const g = store.create({ config: MINI, ownerId: user.id });
    recordSpend(store, { user, quotaKey: `u:${user.id}`, gameId: g.id, tokens: 1000 });
    checkQuota(store, { user, quotaKey: `u:${user.id}`, gameId: g.id, cardsCount: 1 });
    const req = store.quotaRequestList()[0];
    store.quotaRequestResolve(req.id, 0);
    expect(store.userQuota(user.id).grant).toBe(1000);
    expect(store.quotaRequestList(false)[0].status).toBe("denied");
  });
});

describe("管理员不限量，但照常记账", () => {
  it("烧过额度也放行，用量仍然累计（后台要看得到）", () => {
    const admin = placeholderAdmin;
    const g = store.create({ config: MINI, ownerId: admin.id });
    const args = { user: admin, quotaKey: `u:${admin.id}`, gameId: g.id, cardsCount: 1 };
    recordSpend(store, { user: admin, quotaKey: args.quotaKey, gameId: g.id, tokens: 99_999 });
    expect(checkQuota(store, args).allowed).toBe(true);
    const v = quotaView(store, { user: admin, quotaKey: args.quotaKey });
    expect(v.unlimited).toBe(true);
    expect(v.used).toBe(99999);
  });
});

describe("游客：按日额度，不能给总量（清 cookie 就能刷）", () => {
  it("当天用满就拒，提示去注册", () => {
    const g = store.create({ config: MINI });
    const key = "guest-edit-key";
    const args = { user: null, quotaKey: key, gameId: g.id, cardsCount: 1 };
    expect(checkQuota(store, args).allowed).toBe(true);
    recordSpend(store, { user: null, quotaKey: key, gameId: g.id, tokens: 400 });
    const v = checkQuota(store, args);
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("guest_daily");
    expect(v.reason).toContain("注册");
  });

  it("额度视图报的是今日口径", () => {
    const g = store.create({ config: MINI });
    recordSpend(store, { user: null, quotaKey: "k", gameId: g.id, tokens: 150 });
    const v = quotaView(store, { user: null, quotaKey: "k" });
    expect(v).toMatchObject({ kind: "guest", unlimited: false, used: 150, limit: 400, remaining: 250 });
  });
});

describe("熔断：烧了不少却一张卡都没有", () => {
  it("零卡片 + 超过阈值 → 拒绝，且拒绝理由说的是「先把游戏搭起来」", () => {
    const user = makeUser("光聊不做");
    const g = store.create({ config: EMPTY, ownerId: user.id });
    recordSpend(store, { user, quotaKey: `u:${user.id}`, gameId: g.id, tokens: 600 });
    const v = checkQuota(store, { user, quotaKey: `u:${user.id}`, gameId: g.id, cardsCount: 0 });
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("no_output");
    expect(v.reason).toContain("一张卡片都还没有");
  });

  it("已经搭出卡片就不熔断，哪怕烧得更多", () => {
    const user = makeUser("在正经做游戏");
    const g = store.create({ config: MINI, ownerId: user.id });
    recordSpend(store, { user, quotaKey: `u:${user.id}`, gameId: g.id, tokens: 900 });
    expect(checkQuota(store, { user, quotaKey: `u:${user.id}`, gameId: g.id, cardsCount: 12 }).allowed).toBe(true);
  });

  it("管理员不受熔断影响", () => {
    const admin = placeholderAdmin;
    const g = store.create({ config: EMPTY, ownerId: admin.id });
    recordSpend(store, { user: admin, quotaKey: `u:${admin.id}`, gameId: g.id, tokens: 5000 });
    expect(checkQuota(store, { user: admin, quotaKey: `u:${admin.id}`, gameId: g.id, cardsCount: 0 }).allowed).toBe(true);
  });
});

describe("旗舰位：手动放额那条路", () => {
  // 设计体检第五条：规矩（注册即 200 万）和验收标准（VAL MANAGER 量级实测 733 万）
  // 互相打架，一个深度创作者按现在的规矩**不可能**做出验收标准要求的作品。
  // 老板拍的板是「选旗舰位手动放额」——池子放大，但由人决定给谁。
  beforeEach(() => {
    process.env.AI_FLAGSHIP_GRANT = "50000";
  });

  it("升旗舰位之后，剩下的是**整份**旗舰额度，不是差额", () => {
    const user = makeUser("深度创作者");
    const g = store.create({ config: MINI, ownerId: user.id });
    // 先把 1000 的普通额度烧掉 900
    recordSpend(store, { user, quotaKey: `u:${user.id}`, gameId: g.id, tokens: 900 });

    store.userSetFlagship(user.id, true, 50_000);

    const q = store.userQuota(user.id);
    expect(q.flagship).toBe(true);
    // 关键：作者关心的是「还能烧多少」。烧过 900 的人升旗舰位，
    // 剩下的该是 50000，不是 50000-900。
    expect(q.grant - q.used).toBe(50_000);
  });

  it("升旗舰位不会把已经批过的更大的池子调小", () => {
    const user = makeUser("批过好几笔");
    store.userGrantAdd(user.id, 200_000); // 手上已经有 201000
    store.userSetFlagship(user.id, true, 50_000);
    expect(store.userQuota(user.id).grant).toBe(201_000);
  });

  it("降回普通只摘标签，**不收回**已经批出去的额度", () => {
    // 搭到一半被抽走额度，作品就烂在半截了。要收回是另一件事。
    const user = makeUser("被降级的");
    store.userSetFlagship(user.id, true, 50_000);
    const before = store.userQuota(user.id).grant;
    store.userSetFlagship(user.id, false, 50_000);
    const after = store.userQuota(user.id);
    expect(after.flagship).toBe(false);
    expect(after.grant).toBe(before);
  });

  it("旗舰位照样会用完，照样开申请单——它不是「不限量」", () => {
    const user = makeUser("烧穿旗舰位");
    const g = store.create({ config: MINI, ownerId: user.id });
    store.userSetFlagship(user.id, true, 50_000);
    const args = { user, quotaKey: `u:${user.id}`, gameId: g.id, cardsCount: 1 };
    expect(checkQuota(store, args).allowed).toBe(true);

    recordSpend(store, { user, quotaKey: args.quotaKey, gameId: g.id, tokens: 50_000 });
    const v = checkQuota(store, args);
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("user_exhausted");
    expect(v.reason).toContain("旗舰位");
    expect(store.quotaRequestList()).toHaveLength(1);
  });

  it("普通账号撞墙时要被告知**还有旗舰位这条路**", () => {
    // 不说的话，一个正在搭大作品的人只会以为平台就到这儿了——
    // 而 200 万连验收标准要求的体量的三成都走不到。
    const user = makeUser("撞墙的");
    const g = store.create({ config: MINI, ownerId: user.id });
    const args = { user, quotaKey: `u:${user.id}`, gameId: g.id, cardsCount: 1 };
    recordSpend(store, { user, quotaKey: args.quotaKey, gameId: g.id, tokens: 1000 });
    const v = checkQuota(store, args);
    expect(v.reason).toContain("旗舰位");
  });

  it("额度视图要认得出旗舰位（界面上得说出来）", () => {
    const user = makeUser("看得见身份");
    store.userSetFlagship(user.id, true, 50_000);
    const v = quotaView(store, { user, quotaKey: `u:${user.id}` });
    expect(v.flagship).toBe(true);
    expect(v.limit).toBe(50_000);
    expect(quotaView(store, { user: null, quotaKey: "guest" }).flagship).toBe(false);
  });

  it("后台账号清单能找到人：这是「主动放额」的前提", () => {
    // 原来后台只有「等他撞墙、系统自动开申请单」这一条被动通路。
    const a = makeUser("甲");
    const b = makeUser("乙");
    store.userSetFlagship(b.id, true, 50_000);
    const rows = store.userAccounts();
    const names = rows.map((r) => r.username);
    expect(names).toContain("甲");
    expect(names).toContain("乙");
    expect(rows.find((r) => r.id === b.id)?.flagship).toBe(true);
    expect(rows.find((r) => r.id === a.id)?.flagship).toBe(false);
    // 老账号没有 token_grant 也要报出一个默认额度，别显示成 0
    expect(rows.find((r) => r.id === a.id)?.grant).toBeGreaterThan(0);
  });

  it("给不存在的账号升旗舰位要回 null，不能静悄悄成功", () => {
    expect(store.userSetFlagship("没这个人", true, 50_000)).toBeNull();
  });
});
