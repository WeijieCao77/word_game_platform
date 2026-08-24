import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteGameStore } from "@/lib/store/sqlite";

const MINI_CONFIG = {
  schemaVersion: 1,
  meta: { title: "测试游戏" },
  driver: { kind: "life", time: { label: "年", start: 0, step: 1, max: 3 } },
  vars: [],
  cards: [{ id: "c1", weight: 1, text: "……" }],
  endings: [],
};

function newStore(): SqliteGameStore {
  const dir = mkdtempSync(path.join(tmpdir(), "wgp-store-"));
  return new SqliteGameStore(path.join(dir, "test.db"));
}

describe("SqliteGameStore 对话持久化", () => {
  it("appendChat 追加并随 get 返回；重开 store（新连接）后仍在", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wgp-store-"));
    const dbPath = path.join(dir, "test.db");
    const store = new SqliteGameStore(dbPath);
    const { id } = store.create({ config: MINI_CONFIG });
    expect(store.get(id)!.chat).toEqual([]);

    store.appendChat(id, [
      { role: "user", content: "做一个修仙游戏" },
      { role: "assistant", content: "好，先聊聊题材基调……" },
    ]);
    store.appendChat(id, [{ role: "user", content: "轻松一点的" }]);

    const reopened = new SqliteGameStore(dbPath);
    const chat = reopened.get(id)!.chat;
    expect(chat).toHaveLength(3);
    expect(chat[0].content).toBe("做一个修仙游戏");
    expect(chat[2].role).toBe("user");
  });

  it("超过上限只保留最新 200 条", () => {
    const store = newStore();
    const { id } = store.create({ config: MINI_CONFIG });
    for (let i = 0; i < 120; i++) {
      store.appendChat(id, [
        { role: "user", content: `问题 ${i}` },
        { role: "assistant", content: `回答 ${i}` },
      ]);
    }
    const chat = store.get(id)!.chat;
    expect(chat).toHaveLength(200);
    expect(chat[chat.length - 1].content).toBe("回答 119");
    expect(chat[0].content).toBe("问题 20");
  });

  it("appendChat 对不存在的游戏是安全空操作", () => {
    const store = newStore();
    expect(() => store.appendChat("nope", [{ role: "user", content: "hi" }])).not.toThrow();
  });
});
