import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getStore } from "@/lib/store";
import { blankLife, blankStory } from "@/lib/blank";
import { validateGameConfig } from "@/lib/schema";

export const dynamic = "force-dynamic";

/** 游戏库：已发布游戏列表 */
export function GET(): NextResponse {
  return NextResponse.json({ games: getStore().listPublished() });
}

/** 创建游戏：从空白或官方模板起步，返回 id + editKey */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { template?: string; title?: string; author?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const title = (body.title ?? "").trim().slice(0, 60) || "未命名游戏";
  const author = (body.author ?? "").trim().slice(0, 40);

  let config: unknown;
  const template = body.template ?? "blank-life";
  if (template === "blank-life") config = blankLife(title);
  else if (template === "blank-story") config = blankStory(title);
  else if (template === "demo-life" || template === "demo-story") {
    const file = template === "demo-life" ? "life-demo.json" : "story-demo.json";
    try {
      const parsed = JSON.parse(readFileSync(path.join(process.cwd(), "templates", file), "utf8"));
      parsed.meta.title = title === "未命名游戏" ? parsed.meta.title : title;
      parsed.meta.author = author || undefined;
      config = parsed;
    } catch {
      return NextResponse.json({ error: "模板读取失败" }, { status: 500 });
    }
  } else {
    return NextResponse.json({ error: `未知模板 "${template}"` }, { status: 400 });
  }

  const check = validateGameConfig(config);
  if (!check.ok) {
    return NextResponse.json({ error: "模板配置未通过校验", issues: check.issues }, { status: 500 });
  }
  const { id, editKey } = getStore().create({ config, author });
  return NextResponse.json({ id, editKey });
}
