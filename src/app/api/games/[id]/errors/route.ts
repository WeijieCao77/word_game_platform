import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 自由模式作品的运行时报错。
 *
 * 这是自由模式版的「校验器」。快速模式的作品写错了会被三级校验当场打回、
 * 错误自动回喂给 AI；自由模式原本一条护栏都没有——AI 写完就交差，
 * 作品在玩家浏览器里抛异常它一无所知，下一轮还接着往上盖。
 *
 * POST 由沙箱外壳转交（运行库 wgp.js 在沙箱里抓到异常后 postMessage 出来）。
 * **故意不要求编辑钥匙**：真正有价值的正是玩家那边抛出来的错，
 * 而作者本人预览时未必踩得到。代价是任何人都能往这里写，所以：
 *   - 只收已存在的作品，字段全部截断
 *   - 同一条消息只留最新一次、每个作品最多 30 条（存储层保证）
 *   - 读取要编辑权限——报错内容里可能有作品的代码片段
 */
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });

  let body: { message?: unknown; stack?: unknown; source?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const message = String(body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "没有 message" }, { status: 400 });

  store.errorAdd(id, {
    message,
    stack: typeof body.stack === "string" ? body.stack : "",
    source: typeof body.source === "string" ? body.source : "",
  });
  return NextResponse.json({ ok: true });
}

/** 看这部作品最近抛过什么错。报错里可能带代码片段，所以要编辑权限。 */
export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canEditGame(req, id)) return NextResponse.json({ error: "没有编辑权限" }, { status: 403 });
  return NextResponse.json({ errors: store.errorList(id) });
}

/** 修完之后清掉，免得旧错一直挂在那儿误导下一轮 */
export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canEditGame(req, id)) return NextResponse.json({ error: "没有编辑权限" }, { status: 403 });
  store.errorClear(id);
  return NextResponse.json({ ok: true });
}
