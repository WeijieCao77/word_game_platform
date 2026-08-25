import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 自由模式作品的文件：列表 / 读 / 写 / 删。
// 写权限跟配置一样走 canEditGame（归属优先于钥匙）。

/** 单个文件的大小上限：一份文字游戏的 index.html 再大也到不了这个数 */
const MAX_FILE = 400_000;
/** 一部作品的文件数上限，防止刷爆存储 */
const MAX_FILES = 60;

function badPath(p: string): boolean {
  return (
    !p ||
    p.length > 200 ||
    p.includes("..") ||
    p.startsWith("/") ||
    p.includes("\\") ||
    !/^[A-Za-z0-9/._-]+$/.test(p)
  );
}

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canEditGame(req, id)) return NextResponse.json({ error: "没有编辑权限" }, { status: 403 });

  const path = new URL(req.url).searchParams.get("path");
  if (path) {
    if (badPath(path)) return NextResponse.json({ error: "路径不合法" }, { status: 400 });
    const content = store.fileRead(id, path);
    if (content === null) return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    return NextResponse.json({ path, content });
  }
  return NextResponse.json({ files: store.fileList(id), mode: store.gameMode(id) });
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canEditGame(req, id)) return NextResponse.json({ error: "没有编辑权限" }, { status: 403 });

  let body: { path?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const path = String(body.path ?? "");
  const content = String(body.content ?? "");
  if (badPath(path)) return NextResponse.json({ error: "路径不合法（只许相对路径、字母数字点横线斜杠）" }, { status: 400 });
  if (content.length > MAX_FILE) {
    return NextResponse.json({ error: `单个文件不能超过 ${MAX_FILE / 1000}k 字符，把它拆开` }, { status: 400 });
  }
  const existing = store.fileList(id);
  if (existing.length >= MAX_FILES && !existing.some((f) => f.path === path)) {
    return NextResponse.json({ error: `一部作品最多 ${MAX_FILES} 个文件` }, { status: 400 });
  }

  store.fileWrite(id, path, content);
  // 一旦开始写文件，这部作品就是自由模式了
  if (store.gameMode(id) !== "code") store.gameSetMode(id, "code");
  return NextResponse.json({ ok: true, files: store.fileList(id) });
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canEditGame(req, id)) return NextResponse.json({ error: "没有编辑权限" }, { status: 403 });
  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (badPath(path)) return NextResponse.json({ error: "路径不合法" }, { status: 400 });
  store.fileDelete(id, path);
  return NextResponse.json({ ok: true, files: store.fileList(id) });
}
