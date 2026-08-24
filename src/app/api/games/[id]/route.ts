import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { GameConfigSchema, validateGameConfig } from "@/lib/schema";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  const record = store.get(id);
  if (!record) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  const editKey = req.headers.get("x-edit-key") ?? "";
  const canEdit = store.checkEditKey(id, editKey);
  if (!record.published && !canEdit) {
    return NextResponse.json({ error: "游戏未发布" }, { status: 404 });
  }
  return NextResponse.json({
    id: record.id,
    config: record.config,
    author: record.author,
    published: record.published,
    canEdit,
    designCard: canEdit ? record.designCard : undefined,
    updatedAt: record.updatedAt,
  });
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!store.checkEditKey(id, req.headers.get("x-edit-key") ?? "")) {
    return NextResponse.json({ error: "没有编辑权限（editKey 不正确）" }, { status: 403 });
  }
  let body: { config?: unknown; designCard?: string; author?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const patch: { config?: unknown; designCard?: string; author?: string } = {};
  let issues = undefined;
  if (body.config !== undefined) {
    // 保存要求结构合法（zod），语义问题作为 issues 返回但不阻塞草稿保存
    const structural = GameConfigSchema.safeParse(body.config);
    if (!structural.success) {
      return NextResponse.json(
        {
          error: "配置结构不合法，未保存",
          issues: structural.error.issues.map((i) => ({
            severity: "error",
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 }
      );
    }
    patch.config = structural.data;
    issues = validateGameConfig(structural.data).issues;
  }
  if (typeof body.designCard === "string") patch.designCard = body.designCard.slice(0, 20000);
  if (typeof body.author === "string") patch.author = body.author.trim().slice(0, 40);
  store.update(id, patch);
  return NextResponse.json({ ok: true, issues });
}
