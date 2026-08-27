import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteGameStore } from "@/lib/store/sqlite";

/**
 * 「发布」原来是**一个开关管三件事**：打快照、链接能不能玩、挂不挂公开库。
 *
 * 挤在一起的代价是实打实的两条：
 *
 *   1. 作品**一旦发布，作者再改就没有任何按钮能把改动推给玩家**——那个按钮
 *      这时候写着「取消发布」。要上线只能先取消（链接当场对所有人 403，
 *      **链接立刻死掉**）再点发布，中间一段真空。
 *   2. 后台「撤下」动的也是同一个字段，于是**把半成品撤下公开库
 *      ＝ 把作者和测试者的链接一起弄死**。
 *
 * 拆开之后：`published` 只管**链接可达**，`listed` 只管**公开挂牌**，
 * 发新版本是第三件事，随时能做。这份测试盯的就是这三件事互不牵连。
 */

const MINI = {
  schemaVersion: 1,
  meta: { title: "拆开自测" },
  driver: { kind: "story", startCard: "c1" },
  vars: [],
  cards: [{ id: "c1", text: "开场" }],
  endings: [],
};

const newDir = (): string => mkdtempSync(join(tmpdir(), "wgp-split-"));
const newStore = (): SqliteGameStore => new SqliteGameStore(join(newDir(), "test.db"));

describe("链接可达和公开挂牌是两件事", () => {
  let store: SqliteGameStore;
  let gid: string;

  beforeEach(() => {
    store = newStore();
    gid = store.create({ config: MINI as never, author: "", designCard: "" }).id;
  });

  it("新建的作品：链接关着、也没挂牌", () => {
    const g = store.get(gid);
    expect(g?.published).toBe(false);
    expect(g?.listed).toBe(false);
  });

  it("**从公开库撤下，不许弄死链接**——这条就是这次拆分的理由", () => {
    store.setPublished(gid, true);
    store.setListed(gid, true);

    store.setListed(gid, false);

    const g = store.get(gid);
    expect(g?.listed).toBe(false);
    expect(g?.published, "撤下挂牌把链接也关掉了——作者和测试者会一起被挡在门外").toBe(true);
  });

  it("关掉链接不影响挂牌这个字段（两个开关各管各的）", () => {
    store.setPublished(gid, true);
    store.setListed(gid, true);
    store.setPublished(gid, false);
    expect(store.get(gid)?.listed).toBe(true);
  });

  it("公开库列的是**挂牌**的，不是链接开着的", () => {
    store.setPublished(gid, true);
    store.setListed(gid, false);
    expect(store.listPublished(50).some((g) => g.id === gid)).toBe(false);

    store.setListed(gid, true);
    expect(store.listPublished(50).some((g) => g.id === gid)).toBe(true);
  });
});

describe("发新版本是独立的第三件事", () => {
  it("已经发布过了，还能接着发新版本——不用先取消发布", () => {
    const store = newStore();
    const gid = store.create({ config: MINI as never, author: "", designCard: "" }).id;

    store.setPublished(gid, true);
    expect(store.versionPublish(gid, "第一版")).toBe(1);

    // 作者又改了一轮：以前到这一步就卡住了，界面上只有「取消发布」
    store.update(gid, { config: { ...MINI, meta: { title: "第二稿" } } as never });
    expect(store.versionPublish(gid, "第二版")).toBe(2);

    // 全程链接没断过
    expect(store.get(gid)?.published).toBe(true);
    expect((store.versionLive(gid)?.config as { meta: { title: string } }).meta.title).toBe("第二稿");
  });
});

describe("老库升级", () => {
  it("以前发布过的作品，升级之后照旧挂在公开库", () => {
    // 造一个「没有 listed 这一列」的老库：先建库，再把列删掉，模拟升级前的样子
    const file = join(newDir(), "old.db");
    {
      const store = new SqliteGameStore(file);
      const gid = store.create({ config: MINI as never, author: "", designCard: "" }).id;
      store.setPublished(gid, true);
      store.setListed(gid, false); // 故意跟 published 不一致，好看出回填有没有生效
      const raw = new Database(file);
      raw.exec("ALTER TABLE games DROP COLUMN listed");
      raw.close();
    }

    // 重新打开 = 跑一次升级
    const store = new SqliteGameStore(file);
    const g = store.listPublished(50)[0];
    expect(g, "升级之后作品应该还在公开库里").toBeTruthy();
    expect(store.get(g.id)?.listed).toBe(true);
  });

  it("没发布过的作品，升级之后也不该凭空出现在公开库", () => {
    const file = join(newDir(), "old2.db");
    {
      const store = new SqliteGameStore(file);
      store.create({ config: MINI as never, author: "", designCard: "" });
      const raw = new Database(file);
      raw.exec("ALTER TABLE games DROP COLUMN listed");
      raw.close();
    }
    const store = new SqliteGameStore(file);
    expect(store.listPublished(50)).toEqual([]);
  });
});
