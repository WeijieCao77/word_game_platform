import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * 认领：把本机编辑钥匙持有的游客作品收归当前账号。
 * 只认领当前无主的作品，且必须出示正确的编辑钥匙——别人的作品认领不走。
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let body: { keys?: { id?: string; editKey?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const keys = (body.keys ?? [])
    .filter((k) => typeof k?.id === "string" && typeof k?.editKey === "string")
    .slice(0, 200)
    .map((k) => ({ id: k.id as string, editKey: k.editKey as string }));
  const claimed = getStore().claimGames(user.id, keys);
  return NextResponse.json({ claimed });
}
