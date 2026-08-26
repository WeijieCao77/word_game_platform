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
 * 「撤下 / 放回」是日常手段：撤下只是让它不出现在公开列表里，
 * 作者带着钥匙照样能看能改能重新发布。
 *
 * 「删除」是老板明确要的清理手段——实测在库里留了一堆同名半成品，光撤不删
 * 意味着垃圾永远躺在库存里。删除不可恢复（文件、版本、聊天记录一起没），
 * 所以只开给管理员，前端还要二次确认。正常创作者的作品别用这个删，
 * 删他们自己的作品仍然是他们自己的权利。
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
  const store = getStore();
  const games = store.listPublished(200, "new").map((g) => {
    // 自由模式的作品光看标题分不出好坏——两次实测都叫 VAL MANAGER，
    // 一个 17 万字符、一个 1.9 万。把代码量摆出来，一眼就知道哪个是半成品。
    const files = g.mode === "code" ? store.fileList(g.id) : [];
    const codeBytes = files
      .filter((f) => !f.path.startsWith("data/"))
      .reduce((n, f) => n + f.size, 0);
    return {
      id: g.id,
      title: g.title,
      author: g.author,
      mode: g.mode,
      plays: g.plays,
      likes: g.likes,
      updatedAt: g.updatedAt,
      codeFiles: files.filter((f) => !f.path.startsWith("data/")).length,
      codeBytes,
    };
  });
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

/** 彻底删除一部作品（管理员清理实测遗留用，不可恢复） */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const bad = guard(req);
  if (bad) return bad;

  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  const store = getStore();
  if (!id || !store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });

  store.delete(id);
  return NextResponse.json({ ok: true, id, deleted: true });
}
