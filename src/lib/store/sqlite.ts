import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { GameConfig, CardDef } from "@/lib/schema";
import { LibraryEntry, extractRequiredVars, shareBlockReason } from "@/lib/library";
import { GameRecord, GameStore, GameSummary } from "./types";

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
  author: string;
  published: number;
  edit_key: string;
  created_at: string;
  updated_at: string;
}

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
  }

  /** 启动时同步官方示例：不存在则作为已发布游戏入库，已存在则刷新配置（模板改进随部署上线） */
  seedDemos(templatesDir: string): void {
    const demos: { id: string; file: string }[] = [
      { id: "xiuxian", file: "life-demo.json" },
      { id: "yeye-bus", file: "story-demo.json" },
      { id: "esports-lite", file: "sim-demo.json" },
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
        const author = (JSON.parse(config) as GameConfig).meta.author ?? "官方示例";
        const exists = this.db.prepare("SELECT id FROM games WHERE id = ?").get(d.id);
        if (exists) update.run(config, author, now, d.id);
        else insert.run(d.id, config, "", author, newEditKey(), now, now);
      } catch {
        // 模板缺失不阻塞启动（sim-demo 在 sim 调度器上线前不存在，属预期）
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
    const row = this.db.prepare("SELECT * FROM games WHERE id = ?").get(id) as GameRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      config: JSON.parse(row.config),
      designCard: row.design_card,
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

  setPublished(id: string, published: boolean): void {
    this.db
      .prepare("UPDATE games SET published = ?, updated_at = ? WHERE id = ?")
      .run(published ? 1 : 0, new Date().toISOString(), id);
  }

  private toSummary(row: GameRow): GameSummary {
    let title = row.id;
    let description = "";
    let kind: GameSummary["kind"] = "unknown";
    try {
      const config = JSON.parse(row.config) as GameConfig;
      title = config.meta?.title ?? row.id;
      description = config.meta?.description ?? "";
      kind = (["story", "life", "sim"] as const).find((k) => k === config.driver?.kind) ?? "unknown";
    } catch {
      // 摘要解析失败不致命
    }
    return { id: row.id, title, description, author: row.author, kind, updatedAt: row.updated_at };
  }

  listPublished(limit = 100): GameSummary[] {
    const rows = this.db
      .prepare("SELECT * FROM games WHERE published = 1 ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as GameRow[];
    return rows.map((r) => this.toSummary(r));
  }

  listByAuthor(author: string): GameSummary[] {
    const rows = this.db
      .prepare("SELECT * FROM games WHERE published = 1 AND author = ? ORDER BY updated_at DESC")
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
