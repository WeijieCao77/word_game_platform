// 存储层接口。v1 用 SQLite（一游戏一行 JSON），
// 将来换 Postgres 只需要重新实现这个接口。

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
}

export interface GameStore {
  create(input: { config: unknown; designCard?: string; author?: string }): { id: string; editKey: string };
  get(id: string): GameRecord | null;
  /** 校验 editKey；true 表示有编辑权 */
  checkEditKey(id: string, editKey: string): boolean;
  update(id: string, patch: { config?: unknown; designCard?: string; author?: string }): void;
  /** 追加对话记录（服务端持久化，超出上限时保留最新的） */
  appendChat(id: string, turns: ChatTurn[]): void;
  /** 自定义封面：data=null 表示移除 */
  setCover(id: string, data: Uint8Array | null, contentType?: string): void;
  getCover(id: string): { data: Uint8Array; contentType: string } | null;
  setPublished(id: string, published: boolean): void;
  listPublished(limit?: number): GameSummary[];
  listByAuthor(author: string): GameSummary[];
  /** AI 配额：记一次请求与 token 消耗，返回今日累计；由调用方判断是否超限 */
  aiConsume(key: string, tokens: number): { requests: number; tokens: number };
  aiUsageToday(key: string): { requests: number; tokens: number };
  /** 内容库 */
  libraryAdd(entry: import("@/lib/library").LibraryEntry): void;
  libraryList(filter?: { category?: string; tag?: string; q?: string; limit?: number }): import("@/lib/library").LibraryEntry[];
}
