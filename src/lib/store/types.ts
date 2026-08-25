// 存储层接口。v1 用 SQLite（一游戏一行 JSON），
// 将来换 Postgres 只需要重新实现这个接口。

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
  claimGames(userId: string, keys: { id: string; editKey: string }[]): number;
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
