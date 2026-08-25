import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** 当前账号名下的作品（含未发布草稿）——换设备登录就能找回 */
export function GET(req: NextRequest): NextResponse {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  return NextResponse.json({ games: getStore().listByOwner(user.id) });
}
