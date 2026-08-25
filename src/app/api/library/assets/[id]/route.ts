import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 公共素材库图片（公开读；导入=前端取字节后传入自己游戏的素材接口） */
export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const asset = getStore().libraryAssetGet(decodeURIComponent(id));
  if (!asset) return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  return new NextResponse(Buffer.from(asset.data), {
    headers: {
      "content-type": asset.contentType,
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}
