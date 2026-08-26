import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * 管理员对公开游戏库的处置权。
 *
 * 这一条以前是空的：平台上线之后，**没有任何办法把一部作品从公开库撤下来**——
 * 连平台主人也不行。实测留下的半成品、别人发上来不合适的东西，只能干看着。
 * 一个有公开列表的平台不能没有这个开关。
 *
 * 只做「撤下 / 放回」，不做删除：删是作者的权利，平台不该替他毁掉作品；
 * 撤下只是让它不出现在公开列表里，作者带着钥匙照样能看能改能重新发布。
 */

function guard(req: NextRequest): NextResponse | null {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "这个页面只对管理员开放" }, { status: 403 });
  return null;
}

/** 公开库里现在挂着什么 */
export function GET(req: NextRequest): NextResponse {
  const bad = guard(req);
  if (bad) return bad;
  const games = getStore()
    .listPublished(200, "new")
    .map((g) => ({
      id: g.id,
      title: g.title,
      author: g.author,
      mode: g.mode,
      plays: g.plays,
      likes: g.likes,
      updatedAt: g.updatedAt,
    }));
  return NextResponse.json({ games });
}

/** 撤下或放回 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const bad = guard(req);
  if (bad) return bad;

  let body: { id?: unknown; published?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  const store = getStore();
  if (!id || !store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });

  const published = body.published === true;
  store.setPublished(id, published);
  return NextResponse.json({ ok: true, id, published });
}
