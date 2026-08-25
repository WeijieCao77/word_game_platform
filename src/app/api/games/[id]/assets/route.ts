import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 素材清单（凭编辑钥匙——工作台素材面板用） */
export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!store.checkEditKey(id, req.headers.get("x-edit-key") ?? "")) {
    return NextResponse.json({ error: "没有编辑权限（editKey 不正确）" }, { status: 403 });
  }
  return NextResponse.json({ assets: store.assetList(id) });
}
