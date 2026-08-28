import { GameStore, UserRecord } from "@/lib/store/types";
import { defaultGrant } from "@/lib/store/sqlite";
import { fmtWan } from "@/lib/format";

// AI 额度：三种身份三套算法。
//
// - 管理员：不限量。平台自己人做示例、压测、救火时不该被自己的额度挡住。
// - 注册用户：**总量额度池**（默认 200 万 token）。用完不是等明天，而是自动开一条
//   申请单，由管理员在开发者后台手动批。这就是「让人感觉不到限量、但确实有闸门」。
// - 旗舰位：**管理员手动指定的注册用户**，池子放到 2000 万（AI_FLAGSHIP_GRANT）。
//   它不是第四套算法——算法跟注册用户一模一样（总量池、照常记账、用完照样要人批），
//   变的只有池子有多大和额度用完时说的那句话。见 flagshipGrant() 的注释。
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
  /** 旗舰位：额度算法跟普通注册用户一样，只是池子大得多。界面上要认得出来 */
  flagship: boolean;
}

/** 注册账号的初始额度（总量）。默认值定义在存储层，这里只转发，避免两处各写一个数字。 */
export function userGrantDefault(): number {
  return defaultGrant();
}

/**
 * 旗舰位的额度。
 *
 * 这个数是被验收标准逼出来的，不是拍脑袋：平台自己搭 VAL MANAGER 量级的作品，
 * 实测 12 轮烧掉 **733 万 token** 才到 17 万字符——而那还是个半成品
 * （原作 13,132 行）。按 200 万的注册额度，深度创作者连三成都走不到就会撞墙。
 *
 * 所以默认给 2000 万：够把那种体量搭完，还留得下反复回炉修的余量。
 *
 * 为什么是「手动指定」而不是「谁都给」：额度是真金白银，2000 万发给每个注册用户
 * 平台立刻烧穿。老板拍的板是**先给深度创作者开这道门，由人决定给谁**——
 * 平台侧要保证的是「想做大作品的人做得成」，不是「人人都能无限烧」。
 */
export function flagshipGrant(): number {
  return Number(process.env.AI_FLAGSHIP_GRANT ?? 20_000_000);
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
    const { grant, used, flagship } = store.userQuota(args.user.id);
    if (used >= grant) {
      // 自动开一条待批单，管理员在后台能看到
      store.quotaRequestOpen(args.user.id, used, grant);
      return {
        allowed: false,
        code: "user_exhausted",
        reason: flagship
          ? `旗舰位的 AI 额度也用完了（${fmtWan(grant)} token）。已经自动给管理员发了一条申请，` +
            `批下来就能接着用——你的作品和聊天记录都在，不会丢。`
          : // 普通账号这里要多说一句「还有旗舰位这条路」。不说的话，
            // 一个正在搭大作品的人撞到 200 万的墙，只会以为平台就到这儿了——
            // 而验收标准要求的那种体量，200 万本来就走不到三成。
            `你的 AI 额度用完了（${fmtWan(grant)} token）。已经自动给管理员发了一条申请，` +
            `批下来就能接着用——你的作品和聊天记录都在，不会丢。` +
            `如果你在做一部大体量的作品（几十个界面那种），在申请里说一声，` +
            `管理员可以给你开旗舰位（一次 ${fmtWan(flagshipGrant())} token）。`,
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
    return {
      kind,
      unlimited: true,
      used,
      limit: 0,
      remaining: 0,
      requests: today.requests,
      maxRequests: 0,
      flagship: false,
    };
  }
  if (kind === "user" && args.user) {
    const { grant, used, flagship } = store.userQuota(args.user.id);
    return {
      kind,
      unlimited: false,
      used,
      limit: grant,
      remaining: Math.max(0, grant - used),
      requests: today.requests,
      maxRequests: 0,
      flagship,
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
    flagship: false,
  };
}
