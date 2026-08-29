import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteGameStore } from "@/lib/store/sqlite";

const MINI = {
  schemaVersion: 1,
  meta: { title: "测试" },
  driver: { kind: "life", time: { label: "年", start: 0, step: 1, max: 3 } },
  vars: [],
  cards: [{ id: "c1", weight: 1, text: "……" }],
  endings: [],
};

describe("撤下不许变成单向门", () => {
  // 起因：后台的作品清单原来直接用 listPublished，而那是按**挂牌**过滤的。
  // 于是管理员一撤下某部作品，它就从后台清单里消失了——**再也看不见，
  // 也就没法把它放回去**。而撤下之后最需要盯着的恰恰是那几部（等修好要放回来的）。
  //
  // 这是在给 dlezoceb 划归账号时撞出来的：划归成功了，可我的核对步骤
  // 在后台清单里找不到那部作品——因为它刚被撤下。
  const newStore = (): SqliteGameStore => {
    const dir = mkdtempSync(path.join(tmpdir(), "wgp-adminlist-"));
    return new SqliteGameStore(path.join(dir, "test.db"));
  };

  it("撤下之后，后台清单里还看得见它", () => {
    const store = newStore();
    const g = store.create({ config: MINI });
    store.setPublished(g.id, true);
    store.setListed(g.id, true);
    expect(store.listPublished(50).map((x) => x.id)).toContain(g.id);

    store.setListed(g.id, false);
    // 公开库里没有了——这是对的
    expect(store.listPublished(50).map((x) => x.id)).not.toContain(g.id);
    // 但后台还得看得见，否则放不回去
    expect(store.listAllForAdmin(50).map((x) => x.id)).toContain(g.id);
  });

  it("后台清单要带上状态位，三种情形分得开", () => {
    const store = newStore();
    const inLib = store.create({ config: MINI });
    store.setPublished(inLib.id, true);
    store.setListed(inLib.id, true);

    const pulled = store.create({ config: MINI });
    store.setPublished(pulled.id, true); // 链接还开着，只是撤了挂牌

    const never = store.create({ config: MINI }); // 从没发布过

    const rows = store.listAllForAdmin(50);
    const of = (id: string) => rows.find((r) => r.id === id);
    expect(of(inLib.id)).toMatchObject({ listed: true, published: true });
    expect(of(pulled.id)).toMatchObject({ listed: false, published: true });
    expect(of(never.id)).toMatchObject({ listed: false, published: false });
  });

  it("从没发布过的作品也在后台清单里（不然它等于不存在）", () => {
    const store = newStore();
    const g = store.create({ config: MINI });
    expect(store.listPublished(50).map((x) => x.id)).not.toContain(g.id);
    expect(store.listAllForAdmin(50).map((x) => x.id)).toContain(g.id);
  });
});
