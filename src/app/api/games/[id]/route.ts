import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame, ownershipOf } from "@/lib/session";
import { GameConfigSchema, validateGameConfig } from "@/lib/schema";
import { comparePublished } from "@/lib/publish-drift";

export const dynamic = "force-dynamic";

/** 草稿比线上快照多改了几个文件（自由模式用）；没发布过就是 0 */
function driftCount(store: ReturnType<typeof getStore>, id: string): number {
  const live = store.versionLive(id);
  if (!live) return 0;
  const draft: Record<string, string> = {};
  for (const f of store.fileList(id)) draft[f.path] = store.fileRead(id, f.path) ?? "";
  const d = comparePublished(draft, live.files);
  return d.changed.length + d.removed.length;
}

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  const record = store.get(id);
  if (!record) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  const editKey = req.headers.get("x-edit-key") ?? "";
  const canEdit = canEditGame(req, id);
  const ownership = ownershipOf(req, id);
  if (!record.published && !canEdit) {
    // 手里的钥匙没错，但作品已经绑定到某个账号——明说，别让人以为钥匙丢了。
    // 依然不返回任何作品内容。
    if (ownership.owned && store.checkEditKey(id, editKey)) {
      return NextResponse.json(
        { error: "这部作品已绑定账号，登录归属账号后才能编辑", owned: true },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: "游戏未发布" }, { status: 404 });
  }
  // 作者拿到的是草稿（他要接着改的那份）；玩家拿到的是最近一次发布的快照。
  // 这条分界线是整套版本机制的意义所在——以前作者一保存线上立刻变，
  // AI 写坏一轮，玩家当场就玩到坏的，还退不回去。
  const live = canEdit ? null : store.versionLive(id);
  return NextResponse.json({
    id: record.id,
    config: (live?.config ?? record.config) as typeof record.config,
    liveVersion: store.liveVersion(id),
    // 草稿和线上不一样时，工作台顶栏要提示「有未发布的改动」
    hasUnpublished:
      canEdit && record.published
        ? JSON.stringify(store.versionLive(id)?.config ?? null) !== JSON.stringify(record.config)
        : false,
    /**
     * 自由模式的落差要数**文件**，不是配置。
     *
     * 上面那个 hasUnpublished 比的是 config——自由模式作品的 config 基本不动，
     * 于是「改了三轮文件没发布」在界面上一点提示都没有。平台其实早就在算这件事
     * （`publish-drift.ts`），但**只说给 AI 听**，末尾还写着「先请创作者点发布」，
     * 而作者的界面上根本没有那个按钮。现在按钮有了，这个数也得给它。
     */
    unpublishedFiles: canEdit && record.published ? driftCount(store, id) : 0,
    author: record.author,
    published: record.published,
    listed: record.listed,
    canEdit,
    // 已绑定账号的作品，钥匙不再单独授权——前端据此提示「请登录归属账号」
    owned: ownership.owned,
    isOwner: ownership.isOwner,
    designCard: canEdit ? record.designCard : undefined,
    chat: canEdit ? record.chat : undefined,
    hasCover: record.hasCover,
    // 作品形态：engine=配置喂通用引擎；code=自由模式，作品自带一套页面
    mode: store.gameMode(id),
    updatedAt: record.updatedAt,
  });
}

/** 删除作品：凭编辑钥匙，不可恢复（建议前端先提示导出配置备份） */
export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canEditGame(req, id)) {
    return NextResponse.json({ error: "没有编辑权限（editKey 不正确）" }, { status: 403 });
  }
  store.delete(id);
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canEditGame(req, id)) {
    return NextResponse.json({ error: "没有编辑权限（editKey 不正确）" }, { status: 403 });
  }
  let body: { config?: unknown; designCard?: string; author?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const patch: { config?: unknown; designCard?: string; author?: string } = {};
  let issues = undefined;
  if (body.config !== undefined) {
    // 保存要求结构合法（zod），语义问题作为 issues 返回但不阻塞草稿保存
    const structural = GameConfigSchema.safeParse(body.config);
    if (!structural.success) {
      return NextResponse.json(
        {
          error: "配置结构不合法，未保存",
          issues: structural.error.issues.map((i) => ({
            severity: "error",
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 }
      );
    }
    patch.config = structural.data;
    issues = validateGameConfig(structural.data).issues;
  }
  if (typeof body.designCard === "string") patch.designCard = body.designCard.slice(0, 20000);
  if (typeof body.author === "string") patch.author = body.author.trim().slice(0, 40);
  store.update(id, patch);
  return NextResponse.json({ ok: true, issues });
}
