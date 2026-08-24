import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { GameConfig } from "@/lib/schema";
import { CardDefSchema } from "@/lib/schema/zod";
import { LIBRARY_CATEGORIES, extractRequiredVars, shareBlockReason } from "@/lib/library";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

/** 内容库列表：?category=机遇&tag=修仙&q=关键词 */
export function GET(req: NextRequest): NextResponse {
  const sp = req.nextUrl.searchParams;
  const entries = getStore().libraryList({
    category: sp.get("category") ?? undefined,
    tag: sp.get("tag") ?? undefined,
    q: sp.get("q") ?? undefined,
    limit: 100,
  });
  return NextResponse.json({ entries });
}

/** 创作者分享：把自己游戏里的一张卡入库（凭该游戏的 editKey） */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { gameId?: string; cardId?: string; category?: string; tags?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const store = getStore();
  const gameId = body.gameId ?? "";
  const record = store.get(gameId);
  if (!record) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!store.checkEditKey(gameId, req.headers.get("x-edit-key") ?? "")) {
    return NextResponse.json({ error: "没有该游戏的编辑权限" }, { status: 403 });
  }
  const config = record.config as GameConfig;
  const card = config.cards?.find((c) => c.id === body.cardId);
  if (!card) return NextResponse.json({ error: "卡片不存在" }, { status: 404 });
  const structural = CardDefSchema.safeParse(card);
  if (!structural.success) return NextResponse.json({ error: "卡片结构不合法" }, { status: 400 });
  const blocked = shareBlockReason(card);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });
  const category = (body.category ?? "").trim();
  if (!(LIBRARY_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: `分类需为：${LIBRARY_CATEGORIES.join(" / ")}` }, { status: 400 });
  }
  const tags = (body.tags ?? [])
    .map((t) => String(t).trim())
    .filter((t) => t.length > 0 && t.length <= 12)
    .slice(0, 5);
  store.libraryAdd({
    id: `creator:${gameId}:${card.id}:${randomBytes(3).toString("hex")}`,
    name: card.title?.replace(/^[^：]*：/, "") || card.id,
    category,
    tags,
    card,
    requiredVars: extractRequiredVars(card, config),
    source: "creator",
    author: record.author || "匿名创作者",
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}
