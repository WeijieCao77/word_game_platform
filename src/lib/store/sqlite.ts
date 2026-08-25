import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { GameConfig, CardDef, validateGameConfig } from "@/lib/schema";
import { LibraryEntry, extractRequiredVars, shareBlockReason } from "@/lib/library";
import { ChatTurn, GameRecord, GameStore, GameSummary } from "./types";

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
    ]) {
      try {
        this.db.exec(ddl);
      } catch {
        // 列已存在
      }
    }
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

  create(input: { config: unknown; designCard?: string; author?: string }): { id: string; editKey: string } {
    const id = newId();
    const editKey = newEditKey();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO games (id, config, design_card, author, published, edit_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
      )
      .run(id, JSON.stringify(input.config), input.designCard ?? "", input.author ?? "", editKey, now, now);
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
