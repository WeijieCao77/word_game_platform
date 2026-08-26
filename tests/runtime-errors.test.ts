import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteGameStore } from "@/lib/store/sqlite";
import { runtimeAsset } from "@/lib/runtime";

/**
 * 自由模式版的「校验器」。
 *
 * 快速模式的作品写错了会被三级校验当场打回、错误自动回喂给 AI 重试；
 * 自由模式原本一条护栏都没有——AI 写完就交差，作品在玩家浏览器里抛异常它一无所知，
 * 下一轮还接着往上盖。玩家看到白屏，作者看到的是「AI 说做好了」。
 *
 * 这条链路是：运行库在沙箱里抓异常 → postMessage 给外壳 → 外壳存到服务端
 * → AI 用 read_errors 读到。这份测试盯两头：存储层的规矩、运行库真的会报。
 */

function freshStore(): SqliteGameStore {
  const dir = mkdtempSync(join(tmpdir(), "wgp-err-"));
  return new SqliteGameStore(join(dir, "test.db"));
}

describe("报错存储的规矩", () => {
  let store: SqliteGameStore;
  let gid: string;

  beforeEach(() => {
    store = freshStore();
    gid = store.create({
      config: {
        schemaVersion: 1,
        meta: { title: "测试作品" },
        driver: { kind: "story", startCard: "a" },
        vars: [],
        cards: [{ id: "a", text: "开场", choices: [{ id: "x", label: "走", ending: "完" }] }],
        endings: [{ id: "完", title: "完", kind: "neutral" }],
      } as never,
      author: "",
      designCard: "",
    }).id;
  });

  it("记一条、读得到，最新的在最前面", () => {
    store.errorAdd(gid, { message: "第一条" });
    store.errorAdd(gid, { message: "第二条", stack: "at foo", source: "game.js:3:1" });
    const list = store.errorList(gid);
    expect(list.length).toBe(2);
    expect(list[0].message).toBe("第二条");
    expect(list[0].stack).toBe("at foo");
    expect(list[0].source).toBe("game.js:3:1");
  });

  it("同一条错误反复抛只留最新的一次——不然每帧一次就把表刷爆了", () => {
    for (let i = 0; i < 50; i++) store.errorAdd(gid, { message: "每帧都抛的那条" });
    store.errorAdd(gid, { message: "另一条" });
    const list = store.errorList(gid);
    expect(list.length).toBe(2);
    expect(list.map((e) => e.message).sort()).toEqual(["另一条", "每帧都抛的那条"]);
  });

  it("每个作品最多留 30 条，挤掉的是最旧的", () => {
    for (let i = 0; i < 40; i++) store.errorAdd(gid, { message: `错误 ${i}` });
    const list = store.errorList(gid);
    expect(list.length).toBe(30);
    expect(list.some((e) => e.message === "错误 39")).toBe(true);
    expect(list.some((e) => e.message === "错误 0")).toBe(false);
  });

  it("空消息不记；超长的截断，不让一条报错撑爆存储", () => {
    store.errorAdd(gid, { message: "   " });
    expect(store.errorList(gid).length).toBe(0);
    store.errorAdd(gid, { message: "x".repeat(2000), stack: "y".repeat(5000) });
    const e = store.errorList(gid)[0];
    expect(e.message.length).toBe(500);
    expect(e.stack.length).toBe(2000);
  });

  it("清空之后是干净的；删作品不留孤儿记录", () => {
    store.errorAdd(gid, { message: "一条" });
    store.errorClear(gid);
    expect(store.errorList(gid).length).toBe(0);

    store.errorAdd(gid, { message: "再来一条" });
    store.delete(gid);
    expect(store.errorList(gid).length).toBe(0);
  });

  it("按作品隔离——别的作品的报错串不过来", () => {
    const other = store.create({
      config: {
        schemaVersion: 1,
        meta: { title: "另一部" },
        driver: { kind: "story", startCard: "a" },
        vars: [],
        cards: [{ id: "a", text: "开场", choices: [{ id: "x", label: "走", ending: "完" }] }],
        endings: [{ id: "完", title: "完", kind: "neutral" }],
      } as never,
      author: "",
      designCard: "",
    }).id;
    store.errorAdd(gid, { message: "我的错" });
    store.errorAdd(other, { message: "别人的错" });
    expect(store.errorList(gid).map((e) => e.message)).toEqual(["我的错"]);
    expect(store.errorList(other).map((e) => e.message)).toEqual(["别人的错"]);
  });
});

describe("运行库真的会把异常报出来", () => {
  const src = runtimeAsset("wgp.js")!;

  it("装了 error 与 unhandledrejection 两个全局处理", () => {
    expect(src).toContain('addEventListener("error"');
    expect(src).toContain('addEventListener("unhandledrejection"');
  });

  it("报的是 wgp:error，而且同一条只报一次", () => {
    expect(src).toContain('post("wgp:error"');
    // 去重表 + 上限，缺哪个都会把通道刷爆
    expect(src).toContain("reported[key]");
    expect(src).toContain("reportedCount >= 20");
  });

  it("库自己 try/catch 掉的错误也报——不然只留在控制台里没人看见", () => {
    expect(src).toContain('reportCaught(e, "WGP.ready")');
    expect(src).toContain('reportCaught(e, "界面 "');
  });
});
