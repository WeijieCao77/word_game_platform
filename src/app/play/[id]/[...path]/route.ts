import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame } from "@/lib/session";
import { runtimeAsset } from "@/lib/runtime";
import { datasetSourcesFor, wrapDataset } from "@/lib/dataset";
import { injectPlayDiagnostics } from "@/lib/play-diagnostics";
import { injectPlayCheck } from "@/lib/playcheck/sweep";

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
  csv: "text/csv; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/** 只许平常的相对路径：不许 .. 上跳、不许绝对路径、不许奇怪字符 */
/**
 * 出口这一层的路径校验。
 *
 * 字符集跟写入那一层（api/games/:id/files 的 badPath）保持一致：ASCII 收紧，
 * 非 ASCII 放行——中文创作者的数据表就叫「队伍表.csv」，作品里写
 * <script src="data/队伍表.js">，这里拦掉的话文件存进去了却取不出来。
 * 两层判据必须同步改，只改一层就是「传得上、读不到」。
 *
 * 结构性规则一条不松：`..`、开头斜杠、反斜杠、控制字符、超长，一概拒绝。
 */
function safePath(parts: string[]): string | null {
  const p = parts.join("/");
  if (!p || p.length > 200) return null;
  if (p.includes("..") || p.startsWith("/") || p.includes("\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(p)) return null;
  if (!/^[A-Za-z0-9/._\u0080-\uffff-]+$/.test(p)) return null;
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

  // 作者带着凭据来 = 看草稿（他要看的正是刚改完的东西）；
  // 玩家 = 看最近一次发布的那份快照。
  const key = req.headers.get("x-edit-key") ?? new URL(req.url).searchParams.get("k") ?? "";
  const isAuthor =
    (pass && store.checkPreviewToken(id, pass)) || canEditGame(req, id) || store.checkEditKey(id, key);

  // 未发布的作品只有作者本人看得到。三种凭据：
  //   1. 请求头（接口调用）
  //   2. cookie（工作台预览换来的通行证——**子资源只有这一条走得通**：
  //      index.html 里相对引用的 style.css / game.js，浏览器不会带上 ?k=）
  //   3. ?k=（直接开链接时的兜底）
  if (!record.published && !isAuthor) {
    // 拒绝也要带上 ACAO。沙箱是不透明源，它取子资源算跨域——不带这个头的话，
    // 浏览器把 403 变成一句「blocked by CORS policy」，看的人（和 AI）会去查
    // 一个根本不存在的跨域配置问题，而真相只是「这作品没发布」。
    return new NextResponse("not published", {
      status: 403,
      headers: { "access-control-allow-origin": "*" },
    });
  }

  // 作品自己的文件优先，没有再看两种虚拟文件：
  //   1. 运行库 wgp.js / wgp.css——写一个同名文件就顶掉了
  //   2. 数据表的孪生 js：请求 data/roster.js 时，把 data/roster.csv 包成一段赋值语句
  //      （沙箱里 connect-src 'none'，作品读不到 .csv，只能靠 <script src> 进来）
  // 玩家读线上快照；作者读草稿。快照里没有的路径（运行库、数据表孪生 js）照旧兜底。
  const live = isAuthor ? null : store.versionLive(id);
  const own = live ? (live.files[rel] ?? null) : store.fileRead(id, rel);
  const content =
    own ??
    runtimeAsset(rel) ??
    (live ? datasetTwinFrom(live.files, rel) : datasetTwin(store, id, rel));
  if (content === null) return new NextResponse("not found", { status: 404 });

  const ext = rel.split(".").pop()?.toLowerCase() ?? "txt";
  // 入口页出口注入：兜底诊断 + 给脚本标 crossorigin。
  // 作品的文件一个字都没改——所有已有作品立刻受益，不必等 AI 再写一轮。
  const isHtml = ext === "html" || ext === "htm";
  // 试玩体检模式：再叠一段会自己去点的脚本（@/lib/playcheck）。
  // 两道闸门都是故意的——**玩家绝不能被塞进一个自动点击器**：
  //   1. 要显式带 ?wgpcheck=1（工作台的隐藏 iframe 和实测脚本才会这么开）
  //   2. 要有编辑权限（作者本人或带钥匙的调用方）
  const wantCheck = new URL(req.url).searchParams.get("wgpcheck") === "1" && isAuthor;
  const body = isHtml
    ? wantCheck
      ? injectPlayCheck(injectPlayDiagnostics(content))
      : injectPlayDiagnostics(content)
    : content;
  return new NextResponse(body, {
    headers: {
      "content-type": MIME[ext] ?? MIME.txt,
      "x-content-type-options": "nosniff",
      // 沙箱 iframe 是不透明源，脚本算跨域，浏览器会把 window.onerror 的详情
      // 抹成一句 Script error.（行号文件名全没）。配合 index.html 里注入的
      // crossorigin="anonymous"，这个头让浏览器把真实报错交出来——
      // 没有它，AI 和作者永远只能看见黑屏加一句废话。
      "access-control-allow-origin": "*",
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

/** 数据表 data/x.csv|json → 作品能 <script src> 引进去的 data/x.js */
function datasetTwin(store: ReturnType<typeof getStore>, id: string, rel: string): string | null {
  const spec = datasetSourcesFor(rel);
  if (!spec) return null;
  for (const src of spec.candidates) {
    const raw = store.fileRead(id, src);
    if (raw !== null) return wrapDataset(spec.name, src, raw);
  }
  return null;
}

/** 快照里的数据表 → 孪生 js（玩家侧走这条，读的是发布那一刻的那份表） */
function datasetTwinFrom(files: Record<string, string>, rel: string): string | null {
  const spec = datasetSourcesFor(rel);
  if (!spec) return null;
  for (const src of spec.candidates) {
    const raw = files[src];
    if (raw !== undefined) return wrapDataset(spec.name, src, raw);
  }
  return null;
}
