import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { GameConfig, CardDef, validateGameConfig } from "@/lib/schema";
import { LibraryEntry, extractRequiredVars, shareBlockReason } from "@/lib/library";
import { ChatTurn, GameRecord, GameStore, GameSummary, UserRecord } from "./types";

function newId(): string {
  return randomBytes(6).toString("base64url").replace(/[-_]/g, "a").toLowerCase();
}

function newEditKey(): string {
  return randomBytes(24).toString("hex");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface GameRow {
  id: string;
  config: string;
  design_card: string;
  chat: string;
  author: string;
  published: number;
  edit_key: string;
  created_at: string;
  updated_at: string;
  /** 列表查询带出的 (cover IS NOT NULL) */
  has_cover?: number;
  likes?: number;
  plays?: number;
}

/** 对话记录条数上限：超出后丢最旧的（防单行无限膨胀） */
const CHAT_CAP = 200;

export class SqliteGameStore implements GameStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        config TEXT NOT NULL,
        design_card TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        published INTEGER NOT NULL DEFAULT 0,
        edit_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_games_published ON games(published, updated_at);
      CREATE INDEX IF NOT EXISTS idx_games_author ON games(author);
      CREATE TABLE IF NOT EXISTS ai_usage (
        key TEXT NOT NULL,
        date TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (key, date)
      );
      CREATE TABLE IF NOT EXISTS library_cards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        card TEXT NOT NULL,
        required_vars TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_library_category ON library_cards(category);
    `);
    // 老库升级：games 表补列（已存在则忽略）
    for (const ddl of [
      "ALTER TABLE games ADD COLUMN chat TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE games ADD COLUMN cover BLOB",
      "ALTER TABLE games ADD COLUMN cover_type TEXT",
      "ALTER TABLE games ADD COLUMN likes INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE games ADD COLUMN plays INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE games ADD COLUMN play_seconds INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE games ADD COLUMN owner_id TEXT",
    ]) {
      try {
        this.db.exec(ddl);
      } catch {
        // 列已存在
      }
    }
    // 账号与会话：游客不需要账号，账号解决的是「换设备/清缓存后找回作品」。
    // 密码只存 scrypt 哈希；会话只存 token 的 sha256（库被拖走也无法冒充登录）。
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_games_owner ON games(owner_id);
    `);

    // 按日统计表：创作者数据后台的地基（趋势图/日活直接从这查）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS game_stats_daily (
        game_id TEXT NOT NULL,
        date TEXT NOT NULL,
        plays INTEGER NOT NULL DEFAULT 0,
        likes INTEGER NOT NULL DEFAULT 0,
        play_seconds INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (game_id, date)
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS game_assets (
        game_id TEXT NOT NULL,
        name TEXT NOT NULL,
        data BLOB NOT NULL,
        content_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (game_id, name)
      );
      CREATE TABLE IF NOT EXISTS library_assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data BLOB NOT NULL,
        content_type TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
    `);
    try {
      this.db.exec("ALTER TABLE game_stats_daily ADD COLUMN play_seconds INTEGER NOT NULL DEFAULT 0");
    } catch {
      // 列已存在
    }
  }

  /** 启动时同步官方示例：不存在则作为已发布游戏入库，已存在则刷新配置（模板改进随部署上线） */
  seedDemos(templatesDir: string): void {
    const demos: { id: string; file: string }[] = [
      { id: "xiuxian", file: "life-demo.json" },
      { id: "yeye-bus", file: "story-demo.json" },
      { id: "esports-lite", file: "sim-demo.json" },
      { id: "romance", file: "romance-demo.json" },
      { id: "romance-m", file: "romance-m-demo.json" },
      { id: "snow-manor", file: "manor-demo.json" },
      { id: "cold-case", file: "coldcase-demo.json" },
    ];
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT INTO games (id, config, design_card, author, published, edit_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
    );
    const update = this.db.prepare("UPDATE games SET config = ?, author = ?, updated_at = ? WHERE id = ?");
    for (const d of demos) {
      try {
        const config = readFileSync(path.join(templatesDir, d.file), "utf8");
        // 保险丝：校验不过的模板绝不覆盖线上示例（防止半成品/坏文件随部署上线）
        const check = validateGameConfig(JSON.parse(config));
        if (check.issues.some((i) => i.severity === "error")) continue;
        const author = (JSON.parse(config) as GameConfig).meta.author ?? "官方示例";
        const exists = this.db.prepare("SELECT id FROM games WHERE id = ?").get(d.id);
        if (exists) update.run(config, author, now, d.id);
        else insert.run(d.id, config, "", author, newEditKey(), now, now);
      } catch {
        // 模板缺失不阻塞启动（romance-demo 在内容上线前不存在，属预期）
      }
    }
  }

  create(input: { config: unknown; designCard?: string; author?: string; ownerId?: string }): { id: string; editKey: string } {
    const id = newId();
    const editKey = newEditKey();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO games (id, config, design_card, author, published, edit_key, owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
      )
      .run(
        id,
        JSON.stringify(input.config),
        input.designCard ?? "",
        input.author ?? "",
        editKey,
        input.ownerId ?? null,
        now,
        now
      );
    return { id, editKey };
  }

  get(id: string): GameRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, config, design_card, chat, author, published, edit_key, created_at, updated_at,
                (cover IS NOT NULL) AS has_cover
         FROM games WHERE id = ?`
      )
      .get(id) as GameRow | undefined;
    if (!row) return null;
    let chat: ChatTurn[] = [];
    try {
      chat = JSON.parse(row.chat || "[]");
    } catch {
      // 损坏则视为无记录
    }
    return {
      id: row.id,
      config: JSON.parse(row.config),
      designCard: row.design_card,
      chat,
      hasCover: row.has_cover === 1,
      author: row.author,
      published: row.published === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  checkEditKey(id: string, editKey: string): boolean {
    const row = this.db.prepare("SELECT edit_key FROM games WHERE id = ?").get(id) as
      | { edit_key: string }
      | undefined;
    return !!row && !!editKey && row.edit_key === editKey;
  }

  update(id: string, patch: { config?: unknown; designCard?: string; author?: string }): void {
    const sets: string[] = ["updated_at = ?"];
    const args: unknown[] = [new Date().toISOString()];
    if (patch.config !== undefined) {
      sets.push("config = ?");
      args.push(JSON.stringify(patch.config));
    }
    if (patch.designCard !== undefined) {
      sets.push("design_card = ?");
      args.push(patch.designCard);
    }
    if (patch.author !== undefined) {
      sets.push("author = ?");
      args.push(patch.author);
    }
    args.push(id);
    this.db.prepare(`UPDATE games SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM game_stats_daily WHERE game_id = ?").run(id);
    this.db.prepare("DELETE FROM game_assets WHERE game_id = ?").run(id);
    this.db.prepare("DELETE FROM games WHERE id = ?").run(id);
  }

  appendChat(id: string, turns: ChatTurn[]): void {
    const row = this.db.prepare("SELECT chat FROM games WHERE id = ?").get(id) as
      | { chat: string }
      | undefined;
    if (!row) return;
    let chat: ChatTurn[] = [];
    try {
      chat = JSON.parse(row.chat || "[]");
    } catch {
      // 损坏则重建
    }
    const next = [...chat, ...turns].slice(-CHAT_CAP);
    this.db.prepare("UPDATE games SET chat = ? WHERE id = ?").run(JSON.stringify(next), id);
  }

  assetPut(gameId: string, name: string, data: Uint8Array, contentType: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO game_assets (game_id, name, data, content_type, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(gameId, name, Buffer.from(data), contentType, new Date().toISOString());
  }

  assetGet(gameId: string, name: string): { data: Uint8Array; contentType: string } | null {
    const row = this.db
      .prepare("SELECT data, content_type FROM game_assets WHERE game_id = ? AND name = ?")
      .get(gameId, name) as { data: Buffer; content_type: string } | undefined;
    return row ? { data: row.data, contentType: row.content_type } : null;
  }

  assetList(gameId: string): { name: string; contentType: string; size: number }[] {
    const rows = this.db
      .prepare("SELECT name, content_type, LENGTH(data) AS size FROM game_assets WHERE game_id = ? ORDER BY created_at")
      .all(gameId) as { name: string; content_type: string; size: number }[];
    return rows.map((r) => ({ name: r.name, contentType: r.content_type, size: r.size }));
  }

  assetDelete(gameId: string, name: string): void {
    this.db.prepare("DELETE FROM game_assets WHERE game_id = ? AND name = ?").run(gameId, name);
  }

  libraryAssetAdd(entry: { id: string; name: string; data: Uint8Array; contentType: string; author: string }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO library_assets (id, name, data, content_type, author, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(entry.id, entry.name, Buffer.from(entry.data), entry.contentType, entry.author, new Date().toISOString());
  }

  libraryAssetList(): { id: string; name: string; contentType: string; size: number; author: string }[] {
    const rows = this.db
      .prepare("SELECT id, name, content_type, LENGTH(data) AS size, author FROM library_assets ORDER BY created_at DESC LIMIT 200")
      .all() as { id: string; name: string; content_type: string; size: number; author: string }[];
    return rows.map((r) => ({ id: r.id, name: r.name, contentType: r.content_type, size: r.size, author: r.author }));
  }

  libraryAssetGet(id: string): { data: Uint8Array; contentType: string } | null {
    const row = this.db.prepare("SELECT data, content_type FROM library_assets WHERE id = ?").get(id) as
      | { data: Buffer; content_type: string }
      | undefined;
    return row ? { data: row.data, contentType: row.content_type } : null;
  }

  setCover(id: string, data: Uint8Array | null, contentType?: string): void {
    if (data === null) {
      this.db.prepare("UPDATE games SET cover = NULL, cover_type = NULL, updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), id);
    } else {
      this.db.prepare("UPDATE games SET cover = ?, cover_type = ?, updated_at = ? WHERE id = ?")
        .run(Buffer.from(data), contentType ?? "image/jpeg", new Date().toISOString(), id);
    }
  }

  getCover(id: string): { data: Uint8Array; contentType: string } | null {
    const row = this.db.prepare("SELECT cover, cover_type FROM games WHERE id = ?").get(id) as
      | { cover: Buffer | null; cover_type: string | null }
      | undefined;
    if (!row?.cover) return null;
    return { data: row.cover, contentType: row.cover_type ?? "image/jpeg" };
  }

  addPlay(id: string): void {
    const r = this.db.prepare("UPDATE games SET plays = plays + 1 WHERE id = ?").run(id);
    if (r.changes === 0) return;
    this.db
      .prepare(
        `INSERT INTO game_stats_daily (game_id, date, plays, likes) VALUES (?, ?, 1, 0)
         ON CONFLICT(game_id, date) DO UPDATE SET plays = plays + 1`
      )
      .run(id, today());
  }

  addLike(id: string, delta: 1 | -1): void {
    const r = this.db.prepare("UPDATE games SET likes = MAX(0, likes + ?) WHERE id = ?").run(delta, id);
    if (r.changes === 0) return;
    this.db
      .prepare(
        `INSERT INTO game_stats_daily (game_id, date, plays, likes) VALUES (?, ?, 0, ?)
         ON CONFLICT(game_id, date) DO UPDATE SET likes = likes + excluded.likes`
      )
      .run(id, today(), delta);
  }

  addPlaySeconds(id: string, seconds: number): void {
    const s = Math.max(0, Math.min(600, Math.floor(seconds)));
    if (s === 0) return;
    const r = this.db.prepare("UPDATE games SET play_seconds = play_seconds + ? WHERE id = ?").run(s, id);
    if (r.changes === 0) return;
    this.db
      .prepare(
        `INSERT INTO game_stats_daily (game_id, date, plays, likes, play_seconds) VALUES (?, ?, 0, 0, ?)
         ON CONFLICT(game_id, date) DO UPDATE SET play_seconds = play_seconds + excluded.play_seconds`
      )
      .run(id, today(), s);
  }

  getStats(id: string): {
    likes: number;
    plays: number;
    playSeconds: number;
    daily: { date: string; plays: number; likes: number; playSeconds: number }[];
  } {
    const totals = this.db.prepare("SELECT likes, plays, play_seconds FROM games WHERE id = ?").get(id) as
      | { likes: number; plays: number; play_seconds: number }
      | undefined;
    const daily = this.db
      .prepare(
        "SELECT date, plays, likes, play_seconds AS playSeconds FROM game_stats_daily WHERE game_id = ? ORDER BY date DESC LIMIT 90"
      )
      .all(id) as { date: string; plays: number; likes: number; playSeconds: number }[];
    return { likes: totals?.likes ?? 0, plays: totals?.plays ?? 0, playSeconds: totals?.play_seconds ?? 0, daily };
  }

  setPublished(id: string, published: boolean): void {
    this.db
      .prepare("UPDATE games SET published = ?, updated_at = ? WHERE id = ?")
      .run(published ? 1 : 0, new Date().toISOString(), id);
  }

  private toSummary(row: GameRow): GameSummary {
    let title = row.id;
    let description = "";
    let kind: GameSummary["kind"] = "unknown";
    let coverPreset: string | undefined;
    try {
      const config = JSON.parse(row.config) as GameConfig;
      title = config.meta?.title ?? row.id;
      description = config.meta?.description ?? "";
      coverPreset = config.meta?.coverPreset;
      kind = (["story", "life", "sim"] as const).find((k) => k === config.driver?.kind) ?? "unknown";
    } catch {
      // 摘要解析失败不致命
    }
    return {
      id: row.id,
      title,
      description,
      author: row.author,
      kind,
      updatedAt: row.updated_at,
      hasCover: row.has_cover === 1,
      coverPreset,
      likes: row.likes ?? 0,
      plays: row.plays ?? 0,
    };
  }

  private static readonly SUMMARY_COLS =
    "id, config, design_card, chat, author, published, edit_key, created_at, updated_at, likes, plays, (cover IS NOT NULL) AS has_cover";

  listPublished(limit = 100): GameSummary[] {
    const rows = this.db
      .prepare(`SELECT ${SqliteGameStore.SUMMARY_COLS} FROM games WHERE published = 1 ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as GameRow[];
    return rows.map((r) => this.toSummary(r));
  }

  listByAuthor(author: string): GameSummary[] {
    const rows = this.db
      .prepare(`SELECT ${SqliteGameStore.SUMMARY_COLS} FROM games WHERE published = 1 AND author = ? ORDER BY updated_at DESC`)
      .all(author) as GameRow[];
    return rows.map((r) => this.toSummary(r));
  }

  // ---------------- 作品归属与账号 ----------------

  gameOwner(id: string): string | null {
    const row = this.db.prepare("SELECT owner_id FROM games WHERE id = ?").get(id) as
      | { owner_id: string | null }
      | undefined;
    return row?.owner_id ?? null;
  }

  /** 用编辑钥匙把游客作品收归账号；只认领当前无主的，返回成功条数 */
  claimGames(userId: string, keys: { id: string; editKey: string }[]): number {
    const check = this.db.prepare("SELECT edit_key, owner_id FROM games WHERE id = ?");
    const claim = this.db.prepare("UPDATE games SET owner_id = ? WHERE id = ? AND owner_id IS NULL");
    let n = 0;
    const tx = this.db.transaction((list: { id: string; editKey: string }[]) => {
      for (const k of list) {
        const row = check.get(k.id) as { edit_key: string; owner_id: string | null } | undefined;
        if (!row || !k.editKey || row.edit_key !== k.editKey || row.owner_id) continue;
        claim.run(userId, k.id);
        n += 1;
      }
    });
    tx(keys);
    return n;
  }

  listByOwner(userId: string): GameSummary[] {
    const rows = this.db
      .prepare(`SELECT ${SqliteGameStore.SUMMARY_COLS} FROM games WHERE owner_id = ? ORDER BY updated_at DESC`)
      .all(userId) as GameRow[];
    return rows.map((r) => this.toSummary(r));
  }

  userCreate(input: { username: string; passwordHash: string; salt: string }): UserRecord {
    const id = newId();
    const now = new Date().toISOString();
    // 平台的第一个注册者就是管理员——没有别人可以授权他
    const role = this.userCount() === 0 ? "admin" : "user";
    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.username, input.passwordHash, input.salt, role, now);
    return { id, username: input.username, role, createdAt: now };
  }

  userByName(username: string): (UserRecord & { passwordHash: string; salt: string }) | null {
    const row = this.db
      .prepare("SELECT id, username, password_hash, salt, role, created_at FROM users WHERE username = ?")
      .get(username) as
      | { id: string; username: string; password_hash: string; salt: string; role: string; created_at: string }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      role: row.role === "admin" ? "admin" : "user",
      createdAt: row.created_at,
      passwordHash: row.password_hash,
      salt: row.salt,
    };
  }

  userById(id: string): UserRecord | null {
    const row = this.db.prepare("SELECT id, username, role, created_at FROM users WHERE id = ?").get(id) as
      | { id: string; username: string; role: string; created_at: string }
      | undefined;
    if (!row) return null;
    return { id: row.id, username: row.username, role: row.role === "admin" ? "admin" : "user", createdAt: row.created_at };
  }

  userCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    return row.n;
  }

  userSetRole(id: string, role: "user" | "admin"): void {
    this.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  }

  sessionCreate(userId: string, tokenHash: string, expiresAt: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenHash, userId, new Date().toISOString(), expiresAt);
    // 顺手清理过期会话，免得表无限长
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  }

  sessionUser(tokenHash: string): UserRecord | null {
    const row = this.db
      .prepare(
        `SELECT u.id, u.username, u.role, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`
      )
      .get(tokenHash, new Date().toISOString()) as
      | { id: string; username: string; role: string; created_at: string }
      | undefined;
    if (!row) return null;
    return { id: row.id, username: row.username, role: row.role === "admin" ? "admin" : "user", createdAt: row.created_at };
  }

  sessionDelete(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  aiConsume(key: string, tokens: number): { requests: number; tokens: number } {
    this.db
      .prepare(
        `INSERT INTO ai_usage (key, date, requests, tokens) VALUES (?, ?, 1, ?)
         ON CONFLICT(key, date) DO UPDATE SET requests = requests + 1, tokens = tokens + excluded.tokens`
      )
      .run(key, today(), tokens);
    return this.aiUsageToday(key);
  }

  aiUsageToday(key: string): { requests: number; tokens: number } {
    const row = this.db
      .prepare("SELECT requests, tokens FROM ai_usage WHERE key = ? AND date = ?")
      .get(key, today()) as { requests: number; tokens: number } | undefined;
    return row ?? { requests: 0, tokens: 0 };
  }

  adminStats(): ReturnType<GameStore["adminStats"]> {
    const g = this.db
      .prepare("SELECT COUNT(*) AS total, SUM(published) AS pub FROM games")
      .get() as { total: number; pub: number | null };
    const creators = (
      this.db.prepare("SELECT COUNT(DISTINCT author) AS n FROM games WHERE author != ''").get() as { n: number }
    ).n;
    const accountsRow = this.db
      .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins FROM users")
      .get() as { total: number; admins: number | null };
    const totals = this.db
      .prepare("SELECT COALESCE(SUM(plays),0) AS plays, COALESCE(SUM(likes),0) AS likes, COALESCE(SUM(play_seconds),0) AS ps FROM games")
      .get() as { plays: number; likes: number; ps: number };
    const daily = (
      this.db
        .prepare(
          `SELECT date, SUM(plays) AS plays, SUM(likes) AS likes, SUM(play_seconds) AS ps
           FROM game_stats_daily GROUP BY date ORDER BY date DESC LIMIT 14`
        )
        .all() as { date: string; plays: number; likes: number; ps: number }[]
    ).map((r) => ({ date: r.date, plays: r.plays, likes: r.likes, playSeconds: r.ps }));
    const topGames = (
      this.db
        .prepare(
          `SELECT id, config, author, published, plays, likes, play_seconds AS ps
           FROM games ORDER BY plays DESC, likes DESC LIMIT 10`
        )
        .all() as { id: string; config: string; author: string; published: number; plays: number; likes: number; ps: number }[]
    ).map((r) => {
      let title = r.id;
      try {
        title = (JSON.parse(r.config) as GameConfig).meta?.title ?? r.id;
      } catch {
        // 摘要失败不致命
      }
      return { id: r.id, title, author: r.author, plays: r.plays, likes: r.likes, playSeconds: r.ps, published: r.published === 1 };
    });
    const aiTotal = this.db
      .prepare("SELECT COALESCE(SUM(requests),0) AS r, COALESCE(SUM(tokens),0) AS t FROM ai_usage")
      .get() as { r: number; t: number };
    const aiToday = this.db
      .prepare("SELECT COALESCE(SUM(requests),0) AS r, COALESCE(SUM(tokens),0) AS t FROM ai_usage WHERE date = ?")
      .get(today()) as { r: number; t: number };
    const libCards = (this.db.prepare("SELECT COUNT(*) AS n FROM library_cards").get() as { n: number }).n;
    const libAssets = (this.db.prepare("SELECT COUNT(*) AS n FROM library_assets").get() as { n: number }).n;
    return {
      games: { total: g.total, published: g.pub ?? 0, drafts: g.total - (g.pub ?? 0) },
      creators,
      accounts: { total: accountsRow.total, admins: accountsRow.admins ?? 0 },
      totals: { plays: totals.plays, likes: totals.likes, playSeconds: totals.ps },
      daily,
      topGames,
      ai: { totalRequests: aiTotal.r, totalTokens: aiTotal.t, todayRequests: aiToday.r, todayTokens: aiToday.t },
      library: { cards: libCards, assets: libAssets },
    };
  }

  libraryAdd(entry: LibraryEntry): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO library_cards (id, name, category, tags, card, required_vars, source, author, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.name,
        entry.category,
        entry.tags.join(","),
        JSON.stringify(entry.card),
        JSON.stringify(entry.requiredVars),
        entry.source,
        entry.author,
        entry.createdAt
      );
  }

  libraryList(filter?: { category?: string; tag?: string; q?: string; limit?: number }): LibraryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM library_cards ORDER BY created_at DESC LIMIT 500")
      .all() as {
      id: string;
      name: string;
      category: string;
      tags: string;
      card: string;
      required_vars: string;
      source: string;
      author: string;
      created_at: string;
    }[];
    const q = filter?.q?.trim().toLowerCase();
    const out: LibraryEntry[] = [];
    for (const r of rows) {
      const tags = r.tags ? r.tags.split(",") : [];
      if (filter?.category && r.category !== filter.category) continue;
      if (filter?.tag && !tags.includes(filter.tag)) continue;
      let card: CardDef;
      try {
        card = JSON.parse(r.card);
      } catch {
        continue;
      }
      if (q && !(r.name.toLowerCase().includes(q) || card.text.toLowerCase().includes(q) || tags.some((t) => t.toLowerCase().includes(q)))) {
        continue;
      }
      out.push({
        id: r.id,
        name: r.name,
        category: r.category,
        tags,
        card,
        requiredVars: JSON.parse(r.required_vars || "[]"),
        source: r.source as LibraryEntry["source"],
        author: r.author,
        createdAt: r.created_at,
      });
      if (out.length >= (filter?.limit ?? 100)) break;
    }
    return out;
  }

  /** 官方内容入库：按 manifest 从示例模板精选卡片（可复跑，覆盖更新） */
  seedLibrary(templatesDir: string): void {
    let manifest: { template: string; cardId: string; category: string; tags: string[] }[];
    try {
      manifest = JSON.parse(readFileSync(path.join(templatesDir, "library-manifest.json"), "utf8"));
    } catch {
      return;
    }
    const configs = new Map<string, GameConfig>();
    const now = new Date().toISOString();
    for (const m of manifest) {
      try {
        if (!configs.has(m.template)) {
          configs.set(m.template, JSON.parse(readFileSync(path.join(templatesDir, m.template), "utf8")));
        }
        const config = configs.get(m.template)!;
        const card = config.cards.find((c) => c.id === m.cardId);
        if (!card || shareBlockReason(card)) continue;
        this.libraryAdd({
          id: `official:${m.template}:${m.cardId}`,
          name: card.title?.replace(/^[^：]*：/, "") || card.id,
          category: m.category,
          tags: m.tags,
          card,
          requiredVars: extractRequiredVars(card, config),
          source: "official",
          author: "官方",
          createdAt: now,
        });
      } catch {
        // 单条失败不阻塞
      }
    }
  }
}
