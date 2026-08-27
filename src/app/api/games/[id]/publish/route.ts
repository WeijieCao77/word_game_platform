import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame } from "@/lib/session";
import { validateGameConfig } from "@/lib/schema";
import { checkCodePublish, describeGate, gateBlocks } from "@/lib/publish-gate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 「发布」原来是**一个开关管三件事**，这里把它拆开了。
 *
 * 三件事本来就是三件：
 *
 *   ① **发新版本** —— 把当前草稿打成快照推给玩家。随时可点。
 *   ② **链接可达** —— 拿到链接的人能不能玩。跟挂不挂公开库无关。
 *   ③ **公开挂牌** —— 在游戏库里列不列出来。
 *
 * 挤在一个布尔里的代价是实打实的：
 *
 * - 作品**一旦发布，作者再改就没有任何按钮能把改动推给玩家**——那个按钮
 *   这时候写着「取消发布」。要上线只能先取消（链接当场对所有人 403，**链接立刻死掉**）
 *   再点发布，中间一段真空，而且界面上没有任何地方提示要这么做。
 *   平台**知道**有落差却只告诉了 AI（`publish-drift.ts` 末尾写着「先请创作者点发布」），
 *   可作者的界面上根本没有那个按钮。
 * - 后台「撤下」动的也是同一个字段，于是**把半成品撤下公开库
 *   ＝ 把作者和测试者的链接一起弄死**。
 *
 * 老的请求体 `{ published: true|false }` 继续能用（脚本和旧前端都在发它），
 * 语义是「三件事一起做/一起收」——跟改之前一模一样。
 */
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  const record = store.get(id);
  if (!record) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canEditGame(req, id)) {
    return NextResponse.json({ error: "没有编辑权限（editKey 不正确）" }, { status: 403 });
  }
  let body: {
    published?: boolean;
    publishVersion?: boolean;
    linkOpen?: boolean;
    listed?: boolean;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  // 老写法 { published: true|false } = 三件事一起做/一起收
  const legacy = typeof body.published === "boolean" ? body.published : null;
  const wantVersion = body.publishVersion === true || legacy === true;
  const wantLink = typeof body.linkOpen === "boolean" ? body.linkOpen : legacy;
  const wantListed = typeof body.listed === "boolean" ? body.listed : legacy;

  if (legacy === null && body.publishVersion === undefined && wantLink === null && wantListed === null) {
    return NextResponse.json(
      { error: "没说要做什么：publishVersion / linkOpen / listed 至少给一个" },
      { status: 400 }
    );
  }

  /**
   * 什么时候要过门槛：**只有让玩家多看见东西的时候**。
   *
   * 发新版本、把链接打开、挂上公开库——这三件都会让玩家看到新东西，都得过。
   * 反过来关掉任何一样都不用过：作者随时有权把自己的作品收回去。
   */
  const opensUp = wantVersion || wantLink === true || wantListed === true;
  if (opensUp) {
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

  // 发新版本：把当前草稿存成一个新版本推上线。
  // 玩家看到的是这份快照，之后作者再改草稿也不会动到线上——
  // 以前是改一次线上立刻变，AI 写坏一轮玩家当场就玩到坏的。
  let version = store.liveVersion(id);
  if (wantVersion) {
    const note = typeof body.note === "string" ? body.note : "";
    version = store.versionPublish(id, note);
    // 发了版本却没人能打开，等于没发——首发时顺手把链接打开。
    // 作者要是**明确**传了 linkOpen: false，那是他的意思，照办。
    if (wantLink === null) store.setPublished(id, true);
  }
  if (wantLink !== null) store.setPublished(id, wantLink);
  if (wantListed !== null) store.setListed(id, wantListed);

  const after = store.get(id);
  return NextResponse.json({
    ok: true,
    // published 这个字段名留着不动：老前端和脚本都在读它，它现在的意思是「链接可达」
    published: after?.published ?? false,
    listed: after?.listed ?? false,
    version,
  });
}
