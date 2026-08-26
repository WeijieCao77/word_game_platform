import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteGameStore } from "@/lib/store/sqlite";

/**
 * 发布版本。
 *
 * 在这之前，作品只有一份 config 和一套文件，published 只是个布尔开关——
 * 作者在工作台里每保存一次，**线上立刻就变**。AI 哪一轮写坏了玩家当场玩到坏的；
 * 玩到一半的人，游戏在他脚下换了；存档格式一改进度就没了。而且退不回去。
 *
 * 现在草稿与线上分开。这份测试盯的就是这条分界线不能漏。
 */

const MINI = {
  schemaVersion: 1,
  meta: { title: "第一版" },
  driver: { kind: "story", startCard: "c1" },
  vars: [],
  cards: [{ id: "c1", text: "开场" }],
  endings: [],
};

function newStore(): SqliteGameStore {
  const dir = mkdtempSync(join(tmpdir(), "wgp-ver-"));
  return new SqliteGameStore(join(dir, "test.db"));
}

describe("草稿与线上是两份东西", () => {
  let store: SqliteGameStore;
  let gid: string;

  beforeEach(() => {
    store = newStore();
    gid = store.create({ config: MINI as never, author: "", designCard: "" }).id;
  });

  it("没发布过就没有线上版本——调用方据此决定是渲染草稿还是说「还没上线」", () => {
    expect(store.liveVersion(gid)).toBe(0);
    expect(store.versionLive(gid)).toBeNull();
    expect(store.versionList(gid)).toEqual([]);
  });

  it("发布之后，改草稿不会动线上那一份", () => {
    store.versionPublish(gid, "第一次发布");
    store.update(gid, { config: { ...MINI, meta: { title: "改坏了" } } as never });

    // 草稿变了
    expect((store.get(gid)!.config as typeof MINI).meta.title).toBe("改坏了");
    // 线上没变
    expect((store.versionLive(gid)!.config as typeof MINI).meta.title).toBe("第一版");
  });

  it("再发布一次才把草稿推上去，版本号往前走", () => {
    expect(store.versionPublish(gid)).toBe(1);
    store.update(gid, { config: { ...MINI, meta: { title: "第二版" } } as never });
    expect(store.versionPublish(gid, "补了结局")).toBe(2);
    expect(store.liveVersion(gid)).toBe(2);
    expect((store.versionLive(gid)!.config as typeof MINI).meta.title).toBe("第二版");
  });

  it("自由模式的文件也进快照——包括数据表", () => {
    store.fileWrite(gid, "index.html", "<h1>v1</h1>");
    store.fileWrite(gid, "data/roster.csv", "name\nTenZ\n");
    store.versionPublish(gid);

    store.fileWrite(gid, "index.html", "<h1>写坏了</h1>");
    const live = store.versionLive(gid)!;
    expect(live.files["index.html"]).toBe("<h1>v1</h1>");
    // 数据表也要一起存：不然回滚之后作品会去引用一份已经不在的表
    expect(live.files["data/roster.csv"]).toBe("name\nTenZ\n");
    expect(store.fileRead(gid, "index.html")).toBe("<h1>写坏了</h1>");
  });
});

describe("回滚", () => {
  let store: SqliteGameStore;
  let gid: string;

  beforeEach(() => {
    store = newStore();
    gid = store.create({ config: MINI as never, author: "", designCard: "" }).id;
  });

  it("能切回上一版，而且草稿一个字都不动", () => {
    store.versionPublish(gid, "上线");           // v1 的内容是「第一版」
    store.update(gid, { config: { ...MINI, meta: { title: "坏的那版" } } as never });
    store.versionPublish(gid, "结果写坏了");      // v2 的内容是「坏的那版」
    expect((store.versionLive(gid)!.config as typeof MINI).meta.title).toBe("坏的那版");

    expect(store.versionRollback(gid, 1)).toBe(true);
    expect((store.versionLive(gid)!.config as typeof MINI).meta.title).toBe("第一版");
    // 草稿仍然是坏的那版——回滚只管线上，作者自己回去修
    expect((store.get(gid)!.config as typeof MINI).meta.title).toBe("坏的那版");
  });

  it("回滚到不存在的版本要说不行，别默默把线上改坏", () => {
    store.versionPublish(gid);
    expect(store.versionRollback(gid, 99)).toBe(false);
    expect(store.liveVersion(gid)).toBe(1);
  });

  it("版本表标出哪一版在线上", () => {
    store.versionPublish(gid, "一");
    store.versionPublish(gid, "二");
    store.versionRollback(gid, 1);
    const list = store.versionList(gid);
    expect(list.map((v) => v.version)).toEqual([2, 1]);
    expect(list.find((v) => v.version === 1)!.live).toBe(true);
    expect(list.find((v) => v.version === 2)!.live).toBe(false);
  });
});

describe("历史不会无限长，但线上那一版永远不删", () => {
  it("只留最近 10 版", () => {
    const store = newStore();
    const gid = store.create({ config: MINI as never, author: "", designCard: "" }).id;
    for (let i = 0; i < 14; i++) store.versionPublish(gid, `第 ${i} 次`);
    const list = store.versionList(gid);
    expect(list.length).toBe(10);
    expect(list[0].version).toBe(14);
    expect(list[list.length - 1].version).toBe(5);
  });

  it("回滚到很老的一版之后，接着发布也不会把它挤掉——线上那版删了就回不去了", () => {
    const store = newStore();
    const gid = store.create({ config: MINI as never, author: "", designCard: "" }).id;
    for (let i = 0; i < 12; i++) store.versionPublish(gid, `第 ${i} 次`);
    store.versionRollback(gid, 3);
    expect(store.versionLive(gid)).not.toBeNull();

    store.versionPublish(gid, "又发一版");
    // 新版本成了 live；第 3 版可以被挤掉了，但发布那一刻它还是 live 就不该被删
    expect(store.versionLive(gid)!.version).toBe(13);
  });

  it("删作品把版本一起清掉，不留孤儿", () => {
    const store = newStore();
    const gid = store.create({ config: MINI as never, author: "", designCard: "" }).id;
    store.versionPublish(gid);
    store.delete(gid);
    expect(store.versionList(gid)).toEqual([]);
  });
});
