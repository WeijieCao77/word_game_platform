import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame } from "@/lib/session";
import { validateGameConfig } from "@/lib/schema";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  const record = store.get(id);
  if (!record) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canEditGame(req, id)) {
    return NextResponse.json({ error: "没有编辑权限（editKey 不正确）" }, { status: 403 });
  }
  let body: { published?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const publish = body.published === true;
  if (publish) {
    // 发布门槛：全量校验必须无错误（警告放行）
    const check = validateGameConfig(record.config);
    if (!check.ok) {
      return NextResponse.json(
        { error: "配置存在错误，修复后才能发布", issues: check.issues },
        { status: 400 }
      );
    }
  }
  store.setPublished(id, publish);
  return NextResponse.json({ ok: true, published: publish });
}
