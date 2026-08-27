import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame } from "@/lib/session";
import { checkFileBudget } from "@/lib/file-budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 自由模式作品的文件：列表 / 读 / 写 / 删。
// 写权限跟配置一样走 canEditGame（归属优先于钥匙）。


/**
 * 路径合法性。
 *
 * ASCII 那半边照旧收紧（字母数字点横线斜杠，不许空格引号尖括号），
 * 但**非 ASCII 一律放行**——中文创作者的数据表就叫「队伍表.csv」，
 * 逼他改成 t-e0w92b 之后，他和 AI 都认不出这张表是什么了。
 *
 * 放宽的是字符集，不是结构：`..`、开头的斜杠、反斜杠、超长仍然一概拒绝。
 * 而且文件是存在 SQLite 里按路径当键的（见 store.fileWrite），根本不落文件系统，
 * 所以这里防的是路由与 URL，不是目录穿越。
 */
function badPath(p: string): boolean {
  return (
    !p ||
    p.length > 200 ||
    p.includes("..") ||
    p.startsWith("/") ||
    p.includes("\\") ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(p) ||
    !/^[A-Za-z0-9/._\u0080-\uffff-]+$/.test(p)
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
  // 代码文件与数据表分两本账算，另加一道总量闸门（见 lib/file-budget.ts）——
  // 老板问「几十个 csv 怎么办」问出来的：原来两样共用 60 个名额，
  // 数据一多就把 AI 写代码的空间挤没了。
  const verdict = checkFileBudget(store.fileList(id), path, content.length);
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 400 });

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
