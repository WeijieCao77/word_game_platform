import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { hashPassword, newSessionToken, SESSION_COOKIE } from "@/lib/auth";

// 谁能对一部作品**跑试玩体检**。
//
// 起因是一次真事故：老板说「游戏库里的 val manager 根本就玩不了」，
// 而平台自己的试玩体检对那部作品连跑两次都**「没跑出结果」**——
// 不是报不通过，是一个报告都产不出来。
//
// 根因在权限上。那部作品是游客建的、**从没认领过**，于是按 canEditGame 的规矩
//
//     作品无主 → 编辑钥匙即身份
//
// 而管理员手上没有那把钥匙，于是 /play 那一层不肯注入体检脚本。
// 后果是**平台对一部无主作品做不了任何质量检查，连管理员都做不了**——
// 而无主作品恰恰最需要被检查：游客随手建的、没人认领的，出了问题也没有作者会来修。
//
// 这里钉三件事：管理员跑得了、作者照旧跑得了、**别的登录用户跑不了**。
// 最后一条最要紧——放开的只能是「跑一遍看看」，不能顺手把编辑权限也放开了。

const MINI = {
  schemaVersion: 1,
  meta: { title: "测试游戏" },
  driver: { kind: "life", time: { label: "年", start: 0, step: 1, max: 3 } },
  vars: [],
  cards: [{ id: "c1", weight: 1, text: "……" }],
  endings: [],
};

let dir: string;
const env = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wgp-pcperm-"));
  process.env.DATA_DIR = dir;
});
afterEach(() => {
  process.env = { ...env };
});

/** 造一个带会话 cookie 的请求（跟浏览器发过来的一样） */
function reqAs(token: string | null, editKey = ""): NextRequest {
  const headers = new Headers();
  if (token) headers.set("cookie", `${SESSION_COOKIE}=${token}`);
  if (editKey) headers.set("x-edit-key", editKey);
  return new NextRequest("https://example.test/play/x/index.html?wgpcheck=1", { headers });
}

// getStore() 是模块级单例，DATA_DIR 换了它也不会重建——所以整个文件共用一个库。
// 用户名有唯一约束，每个用例造的人得起不同的名字，否则第二个用例就撞了。
let seq = 0;

async function setup() {
  const { getStore } = await import("@/lib/store");
  const store = getStore();
  const mk = (label: string) => {
    const name = `${label}#${++seq}`;
    const { hash, salt } = hashPassword("a-long-enough-password");
    const u = store.userCreate({ username: name, passwordHash: hash, salt });
    // 跟 startSession 走同一条路：库里只存 token 的指纹，cookie 里放明文 token
    const { token, tokenHash, expiresAt } = newSessionToken();
    store.sessionCreate(u.id, tokenHash, expiresAt);
    return { user: u, token };
  };
  return { store, mk };
}

describe("无主作品：管理员必须跑得了体检", () => {
  it("管理员对一部无主作品能跑体检——线上那部 VAL MANAGER 就卡在这儿", async () => {
    const { store, mk } = await setup();
    const { canPlayCheck, canEditGame } = await import("@/lib/session");
    const admin = mk("管理员");
    expect(admin.user.role).toBe("admin"); // 平台第一个注册者自动是管理员

    const g = store.create({ config: MINI }); // 游客建的，无主
    expect(store.gameOwner(g.id)).toBeNull();

    // 这就是事故现场：管理员没有那把钥匙，编辑权限判定为 false
    expect(canEditGame(reqAs(admin.token), g.id)).toBe(false);
    // 而体检必须跑得了
    expect(canPlayCheck(reqAs(admin.token), g.id)).toBe(true);
  });

  it("放开的只是「跑一遍看看」，**编辑权限一个字都没动**", async () => {
    // 这条是这次改动的安全边界。放宽 canEditGame 等于让管理员能悄悄改写
    // 任何人的作品——那是另一回事，而且是危险的一回事。
    const { store, mk } = await setup();
    const { canEditGame } = await import("@/lib/session");
    const admin = mk("管理员");
    const owner = mk("作者");
    const g = store.create({ config: MINI, ownerId: owner.user.id });
    expect(canEditGame(reqAs(admin.token), g.id)).toBe(false);
  });
});

describe("原来就该有的权限，一条都不能丢", () => {
  it("作者本人（有主作品）照旧跑得了", async () => {
    const { store, mk } = await setup();
    const { canPlayCheck } = await import("@/lib/session");
    mk("占位管理员");
    const owner = mk("作者");
    const g = store.create({ config: MINI, ownerId: owner.user.id });
    expect(canPlayCheck(reqAs(owner.token), g.id)).toBe(true);
  });

  it("拿着编辑钥匙的游客（无主作品）照旧跑得了", async () => {
    const { store, mk } = await setup();
    const { canPlayCheck } = await import("@/lib/session");
    mk("占位管理员");
    const g = store.create({ config: MINI });
    expect(canPlayCheck(reqAs(null, g.editKey), g.id)).toBe(true);
  });
});

describe("不能顺手放开给不该有的人", () => {
  it("另一个普通用户跑不了别人的作品", async () => {
    const { store, mk } = await setup();
    const { canPlayCheck } = await import("@/lib/session");
    mk("占位管理员");
    const owner = mk("作者");
    const other = mk("路人");
    expect(other.user.role).toBe("user");
    const g = store.create({ config: MINI, ownerId: owner.user.id });
    expect(canPlayCheck(reqAs(other.token), g.id)).toBe(false);
  });

  it("普通用户也跑不了无主作品（没钥匙就是没钥匙）", async () => {
    const { store, mk } = await setup();
    const { canPlayCheck } = await import("@/lib/session");
    mk("占位管理员");
    const other = mk("路人");
    const g = store.create({ config: MINI });
    expect(canPlayCheck(reqAs(other.token), g.id)).toBe(false);
  });

  it("没登录、没钥匙的玩家一律不行——玩家绝不能被塞进一个自动点击器", async () => {
    const { store, mk } = await setup();
    const { canPlayCheck } = await import("@/lib/session");
    mk("占位管理员");
    const g = store.create({ config: MINI });
    expect(canPlayCheck(reqAs(null), g.id)).toBe(false);
  });
});
