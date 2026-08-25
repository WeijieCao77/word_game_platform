import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; name: string }> };

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 500 * 1024;
const MAX_ASSETS = 20;
const NAME_RE = /^[A-Za-z0-9_\-一-鿿]{1,40}$/;

/** 素材公开可读（<img> 无法带头；游戏内图片视为低敏感内容） */
export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id, name } = await params;
  const asset = getStore().assetGet(id, decodeURIComponent(name));
  if (!asset) return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  return new NextResponse(Buffer.from(asset.data), {
    headers: {
      "content-type": asset.contentType,
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

/** 上传/覆盖素材；?share=1 时同时放入公共素材库（作者自愿） */
export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id, name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const store = getStore();
  const record = store.get(id);
  if (!record) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!store.checkEditKey(id, req.headers.get("x-edit-key") ?? "")) {
    return NextResponse.json({ error: "没有编辑权限（editKey 不正确）" }, { status: 403 });
  }
  if (!NAME_RE.test(name)) {
    return NextResponse.json({ error: "素材名只能是中英文/数字/下划线/连字符，40 字以内" }, { status: 400 });
  }
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) return NextResponse.json({ error: "只支持 JPEG/PNG/WebP 图片" }, { status: 415 });
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength === 0) return NextResponse.json({ error: "空文件" }, { status: 400 });
  if (body.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: `素材超过 ${Math.round(MAX_BYTES / 1024)}KB 上限（前端应已压缩）` }, { status: 413 });
  }
  const existing = store.assetList(id);
  if (!existing.some((a) => a.name === name) && existing.length >= MAX_ASSETS) {
    return NextResponse.json({ error: `每个游戏最多 ${MAX_ASSETS} 张素材，先删掉不用的` }, { status: 409 });
  }
  store.assetPut(id, name, body, type);
  const share = new URL(req.url).searchParams.get("share") === "1";
  if (share) {
    store.libraryAssetAdd({ id: `${id}:${name}`, name, data: body, contentType: type, author: record.author || "匿名" });
  }
  return NextResponse.json({ ok: true, shared: share });
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id, name } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!store.checkEditKey(id, req.headers.get("x-edit-key") ?? "")) {
    return NextResponse.json({ error: "没有编辑权限（editKey 不正确）" }, { status: 403 });
  }
  store.assetDelete(id, decodeURIComponent(name));
  return NextResponse.json({ ok: true });
}
