// 存储层接口。v1 用 SQLite（一游戏一行 JSON），
// 将来换 Postgres 只需要重新实现这个接口。

import { PlayCheckReport } from "@/lib/playcheck/types";

/** 作品形态：engine = 一份配置喂通用引擎；code = 自由模式，作品自带一套页面 */
export type GameMode = "engine" | "code";

/** 额度申请：注册用户把额度池用光时自动落一条，管理员在开发者后台批 */
export interface QuotaRequest {
  id: number;
  userId: string;
  username: string;
  createdAt: string;
  /** 提交申请时的累计消耗 */
  used: number;
  /** 提交申请时手上的总额度 */
  grantAtRequest: number;
  status: "pending" | "granted" | "denied";
  granted: number;
  handledAt: string | null;
}

/** 与 AI 策划的对话记录（服务端持久化，关页面不丢） */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GameRecord {
  id: string;
  config: unknown;
  /** AI 策划与作者共同维护的设计卡（markdown） */
  designCard: string;
  /** 与 AI 策划的历史对话 */
  chat: ChatTurn[];
  /** 是否有作者上传的自定义封面 */
  hasCover: boolean;
  author: string;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GameSummary {
  id: string;
  title: string;
  description: string;
  author: string;
  kind: "story" | "life" | "sim" | "unknown";
  /** 作品形态：engine=配置喂通用引擎；code=自由模式，自带一套页面 */
  mode: GameMode;
  updatedAt: string;
  /** 是否有作者上传的自定义封面（有则 /api/games/:id/cover 可取） */
  hasCover: boolean;
  /** 作者选的封面预设样式 id */
  coverPreset?: string;
  /** 题材（推理/恋爱/经营…），游戏库分类用 */
  genre?: string;
  /** 点赞数与进入游玩次数（累计） */
  likes: number;
  plays: number;
}

/** 平台账号。游客不需要账号也能创作与游玩，账号解决的是「换设备找回作品」 */
export interface UserRecord {
  id: string;
  username: string;
  role: "user" | "admin";
  createdAt: string;
}

export interface GameStore {
  create(input: { config: unknown; designCard?: string; author?: string; ownerId?: string }): { id: string; editKey: string };
  get(id: string): GameRecord | null;
  /** 校验 editKey；true 表示有编辑权 */
  checkEditKey(id: string, editKey: string): boolean;
  /**
   * 未发布作品的预览通行证：由编辑钥匙推出、半小时一换。
   * 钥匙本身不出存储层——通行证只够读这一部作品的文件。
   */
  previewToken(id: string): string | null;
  checkPreviewToken(id: string, token: string): boolean;
  update(id: string, patch: { config?: unknown; designCard?: string; author?: string }): void;
  /** 删除游戏（连带按日统计；已分享到内容库的卡片是独立副本，保留） */
  delete(id: string): void;
  /** 追加对话记录（服务端持久化，超出上限时保留最新的） */
  appendChat(id: string, turns: ChatTurn[]): void;
  /** 自定义封面：data=null 表示移除 */
  setCover(id: string, data: Uint8Array | null, contentType?: string): void;
  getCover(id: string): { data: Uint8Array; contentType: string } | null;
  /** 游戏内图片素材（作者上传，卡片以名称引用） */
  assetPut(gameId: string, name: string, data: Uint8Array, contentType: string): void;
  assetGet(gameId: string, name: string): { data: Uint8Array; contentType: string } | null;
  assetList(gameId: string): { name: string; contentType: string; size: number }[];
  assetDelete(gameId: string, name: string): void;
  /** 公共素材库：作者自愿共享的图片，他人可导入自己的游戏 */
  libraryAssetAdd(entry: { id: string; name: string; data: Uint8Array; contentType: string; author: string }): void;
  libraryAssetList(): { id: string; name: string; contentType: string; size: number; author: string }[];
  libraryAssetGet(id: string): { data: Uint8Array; contentType: string } | null;
  /** 统计：进入游玩 +1 / 点赞增减 / 游玩时长累计（按日累计，创作者数据后台的地基） */
  addPlay(id: string): void;
  addLike(id: string, delta: 1 | -1): void;
  addPlaySeconds(id: string, seconds: number): void;
  getStats(id: string): {
    likes: number;
    plays: number;
    playSeconds: number;
    daily: { date: string; plays: number; likes: number; playSeconds: number }[];
  };
  setPublished(id: string, published: boolean): void;
  /** 作品归属：游客作品 ownerId 为空，登录后可用编辑钥匙认领 */
  gameOwner(id: string): string | null;
  /** AI 任务（异步跑一轮对话）：开、查、报进度、收尾 */
  jobCreate(gameId: string, id: string): boolean;
  jobRunning(gameId: string): AiJobRecord | null;
  jobGet(id: string): AiJobRecord | null;
  jobNote(id: string, note: string): void;
  jobHeartbeat(id: string): void;
  jobAbandon(gameId: string): boolean;
  jobDone(id: string, result: unknown): void;
  jobFail(id: string, error: string): void;
  claimGames(userId: string, keys: { id: string; editKey: string }[]): number;
  /** 管理员收编：把「无主」作品划归某账号（不验钥匙）。已有归属的一律不动，返回 false */
  gameAssignOwner(id: string, userId: string): boolean;
  listByOwner(userId: string): GameSummary[];
  /** 账号：注册（首个用户自动成为管理员）、登录查询、会话 */
  userCreate(input: { username: string; passwordHash: string; salt: string }): UserRecord;
  userByName(username: string): (UserRecord & { passwordHash: string; salt: string }) | null;
  userById(id: string): UserRecord | null;
  userCount(): number;
  userSetRole(id: string, role: "user" | "admin"): void;
  sessionCreate(userId: string, tokenHash: string, expiresAt: string): void;
  sessionUser(tokenHash: string): UserRecord | null;
  sessionDelete(tokenHash: string): void;
  /** 已发布游戏；sort: new=最近更新（默认）/ hot=按游玩 / liked=按点赞 */
  listPublished(limit?: number, sort?: "new" | "hot" | "liked"): GameSummary[];
  listByAuthor(author: string): GameSummary[];
  /** AI 配额：记一次请求与 token 消耗，返回今日累计；由调用方判断是否超限 */
  aiConsume(key: string, tokens: number): { requests: number; tokens: number };
  aiUsageToday(key: string): { requests: number; tokens: number };
  /**
   * 账户额度池（注册用户专用，游客走上面的按日额度）。
   * grant 是累计授予的总量，used 是累计消耗——用完不是等明天，而是管理员手动批。
   */
  userQuota(userId: string): { grant: number; used: number };
  userSpend(userId: string, tokens: number): void;
  userGrantAdd(userId: string, tokens: number): void;
  /** 额度申请：耗尽时自动开一条；同一用户同时只留一条待批 */
  quotaRequestOpen(userId: string, used: number, grant: number): void;
  quotaRequestList(onlyPending?: boolean): QuotaRequest[];
  quotaRequestResolve(id: number, granted: number): { userId: string; granted: number } | null;
  /**
   * 自由模式的作品文件（HTML / JS / CSS）。
   *
   * 快速模式的作品是一份配置喂给通用引擎；自由模式的作品是**自己的一套页面**，
   * 跑在沙箱 iframe 里，长什么样由作者说了算。二进制素材仍走 game_assets。
   */
  fileList(gameId: string): { path: string; size: number; updatedAt: string }[];
  fileRead(gameId: string, path: string): string | null;
  fileWrite(gameId: string, path: string, content: string): void;
  fileDelete(gameId: string, path: string): void;
  /**
   * 自由模式作品在浏览器里抛的异常。
   *
   * 这是自由模式版的「校验器」：快速模式写错了会被三级校验当场打回、自动重试，
   * 自由模式原本一条都没有——AI 写完就交差，永远不知道自己的游戏炸了，
   * 玩家看到白屏，作者看到的是「AI 说做好了」。
   */
  /**
   * 发布版本。
   *
   * 在这之前，作者在工作台里每保存一次线上立刻就变——AI 哪一轮写坏了玩家当场玩到坏的，
   * 玩到一半的人游戏在他脚下换了，而且退不回去。现在草稿与线上分开：
   * 作者改草稿，玩家看到的是最近一次发布的快照，坏了能回滚。
   */
  versionPublish(gameId: string, note?: string): number;
  versionList(gameId: string): { version: number; at: string; note: string; live: boolean }[];
  liveVersion(gameId: string): number;
  versionLive(gameId: string): { version: number; config: unknown; files: Record<string, string> } | null;
  versionRollback(gameId: string, version: number): boolean;

  errorAdd(gameId: string, e: { message: string; stack?: string; source?: string }): void;
  errorList(gameId: string): { at: string; message: string; stack: string; source: string }[];
  errorClear(gameId: string): void;

  /**
   * 试玩体检的最新一份报告（`@/lib/playcheck`）。
   * 只留最新一份——旧的体检对不上现在的代码，留着只会误导下一轮。
   */
  playCheckSet(gameId: string, report: PlayCheckReport): void;
  playCheckGet(gameId: string): PlayCheckReport | null;
  /** 作品形态：engine=配置 + 通用引擎；code=自带页面 */
  gameMode(id: string): GameMode;
  gameSetMode(id: string, mode: GameMode): void;
  /** 作品维度的 AI 消耗：识别「烧了很多 token 却什么都没搭出来」的会话 */
  gameAiSpend(id: string, tokens: number): number;
  gameAiTokens(id: string): number;
  /** 平台全站汇总（开发者后台专用） */
  adminStats(): {
    games: { total: number; published: number; drafts: number };
    creators: number;
    /** 注册账号数与其中的管理员数（游客不计） */
    accounts: { total: number; admins: number };
    totals: { plays: number; likes: number; playSeconds: number };
    daily: { date: string; plays: number; likes: number; playSeconds: number }[];
    topGames: { id: string; title: string; author: string; plays: number; likes: number; playSeconds: number; published: boolean }[];
    ai: { totalRequests: number; totalTokens: number; todayRequests: number; todayTokens: number };
    library: { cards: number; assets: number };
  };
  /** 内容库 */
  libraryAdd(entry: import("@/lib/library").LibraryEntry): void;
  libraryList(filter?: { category?: string; tag?: string; q?: string; limit?: number }): import("@/lib/library").LibraryEntry[];
}

/**
 * 一次 AI 对话在后台的进度。
 *
 * 为什么要有：原来一轮对话是同步请求干等，最重的那一轮必然被网关掐成 502，
 * 所以单轮预算只能压到 240 秒——AI 一轮干不完一件事，只能靠轮次堆，
 * 复刻一个大作品要 12 轮一个小时。异步之后请求立刻返回，活在后台跑，
 * 前端轮询要结果，单轮时间不再受网关脸色。
 */
export interface AiJobRecord {
  id: string;
  gameId: string;
  status: "running" | "done" | "error";
  /** 干到哪一步了（给创作者看的一句话） */
  note: string;
  /** status=done 时是这一轮的完整结果 */
  result: unknown;
  error: string;
  createdAt: string;
  updatedAt: string;
}
