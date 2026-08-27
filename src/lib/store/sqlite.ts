import Database from "better-sqlite3";
import { makePreviewToken, checkPreviewToken } from "@/lib/preview-token";
import { mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { GameConfig, CardDef, validateGameConfig } from "@/lib/schema";
import { LibraryEntry, extractRequiredVars, shareBlockReason } from "@/lib/library";
import { PlayCheckReport } from "@/lib/playcheck/types";
import { AiJobRecord, ChatTurn, GameRecord, GameStore, GameSummary, QuotaRequest, UserRecord } from "./types";

/** ai_jobs 表的一行 */
interface AiJobRow {
  id: string;
  game_id: string;
  status: string;
  note: string;
  result: string;
  error: string;
  created_at: string;
  updated_at: string;
}

function toJob(r: AiJobRow): AiJobRecord {
  let result: unknown = null;
  try {
    result = r.result ? JSON.parse(r.result) : null;
  } catch {
    result = null; // 结果坏了不该让轮询整个失败
  }
  return {
    id: r.id,
    gameId: r.game_id,
    status: r.status === "done" ? "done" : r.status === "error" ? "error" : "running",
    note: r.note,
    result,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function newId(): string {
  return randomBytes(6).toString("base64url").replace(/[-_]/g, "a").toLowerCase();
}

function newEditKey(): string {
  return randomBytes(24).toString("hex");
}

/**
 * 注册账号的初始 AI 额度（总量，不是日额度）。
 * 默认 200 万——按实际消耗，从零做完一款能发布的游戏大概 20~100 万，
 * 所以这个数够做两三款、反复调优也够用，正常创作者感觉不到限制；
 * 同时又是一道真闸门：想拿它当免费聊天机器人用的，烧到头必须来找管理员批。
 * 这是全站唯一的默认额度来源，@/lib/ai/quota 的 userGrantDefault 直接转发它。
 */
export function defaultGrant(): number {
  return Number(process.env.AI_USER_GRANT ?? 2_000_000);
}

/**
 * 「今天」按东八区算（平台用户主要在国内）。
 * 用 UTC 会变成每天早上 8 点才重置配额与日统计，反直觉。
 */
function today(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
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
  mode?: string;
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
      CREATE TABLE IF NOT EXISTS quota_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        used INTEGER NOT NULL,
        grant_at_request INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        granted INTEGER NOT NULL DEFAULT 0,
        handled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_quota_status ON quota_requests(status, created_at);
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
      // 作品维度的 AI 消耗：用来发现「把工作台当聊天框」的会话
      "ALTER TABLE games ADD COLUMN ai_tokens INTEGER NOT NULL DEFAULT 0",
      // 作品形态：engine=配置喂给通用引擎（快速模式）；code=自带 HTML 包（自由模式）
      "ALTER TABLE games ADD COLUMN mode TEXT NOT NULL DEFAULT 'engine'",
      // 线上正在跑第几版；0 = 还没发布过任何版本
      "ALTER TABLE games ADD COLUMN live_version INTEGER NOT NULL DEFAULT 0",
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
        created_at TEXT NOT NULL,
        -- 账户额度池：已授予的总额度与累计消耗。跟按日重置的 ai_usage 是两套东西——
        -- ai_usage 留着看趋势，额度池才是闸门（用完要管理员手动批）。
        token_grant INTEGER NOT NULL DEFAULT 0,
        tokens_used INTEGER NOT NULL DEFAULT 0
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
    // 老库升级：users 表补额度列。必须放在建表之后——放在上面那个 games 迁移块里
    // 会在 users 表还不存在时执行，ALTER 静默失败，新库反而少了这两列。
    for (const ddl of [
      "ALTER TABLE users ADD COLUMN token_grant INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE users ADD COLUMN tokens_used INTEGER NOT NULL DEFAULT 0",
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS game_assets (
        game_id TEXT NOT NULL,
        name TEXT NOT NULL,
        data BLOB NOT NULL,
        content_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (game_id, name)
      );
      CREATE TABLE IF NOT EXISTS game_files (
        game_id TEXT NOT NULL,
        path TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (game_id, path)
      );
      -- 发布出去的版本。
      --
      -- 在这之前，作品只有一份 config 和一套 game_files，published 只是个布尔开关——
      -- 也就是说**作者在工作台里每保存一次，线上立刻就变**。AI 哪一轮写坏了，
      -- 玩家当场就玩到坏的；玩到一半的人，游戏在他脚下换了；存档格式一改进度就没了。
      -- 而且退不回去。
      --
      -- 现在分开：作者改的是草稿，玩家看到的是**最近一次发布的快照**，
      -- 「发布新版本」才把草稿推上去，坏了可以回滚到上一版。
      CREATE TABLE IF NOT EXISTS game_versions (
        game_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        at TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        config TEXT NOT NULL,
        files TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (game_id, version)
      );

      -- 自由模式作品在浏览器里抛出来的异常。
      -- 快速模式有三级校验 + 600 局模拟兜着，写错了当场打回；自由模式一条都没有，
      -- AI 写完就交差，永远不知道自己的游戏炸了。运行库把异常送回来，存在这儿，
      -- AI 用 read_errors 读得到——这就是自由模式版的校验器。
      CREATE TABLE IF NOT EXISTS game_errors (
        game_id TEXT NOT NULL,
        at TEXT NOT NULL,
        message TEXT NOT NULL,
        stack TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_game_errors ON game_errors(game_id, at);
      -- 试玩体检：平台在浏览器里自动玩一遍的结果（@/lib/playcheck）。
      -- 一部作品只留最新一份——旧报告对不上现在的代码，留着只会把下一轮带偏。
      CREATE TABLE IF NOT EXISTS game_playcheck (
        game_id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        report TEXT NOT NULL
      );
      -- 「我要一份新体检」的挂号簿：AI 挂号，正在轮询的那个浏览器去跑。
      -- 单独一张表而不是给上面加一列，是因为「想要一份」和「已经有一份」
      -- 是两件独立的事：挂号的时候可能一份报告都还没有。
      CREATE TABLE IF NOT EXISTS game_playcheck_want (
        game_id TEXT PRIMARY KEY,
        at TEXT NOT NULL
      );
      -- AI 任务：一轮对话在后台跑，前端轮询要结果。
      -- 原来是同步请求干等，最重的那一轮必然被网关掐成 502，
      -- 所以单轮预算只能压到 240 秒——AI 一轮干不完一件事，只能靠轮次堆。
      -- 落库而不是放内存：容器随时可能重启，重启后前端还得问得到「那一轮怎么样了」。
      CREATE TABLE IF NOT EXISTS ai_jobs (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_jobs_game ON ai_jobs(game_id, created_at);
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
    this.jobSweepOnBoot();
  }

  /**
   * 开机第一件事：把所有还标着 running 的任务判死。
   *
   * 任务是**跑在这个进程里**的（一个 Promise），进程没了活就没了——
   * 可是数据库里那行还写着 running，于是这部作品被永久锁住：
   * 作者发一句就被顶回来一句「这部作品还有一轮在跑」，而那一轮永远不会有结果。
   * 线上真踩到了：合完一个 PR 触发部署，容器一重启，老板就再也发不出话。
   *
   * 判定不需要猜——**能看到这张表的进程，就是唯一会写它的进程**。
   * 启动那一刻还 running 的，必然是上一条命留下的尸体。
   */
  private jobSweepOnBoot(): void {
    const now = new Date().toISOString();
    const n = this.db
      .prepare("UPDATE ai_jobs SET status = 'error', error = ?, updated_at = ? WHERE status = 'running'")
      .run("服务重启了，这一轮没跑完（进度已保存的部分不会丢）。把刚才那句话再发一次就行。", now).changes;
    if (n > 0) console.warn(`[jobs] 启动清理：${n} 条上次没跑完的任务已判失败`);
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
    this.adoptDemosToAdmin(demos.map((d) => d.id));
  }

  /**
   * 官方示例归到平台主人（第一个管理员）名下。
   *
   * 为什么要有：示例入库时是**无主**的，而无主作品只认编辑钥匙——那把钥匙是入库时
   * 随机生成的，谁也没有。结果就是**平台自己的示例，平台主人反而改不了**：
   * 想用工作台调一调官方示例，或者干脆用平台的 AI 去改进它，都无从下手。
   * 这跟「所有游戏都必须能用平台做出来」是直接冲突的。
   *
   * 只认第一个管理员（平台主人），且只动**无主**的——已经归属谁的一律不碰。
   * 每次启动跑一次，幂等；管理员还没注册时什么也不做，下次启动再说。
   */
  private adoptDemosToAdmin(ids: string[]): void {
    const admin = this.db
      .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1")
      .get() as { id: string } | undefined;
    if (!admin) return;
    const claim = this.db.prepare("UPDATE games SET owner_id = ? WHERE id = ? AND owner_id IS NULL");
    for (const id of ids) claim.run(admin.id, id);
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

  private editKeyOf(id: string): string | null {
    const row = this.db.prepare("SELECT edit_key FROM games WHERE id = ?").get(id) as
      | { edit_key: string }
      | undefined;
    return row?.edit_key ?? null;
  }

  previewToken(id: string): string | null {
    const key = this.editKeyOf(id);
    return key ? makePreviewToken(key) : null;
  }

  checkPreviewToken(id: string, token: string): boolean {
    const key = this.editKeyOf(id);
    return !!key && checkPreviewToken(key, token);
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
    this.db.prepare("DELETE FROM game_files WHERE game_id = ?").run(id);
    this.db.prepare("DELETE FROM game_errors WHERE game_id = ?").run(id);
    this.db.prepare("DELETE FROM game_playcheck WHERE game_id = ?").run(id);
    this.db.prepare("DELETE FROM game_playcheck_want WHERE game_id = ?").run(id);
    this.db.prepare("DELETE FROM game_versions WHERE game_id = ?").run(id);
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
    let genre: string | undefined;
    try {
      const config = JSON.parse(row.config) as GameConfig;
      title = config.meta?.title ?? row.id;
      description = config.meta?.description ?? "";
      coverPreset = config.meta?.coverPreset;
      genre = config.meta?.genre;
      kind = (["story", "life", "sim"] as const).find((k) => k === config.driver?.kind) ?? "unknown";
    } catch {
      // 摘要解析失败不致命
    }
    return {
      id: row.id,
      genre,
      title,
      description,
      author: row.author,
      kind,
      // 自由模式的作品 driver 只是个占位，kind 说明不了它——
      // 游戏库要按这个决定打什么标签、点进去去哪儿
      mode: row.mode === "code" ? "code" : "engine",
      updatedAt: row.updated_at,
      hasCover: row.has_cover === 1,
      coverPreset,
      likes: row.likes ?? 0,
      plays: row.plays ?? 0,
    };
  }

  private static readonly SUMMARY_COLS =
    "id, config, design_card, chat, author, published, edit_key, created_at, updated_at, likes, plays, mode, (cover IS NOT NULL) AS has_cover";

  listPublished(limit = 100, sort: "new" | "hot" | "liked" = "new"): GameSummary[] {
    // 热度用「游玩次数为主、点赞为辅」，避免只有几个赞的新作直接盖过被玩了几百次的
    const order =
      sort === "hot" ? "plays DESC, likes DESC, updated_at DESC" : sort === "liked" ? "likes DESC, plays DESC, updated_at DESC" : "updated_at DESC";
    const rows = this.db
      .prepare(`SELECT ${SqliteGameStore.SUMMARY_COLS} FROM games WHERE published = 1 ORDER BY ${order} LIMIT ?`)
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
  gameAssignOwner(id: string, userId: string): boolean {
    // 只划无主的：有归属的作品是别人的财产，管理员也不能拿走
    const r = this.db.prepare("UPDATE games SET owner_id = ? WHERE id = ? AND owner_id IS NULL").run(userId, id);
    return r.changes > 0;
  }

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
    // 注册即发一份初始额度（env 可调）。这是「感觉不到限量」的那一份，
    // 用完不是等明天，而是来找管理员批——所以它是总量，不是日额度。
    this.db.prepare("UPDATE users SET token_grant = ? WHERE id = ?").run(defaultGrant(), id);
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

  userQuota(userId: string): { grant: number; used: number } {
    const row = this.db.prepare("SELECT token_grant AS g, tokens_used AS u FROM users WHERE id = ?").get(userId) as
      | { g: number; u: number }
      | undefined;
    if (!row) return { grant: 0, used: 0 };
    // 老账号建库时没有这一列，补一份默认额度，别让既有用户凭空变成 0
    if (!row.g) {
      const g = defaultGrant();
      this.db.prepare("UPDATE users SET token_grant = ? WHERE id = ?").run(g, userId);
      return { grant: g, used: row.u };
    }
    return { grant: row.g, used: row.u };
  }

  userSpend(userId: string, tokens: number): void {
    this.db.prepare("UPDATE users SET tokens_used = tokens_used + ? WHERE id = ?").run(Math.max(0, tokens), userId);
  }

  userGrantAdd(userId: string, tokens: number): void {
    this.db.prepare("UPDATE users SET token_grant = token_grant + ? WHERE id = ?").run(Math.max(0, tokens), userId);
  }

  quotaRequestOpen(userId: string, used: number, grant: number): void {
    // 同一个人同时只留一条待批，免得刷屏
    const exists = this.db
      .prepare("SELECT id FROM quota_requests WHERE user_id = ? AND status = 'pending'")
      .get(userId) as { id: number } | undefined;
    if (exists) return;
    this.db
      .prepare(
        "INSERT INTO quota_requests (user_id, created_at, used, grant_at_request, status) VALUES (?, ?, ?, ?, 'pending')"
      )
      .run(userId, new Date().toISOString(), used, grant);
  }

  quotaRequestList(onlyPending = true): QuotaRequest[] {
    const rows = this.db
      .prepare(
        `SELECT q.id, q.user_id, u.username, q.created_at, q.used, q.grant_at_request, q.status, q.granted, q.handled_at
         FROM quota_requests q LEFT JOIN users u ON u.id = q.user_id
         ${onlyPending ? "WHERE q.status = 'pending'" : ""}
         ORDER BY q.created_at DESC LIMIT 100`
      )
      .all() as {
      id: number;
      user_id: string;
      username: string | null;
      created_at: string;
      used: number;
      grant_at_request: number;
      status: string;
      granted: number;
      handled_at: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username ?? "(已注销)",
      createdAt: r.created_at,
      used: r.used,
      grantAtRequest: r.grant_at_request,
      status: r.status === "granted" ? "granted" : r.status === "denied" ? "denied" : "pending",
      granted: r.granted,
      handledAt: r.handled_at,
    }));
  }

  quotaRequestResolve(id: number, granted: number): { userId: string; granted: number } | null {
    const row = this.db.prepare("SELECT user_id, status FROM quota_requests WHERE id = ?").get(id) as
      | { user_id: string; status: string }
      | undefined;
    if (!row || row.status !== "pending") return null;
    const run = this.db.transaction(() => {
      this.db
        .prepare("UPDATE quota_requests SET status = ?, granted = ?, handled_at = ? WHERE id = ?")
        .run(granted > 0 ? "granted" : "denied", Math.max(0, granted), new Date().toISOString(), id);
      if (granted > 0) this.userGrantAdd(row.user_id, granted);
    });
    run();
    return { userId: row.user_id, granted: Math.max(0, granted) };
  }

  fileList(gameId: string): { path: string; size: number; updatedAt: string }[] {
    return this.db
      .prepare("SELECT path, length(content) AS size, updated_at FROM game_files WHERE game_id = ? ORDER BY path")
      .all(gameId)
      .map((r) => {
        const row = r as { path: string; size: number; updated_at: string };
        return { path: row.path, size: row.size, updatedAt: row.updated_at };
      });
  }

  fileRead(gameId: string, path: string): string | null {
    const row = this.db
      .prepare("SELECT content FROM game_files WHERE game_id = ? AND path = ?")
      .get(gameId, path) as { content: string } | undefined;
    return row?.content ?? null;
  }

  fileWrite(gameId: string, path: string, content: string): void {
    this.db
      .prepare(
        `INSERT INTO game_files (game_id, path, content, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(game_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
      )
      .run(gameId, path, content, new Date().toISOString());
    this.db.prepare("UPDATE games SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), gameId);
  }

  fileDelete(gameId: string, path: string): void {
    this.db.prepare("DELETE FROM game_files WHERE game_id = ? AND path = ?").run(gameId, path);
  }

  /** 每部作品最多留几个历史版本——够回滚就行，不必当版本控制系统用 */
  private static readonly KEEP_VERSIONS = 10;

  /**
   * 把当前草稿存成一个新版本并推上线。
   *
   * 快速模式存的是 config，自由模式存的是全部文件（数据表也一起，
   * 不然回滚之后作品会去引用一份已经不在的表）。
   */
  versionPublish(gameId: string, note = ""): number {
    const row = this.db.prepare("SELECT config FROM games WHERE id = ?").get(gameId) as
      | { config: string }
      | undefined;
    if (!row) throw new Error("游戏不存在");

    const files: Record<string, string> = {};
    for (const f of this.fileList(gameId)) {
      const content = this.fileRead(gameId, f.path);
      if (content !== null) files[f.path] = content;
    }
    const next =
      ((this.db.prepare("SELECT MAX(version) AS v FROM game_versions WHERE game_id = ?").get(gameId) as
        | { v: number | null }
        | undefined)?.v ?? 0) + 1;

    this.db
      .prepare("INSERT INTO game_versions (game_id, version, at, note, config, files) VALUES (?, ?, ?, ?, ?, ?)")
      .run(gameId, next, new Date().toISOString(), String(note).slice(0, 200), row.config, JSON.stringify(files));
    this.db.prepare("UPDATE games SET live_version = ? WHERE id = ?").run(next, gameId);
    // 只留最近几版，但**正在线上的那一版永远不删**（回滚之后老版本可能才是 live）
    this.db
      .prepare(
        "DELETE FROM game_versions WHERE game_id = ? AND version <> ? AND version NOT IN " +
          "(SELECT version FROM game_versions WHERE game_id = ? ORDER BY version DESC LIMIT ?)"
      )
      .run(gameId, next, gameId, SqliteGameStore.KEEP_VERSIONS);
    return next;
  }

  versionList(gameId: string): { version: number; at: string; note: string; live: boolean }[] {
    const live = this.liveVersion(gameId);
    return (
      this.db
        .prepare("SELECT version, at, note FROM game_versions WHERE game_id = ? ORDER BY version DESC")
        .all(gameId) as { version: number; at: string; note: string }[]
    ).map((v) => ({ ...v, live: v.version === live }));
  }

  liveVersion(gameId: string): number {
    const row = this.db.prepare("SELECT live_version FROM games WHERE id = ?").get(gameId) as
      | { live_version?: number }
      | undefined;
    return row?.live_version ?? 0;
  }

  /**
   * 玩家应该看到的那一份。没发布过任何版本就返回 null——
   * 调用方要据此决定「按草稿渲染」还是「这作品还没上线」。
   */
  versionLive(gameId: string): { version: number; config: unknown; files: Record<string, string> } | null {
    const v = this.liveVersion(gameId);
    if (!v) return null;
    const row = this.db
      .prepare("SELECT version, config, files FROM game_versions WHERE game_id = ? AND version = ?")
      .get(gameId, v) as { version: number; config: string; files: string } | undefined;
    if (!row) return null;
    try {
      return { version: row.version, config: JSON.parse(row.config), files: JSON.parse(row.files || "{}") };
    } catch {
      return null;
    }
  }

  /** 回滚：把线上切回某个历史版本。草稿一个字都不动。 */
  versionRollback(gameId: string, version: number): boolean {
    const exists = this.db
      .prepare("SELECT 1 FROM game_versions WHERE game_id = ? AND version = ?")
      .get(gameId, version);
    if (!exists) return false;
    this.db.prepare("UPDATE games SET live_version = ? WHERE id = ?").run(version, gameId);
    return true;
  }

  /**
   * 记一条运行时报错。
   *
   * 同一条错误反复抛（比如每帧一次）不该把表撑爆，也不该把真正不同的问题挤掉——
   * 所以同一条消息只留最新的一次，每个作品最多留 30 条。
   */
  errorAdd(gameId: string, e: { message: string; stack?: string; source?: string }): void {
    // 先 trim 再判空：全是空格的「报错」记下来只会占位置、还会误导下一轮
    const message = String(e.message ?? "").trim().slice(0, 500);
    if (!message) return;
    this.db.prepare("DELETE FROM game_errors WHERE game_id = ? AND message = ?").run(gameId, message);
    this.db
      .prepare("INSERT INTO game_errors (game_id, at, message, stack, source) VALUES (?, ?, ?, ?, ?)")
      .run(gameId, new Date().toISOString(), message, String(e.stack ?? "").slice(0, 2000), String(e.source ?? "").slice(0, 200));
    this.db
      .prepare(
        "DELETE FROM game_errors WHERE game_id = ? AND rowid NOT IN " +
          "(SELECT rowid FROM game_errors WHERE game_id = ? ORDER BY at DESC LIMIT 30)"
      )
      .run(gameId, gameId);
  }

  errorList(gameId: string): { at: string; message: string; stack: string; source: string }[] {
    return this.db
      .prepare("SELECT at, message, stack, source FROM game_errors WHERE game_id = ? ORDER BY at DESC")
      .all(gameId) as { at: string; message: string; stack: string; source: string }[];
  }

  errorClear(gameId: string): void {
    this.db.prepare("DELETE FROM game_errors WHERE game_id = ?").run(gameId);
  }

  playCheckSet(gameId: string, report: PlayCheckReport): void {
    this.db
      .prepare(
        "INSERT INTO game_playcheck (game_id, at, report) VALUES (?, ?, ?) " +
          "ON CONFLICT(game_id) DO UPDATE SET at = excluded.at, report = excluded.report"
      )
      .run(gameId, report.at, JSON.stringify(report));
    // 报告到了，号就销掉——别让 AI 下一轮又等一次已经跑过的体检
    this.playCheckClearWant(gameId);
  }

  playCheckWant(gameId: string): void {
    this.db
      .prepare(
        "INSERT INTO game_playcheck_want (game_id, at) VALUES (?, ?) " +
          "ON CONFLICT(game_id) DO UPDATE SET at = excluded.at"
      )
      .run(gameId, new Date().toISOString());
  }

  playCheckWantedAt(gameId: string): string | null {
    const row = this.db
      .prepare("SELECT at FROM game_playcheck_want WHERE game_id = ?")
      .get(gameId) as { at: string } | undefined;
    return row?.at ?? null;
  }

  playCheckClearWant(gameId: string): void {
    this.db.prepare("DELETE FROM game_playcheck_want WHERE game_id = ?").run(gameId);
  }

  playCheckGet(gameId: string): PlayCheckReport | null {
    const row = this.db.prepare("SELECT report FROM game_playcheck WHERE game_id = ?").get(gameId) as
      | { report: string }
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.report) as PlayCheckReport;
    } catch {
      return null;
    }
  }

  /**
   * AI 任务：开一条。
   *
   * 同一部作品同时只允许一条在跑——两轮并发改同一份配置只会互相覆盖，
   * 而且创作者也只可能在等一个回复。
   */
  jobCreate(gameId: string, id: string): boolean {
    if (this.jobRunning(gameId)) return false;
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO ai_jobs (id, game_id, status, created_at, updated_at) VALUES (?, ?, 'running', ?, ?)")
      .run(id, gameId, now, now);
    // 一部作品只留最近 20 条，别让这张表无限长
    this.db
      .prepare(
        "DELETE FROM ai_jobs WHERE game_id = ? AND id NOT IN " +
          "(SELECT id FROM ai_jobs WHERE game_id = ? ORDER BY created_at DESC LIMIT 20)"
      )
      .run(gameId, gameId);
    return true;
  }

  /**
   * 这部作品有没有还在跑的任务。
   *
   * 活着的任务每 20 秒打一次心跳（见 assistant 路由），所以**静默三分钟就是死了**。
   * 早先这里写的是 30 分钟——那是没有心跳时的保守值，代价是任务一死作者要被锁半小时，
   * 期间发什么都被顶回来。宁可偶尔多判死一条（重发一句就是了），也不许把人锁住。
   */
  jobRunning(gameId: string): AiJobRecord | null {
    const row = this.db
      .prepare("SELECT * FROM ai_jobs WHERE game_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1")
      .get(gameId) as AiJobRow | undefined;
    if (!row) return null;
    if (Date.now() - Date.parse(row.updated_at) > 3 * 60_000) {
      this.jobFail(row.id, "这一轮三分钟没有心跳，按失败处理（服务多半重启过）。把刚才那句话再发一次就行。");
      return null;
    }
    return toJob(row);
  }

  jobGet(id: string): AiJobRecord | null {
    const row = this.db.prepare("SELECT * FROM ai_jobs WHERE id = ?").get(id) as AiJobRow | undefined;
    return row ? toJob(row) : null;
  }

  /** 干活途中报个进度，顺便刷新心跳（jobRunning 靠它判断任务还活着） */
  jobNote(id: string, note: string): void {
    this.db
      .prepare("UPDATE ai_jobs SET note = ?, updated_at = ? WHERE id = ? AND status = 'running'")
      .run(String(note).slice(0, 500), new Date().toISOString(), id);
  }

  /** 心跳：只刷时间戳，不动 note（活着但没进展的时候也要证明自己还在） */
  jobHeartbeat(id: string): void {
    this.db
      .prepare("UPDATE ai_jobs SET updated_at = ? WHERE id = ? AND status = 'running'")
      .run(new Date().toISOString(), id);
  }

  /** 作者主动放弃这一轮：后台那个 Promise 拦不住，但锁必须立刻放开 */
  jobAbandon(gameId: string): boolean {
    const job = this.db
      .prepare("SELECT id FROM ai_jobs WHERE game_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1")
      .get(gameId) as { id: string } | undefined;
    if (!job) return false;
    this.jobFail(job.id, "作者放弃了这一轮。");
    return true;
  }

  jobDone(id: string, result: unknown): void {
    this.db
      .prepare("UPDATE ai_jobs SET status = 'done', result = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(result ?? null), new Date().toISOString(), id);
  }

  jobFail(id: string, error: string): void {
    this.db
      .prepare("UPDATE ai_jobs SET status = 'error', error = ?, updated_at = ? WHERE id = ?")
      .run(String(error).slice(0, 2000), new Date().toISOString(), id);
  }

  gameMode(id: string): "engine" | "code" {
    const row = this.db.prepare("SELECT mode FROM games WHERE id = ?").get(id) as { mode?: string } | undefined;
    return row?.mode === "code" ? "code" : "engine";
  }

  gameSetMode(id: string, mode: "engine" | "code"): void {
    this.db.prepare("UPDATE games SET mode = ? WHERE id = ?").run(mode, id);
  }

  gameAiSpend(id: string, tokens: number): number {
    this.db.prepare("UPDATE games SET ai_tokens = ai_tokens + ? WHERE id = ?").run(Math.max(0, tokens), id);
    return this.gameAiTokens(id);
  }

  gameAiTokens(id: string): number {
    const row = this.db.prepare("SELECT ai_tokens AS t FROM games WHERE id = ?").get(id) as { t: number } | undefined;
    return row?.t ?? 0;
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
