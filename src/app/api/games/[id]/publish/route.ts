import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame } from "@/lib/session";
import { validateGameConfig } from "@/lib/schema";
import { checkCodePublish, describeGate, gateBlocks } from "@/lib/publish-gate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  const record = store.get(id);
  if (!record) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canEditGame(req, id)) {
    return NextResponse.json({ error: "没有编辑权限（editKey 不正确）" }, { status: 403 });
  }
  let body: { published?: boolean; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const publish = body.published === true;
  if (publish) {
    if (store.gameMode(id) === "code") {
      /**
       * 自由模式：**查文件，别查那份不参与运行的配置。**
       *
       * 这里原来跟快速模式共用一句 `validateGameConfig(record.config)`，
       * 而自由模式作品的 config 是新建时生成的一份空白故事配置——它不执行，
       * 玩家跑的是 files 里的 html/js。于是这道门槛永远是绿的，
       * **文件一个字都没看过就放行**：老板那句「游戏库里新出现的 val manager
       * 根本玩不了」就是从这个口子进去的（开局抛 registerSetup is not defined）。
       */
      const files = store.fileList(id).map((f) => ({
        path: f.path,
        content: store.fileRead(id, f.path) ?? "",
        updatedAt: f.updatedAt,
      }));
      const issues = checkCodePublish(files, store.playCheckGet(id));
      if (gateBlocks(issues)) {
        return NextResponse.json(
          { error: describeGate(issues), issues, gate: "code" },
          { status: 400 }
        );
      }
    } else {
      // 快速模式：全量校验必须无错误（警告放行）
      const check = validateGameConfig(record.config);
      if (!check.ok) {
        return NextResponse.json(
          { error: "配置存在错误，修复后才能发布", issues: check.issues },
          { status: 400 }
        );
      }
    }
  }
  store.setPublished(id, publish);
  // 发布不只是翻个开关：把当前草稿存成一个新版本推上线。
  // 玩家看到的是这份快照，之后作者再改草稿也不会动到线上——
  // 以前是改一次线上立刻变，AI 写坏一轮玩家当场就玩到坏的。
  let version = store.liveVersion(id);
  if (publish) {
    const note = typeof (body as { note?: unknown }).note === "string" ? (body as { note: string }).note : "";
    version = store.versionPublish(id, note);
  }
  return NextResponse.json({ ok: true, published: publish, version });
}
