import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUser } from "@/lib/session";
import { flagshipGrant, userGrantDefault } from "@/lib/ai/quota";

export const dynamic = "force-dynamic";

// 额度审批。注册用户把额度池用光时会自动开一条申请单，管理员在这里批。
// 鉴权跟 /api/admin/stats 一致：只认管理员角色，不依赖任何环境变量。
//
// 这里有**两条**通路，缺一条都不行：
//
//   1. 被动：等他撞墙 → 系统自动开申请单 → 管理员批（action 省略或 "resolve"）
//   2. 主动：管理员直接找到某个账号放额 / 升旗舰位（action = "grant" | "flagship"）
//
// 第二条是设计体检第五条的解法。原来只有第一条，后果是一个正在搭大作品的人
// **必须先撞一次墙**才可能拿到额度——而撞墙那一下往往正卡在半途，
// 作者只看到「额度用完了」，并不知道还有旗舰位这条路。

function requireAdmin(req: NextRequest): NextResponse | null {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "这个页面只对管理员开放" }, { status: 403 });
  return null;
}

export function GET(req: NextRequest): NextResponse {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const store = getStore();
  const all = new URL(req.url).searchParams.get("all") === "1";
  return NextResponse.json({
    requests: store.quotaRequestList(!all),
    defaultGrant: userGrantDefault(),
    flagshipGrant: flagshipGrant(),
    accounts: store.userAccounts(),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = requireAdmin(req);
  if (denied) return denied;
  let body: { id?: number; tokens?: number; action?: string; userId?: string; on?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const store = getStore();

  // ── 主动放额：直接给某个账号加一笔 ─────────────────────────
  if (body.action === "grant") {
    const userId = String(body.userId ?? "");
    if (!userId) return NextResponse.json({ error: "缺少账号 id" }, { status: 400 });
    if (!store.userById(userId)) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    const tokens = Math.floor(Number(body.tokens));
    if (!Number.isFinite(tokens) || tokens <= 0) {
      return NextResponse.json({ error: "要加的额度得是个正数" }, { status: 400 });
    }
    store.userGrantAdd(userId, tokens);
    return NextResponse.json({ ok: true, ...store.userQuota(userId) });
  }

  // ── 升 / 降旗舰位 ───────────────────────────────────────────
  if (body.action === "flagship") {
    const userId = String(body.userId ?? "");
    if (!userId) return NextResponse.json({ error: "缺少账号 id" }, { status: 400 });
    const on = body.on !== false;
    const result = store.userSetFlagship(userId, on, flagshipGrant());
    if (!result) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    return NextResponse.json({ ok: true, flagship: on, ...result });
  }

  // ── 批一条申请单（原有通路） ────────────────────────────────
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少申请单 id" }, { status: 400 });
  // tokens 传 0 表示拒绝（申请单落成 denied，不加额度）
  const tokens = Number.isFinite(Number(body.tokens)) ? Math.max(0, Math.floor(Number(body.tokens))) : userGrantDefault();
  const result = store.quotaRequestResolve(id, tokens);
  if (!result) return NextResponse.json({ error: "申请单不存在或已处理过" }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}
