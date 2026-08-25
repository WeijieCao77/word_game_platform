import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * 未发布作品的预览通行证。
 *
 * 自由模式的作品是多个文件：index.html 里用相对路径引 style.css / game.js。
 * 这两条路都试过、都不行：
 *   - ?k= —— 浏览器发子请求时不带查询串，样式和脚本全 403
 *   - cookie —— 沙箱 iframe 是不透明源，它发的子请求算「跨站」，SameSite=Lax 不会带
 * 所以通行证走**路径**：/play/:id/k~<token>/index.html，
 * 相对引用自然落到 /play/:id/k~<token>/style.css。细节见 src/lib/preview-token.ts。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canEditGame(req, id)) return NextResponse.json({ error: "没有编辑权限" }, { status: 403 });

  const token = store.previewToken(id);
  if (!token) return NextResponse.json({ error: "取不到预览通行证" }, { status: 500 });
  return NextResponse.json({ token });
}
