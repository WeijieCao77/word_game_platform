import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 公共素材库清单（公开）：作者自愿共享的图片素材 */
export function GET(): NextResponse {
  return NextResponse.json({ assets: getStore().libraryAssetList() });
}
