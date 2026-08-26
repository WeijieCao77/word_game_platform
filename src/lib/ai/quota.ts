import { GameStore, UserRecord } from "@/lib/store/types";
import { defaultGrant } from "@/lib/store/sqlite";
import { fmtWan } from "@/lib/format";

// AI 额度：三种身份三套算法。
//
// - 管理员：不限量。平台自己人做示例、压测、救火时不该被自己的额度挡住。
// - 注册用户：**总量额度池**（默认 200 万 token）。用完不是等明天，而是自动开一条
//   申请单，由管理员在开发者后台手动批。这就是「让人感觉不到限量、但确实有闸门」。
// - 游客（没注册）：按日额度（默认每天 40 万）。不能也给一份总量额度——清一下 cookie
//   就能无限刷；日额度既够试用，又是注册的钩子。
//
// 另有一条与身份无关的熔断：一个作品烧掉不少 token 却连一张卡都没有，
// 说明这不是在做游戏，是把工作台当聊天框用。见 checkQuota 的 noOutput 分支。

export type QuotaKind = "admin" | "user" | "guest";

export interface QuotaVerdict {
  allowed: boolean;
  /** 拒绝时给创作者看的话（已经是人话，前端直接显示） */
  reason?: string;
  /** 拒绝的原因分类，前端用来决定要不要显示「去注册」「已通知管理员」 */
  code?: "user_exhausted" | "guest_daily" | "no_output";
}

export interface QuotaView {
  kind: QuotaKind;
  unlimited: boolean;
  /** 当前口径下的已用量（管理员/注册用户=累计，游客=今日） */
  used: number;
  /** 上限；unlimited 时为 0 */
  limit: number;
  remaining: number;
  /** 今日请求数，仅游客受它约束 */
  requests: number;
  maxRequests: number;
}

/** 注册账号的初始额度（总量）。默认值定义在存储层，这里只转发，避免两处各写一个数字。 */
export function userGrantDefault(): number {
  return defaultGrant();
}

/** 游客每日额度。够把一个想法聊成方案、搭出雏形，再往下就该注册了。 */
export function guestDailyTokens(): number {
  return Number(process.env.AI_GUEST_DAILY_TOKENS ?? 400_000);
}

export function guestDailyRequests(): number {
  return Number(process.env.AI_GUEST_DAILY_REQUESTS ?? 60);
}

/**
 * 「光聊不做」的熔断线：一个作品烧到这个数还是零张卡片，就停掉它的 AI。
 * 正常创作远到不了——从聊想法到搭出第一批卡片通常几万 token。
 */
export function noOutputLimit(): number {
  return Number(process.env.AI_NO_OUTPUT_TOKENS ?? 300_000);
}

export function kindOf(user: UserRecord | null): QuotaKind {
  if (!user) return "guest";
  return user.role === "admin" ? "admin" : "user";
}

/** 一次 AI 请求前的准入判断。cardsCount 是该作品当前的卡片数（熔断用）。 */
export function checkQuota(
  store: GameStore,
  args: { user: UserRecord | null; quotaKey: string; gameId: string; cardsCount: number }
): QuotaVerdict {
  const kind = kindOf(args.user);
  if (kind === "admin") return { allowed: true };

  // 与身份无关的熔断：烧了不少却什么都没搭出来
  if (args.cardsCount === 0 && store.gameAiTokens(args.gameId) >= noOutputLimit()) {
    return {
      allowed: false,
      code: "no_output",
      reason:
        `这个作品已经用掉 ${fmtWan(store.gameAiTokens(args.gameId))} token，但一张卡片都还没有。` +
        `AI 策划是用来做游戏的——先让它把方案落成配置（跟它说「按这个方案开搭」），` +
        `或者新建一个作品重新开始。如果确实卡住了，来找管理员。`,
    };
  }

  if (kind === "user" && args.user) {
    const { grant, used } = store.userQuota(args.user.id);
    if (used >= grant) {
      // 自动开一条待批单，管理员在后台能看到
      store.quotaRequestOpen(args.user.id, used, grant);
      return {
        allowed: false,
        code: "user_exhausted",
        reason:
          `你的 AI 额度用完了（${fmtWan(grant)} token）。已经自动给管理员发了一条申请，` +
          `批下来就能接着用——你的作品和聊天记录都在，不会丢。`,
      };
    }
    return { allowed: true };
  }

  const today = store.aiUsageToday(args.quotaKey);
  if (today.tokens >= guestDailyTokens() || today.requests >= guestDailyRequests()) {
    return {
      allowed: false,
      code: "guest_daily",
      reason:
        `游客每天可以用 ${fmtWan(guestDailyTokens())} token，今天用完了（零点后重置）。` +
        `注册一个账号就能一次拿到 ${fmtWan(userGrantDefault())} token，作品也不会因为换设备而丢。`,
    };
  }
  return { allowed: true };
}

/** 一次 AI 请求之后的记账：日表（看趋势）、账户池（闸门）、作品（识别光聊不做）。 */
export function recordSpend(
  store: GameStore,
  args: { user: UserRecord | null; quotaKey: string; gameId: string; tokens: number }
): void {
  store.aiConsume(args.quotaKey, args.tokens);
  store.gameAiSpend(args.gameId, args.tokens);
  // 管理员也照常记账——不限量是不拦，不是不记，后台要能看到烧了多少
  if (args.user) store.userSpend(args.user.id, args.tokens);
}

/** 给前端状态栏的额度视图 */
export function quotaView(
  store: GameStore,
  args: { user: UserRecord | null; quotaKey: string }
): QuotaView {
  const kind = kindOf(args.user);
  const today = store.aiUsageToday(args.quotaKey);
  if (kind === "admin" && args.user) {
    const { used } = store.userQuota(args.user.id);
    return { kind, unlimited: true, used, limit: 0, remaining: 0, requests: today.requests, maxRequests: 0 };
  }
  if (kind === "user" && args.user) {
    const { grant, used } = store.userQuota(args.user.id);
    return {
      kind,
      unlimited: false,
      used,
      limit: grant,
      remaining: Math.max(0, grant - used),
      requests: today.requests,
      maxRequests: 0,
    };
  }
  const limit = guestDailyTokens();
  return {
    kind: "guest",
    unlimited: false,
    used: today.tokens,
    limit,
    remaining: Math.max(0, limit - today.tokens),
    requests: today.requests,
    maxRequests: guestDailyRequests(),
  };
}
