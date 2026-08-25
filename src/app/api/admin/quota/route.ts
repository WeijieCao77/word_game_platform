import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUser } from "@/lib/session";
import { userGrantDefault } from "@/lib/ai/quota";

export const dynamic = "force-dynamic";

// 额度审批。注册用户把额度池用光时会自动开一条申请单，管理员在这里批。
// 鉴权跟 /api/admin/stats 一致：只认管理员角色，不依赖任何环境变量。

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
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = requireAdmin(req);
  if (denied) return denied;
  let body: { id?: number; tokens?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少申请单 id" }, { status: 400 });
  // tokens 传 0 表示拒绝（申请单落成 denied，不加额度）
  const tokens = Number.isFinite(Number(body.tokens)) ? Math.max(0, Math.floor(Number(body.tokens))) : userGrantDefault();
  const result = getStore().quotaRequestResolve(id, tokens);
  if (!result) return NextResponse.json({ error: "申请单不存在或已处理过" }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}
