import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame } from "@/lib/session";
import { runtimeAsset } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/**
 * 自由模式作品的静态文件出口。
 *
 * 这里吐出来的是**创作者（AI）写的代码**，所以安全边界必须在这一层立住：
 *
 * 1. 它只在 /p/:id 的 iframe 里被加载，那个 iframe 带 sandbox="allow-scripts"
 *    ——没有 allow-same-origin，浏览器给它一个**不透明源**：读不到平台的 cookie、
 *    localStorage、也拿不到 window.parent 的任何东西。存档走 postMessage 交给平台。
 * 2. CSP 掐死外连：connect-src 'none' 让它发不出请求，
 *    形式上杜绝「把玩家数据偷偷传出去」和「拿访客机器挖矿的回传」。
 * 3. nosniff + 明确 content-type，避免把 .txt 当脚本执行这类花招。
 */

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
};

/** 只许平常的相对路径：不许 .. 上跳、不许绝对路径、不许奇怪字符 */
function safePath(parts: string[]): string | null {
  const p = parts.join("/");
  if (!p || p.length > 200) return null;
  if (p.includes("..") || p.startsWith("/") || p.includes("\\")) return null;
  if (!/^[A-Za-z0-9/._-]+$/.test(p)) return null;
  return p;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> }
): Promise<NextResponse> {
  const { id, path } = await params;
  const segs = [...(path ?? [])];
  // 路径里的预览通行证：/play/:id/k~<token>/index.html
  // 放路径而不是查询串，是为了让 index.html 里的相对引用也带得上（见 preview-token.ts）
  const pass = segs[0]?.startsWith("k~") ? segs.shift()!.slice(2) : "";
  const rel = safePath(segs);
  if (!rel) return new NextResponse("bad path", { status: 400 });

  const store = getStore();
  const record = store.get(id);
  if (!record) return new NextResponse("not found", { status: 404 });

  // 未发布的作品只有作者本人看得到。三种凭据：
  //   1. 请求头（接口调用）
  //   2. cookie（工作台预览换来的通行证——**子资源只有这一条走得通**：
  //      index.html 里相对引用的 style.css / game.js，浏览器不会带上 ?k=）
  //   3. ?k=（直接开链接时的兜底）
  if (!record.published) {
    const key = req.headers.get("x-edit-key") ?? new URL(req.url).searchParams.get("k") ?? "";
    const ok =
      (pass && store.checkPreviewToken(id, pass)) || canEditGame(req, id) || store.checkEditKey(id, key);
    if (!ok) return new NextResponse("not published", { status: 403 });
  }

  // 作品自己的文件优先；没有再看是不是运行库的虚拟文件（wgp.js / wgp.css）——
  // 作者想换掉运行库，写一个同名文件就顶掉了
  const content = store.fileRead(id, rel) ?? runtimeAsset(rel);
  if (content === null) return new NextResponse("not found", { status: 404 });

  const ext = rel.split(".").pop()?.toLowerCase() ?? "txt";
  return new NextResponse(content, {
    headers: {
      "content-type": MIME[ext] ?? MIME.txt,
      "x-content-type-options": "nosniff",
      // 只能被本站嵌；发不出任何网络请求；不许开新窗口跳外链
      "content-security-policy":
        "default-src 'self' data: blob:; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; " +
        "font-src 'self' data:; " +
        "media-src 'self' data: blob:; " +
        "connect-src 'none'; " +
        "form-action 'none'; " +
        "frame-ancestors 'self'",
      "cache-control": "no-store",
    },
  });
}
