import path from "node:path";
import { SqliteGameStore } from "./sqlite";
import { GameStore } from "./types";

export type { GameStore, GameRecord, GameSummary } from "./types";

// Next dev 模式会热重载模块，用 globalThis 保证单例与单个数据库连接
const g = globalThis as unknown as { __wgpStore?: SqliteGameStore };

export function getStore(): GameStore {
  if (!g.__wgpStore) {
    const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
    const store = new SqliteGameStore(path.join(dataDir, "games.db"));
    store.seedDemos(path.join(process.cwd(), "templates"));
    store.seedLibrary(path.join(process.cwd(), "templates"));
    g.__wgpStore = store;
  }
  return g.__wgpStore;
}
