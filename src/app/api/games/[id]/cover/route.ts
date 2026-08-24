import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 500 * 1024;

// 封面公开可读（<img> 无法带自定义头，草稿封面视为低敏感内容）
export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const cover = getStore().getCover(id);
  if (!cover) return NextResponse.json({ error: "没有自定义封面" }, { status: 404 });
  return new NextResponse(Buffer.from(cover.data), {
    headers: {
      "content-type": cover.contentType,
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!store.checkEditKey(id, req.headers.get("x-edit-key") ?? "")) {
    return NextResponse.json({ error: "没有编辑权限（editKey 不正确）" }, { status: 403 });
  }
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ error: "只支持 JPEG/PNG/WebP 图片" }, { status: 415 });
  }
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength === 0) return NextResponse.json({ error: "空文件" }, { status: 400 });
  if (body.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: `封面超过 ${Math.round(MAX_BYTES / 1024)}KB 上限（前端应已压缩，请重试）` }, { status: 413 });
  }
  store.setCover(id, body, type);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!store.checkEditKey(id, req.headers.get("x-edit-key") ?? "")) {
    return NextResponse.json({ error: "没有编辑权限（editKey 不正确）" }, { status: 403 });
  }
  store.setCover(id, null);
  return NextResponse.json({ ok: true });
}
