import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getStore } from "@/lib/store";
import { blankLife, blankSim, blankStory } from "@/lib/blank";
import { validateGameConfig } from "@/lib/schema";
import { DESIGN_CARD_TEMPLATE } from "@/lib/ai/designcard";

export const dynamic = "force-dynamic";

// 创建限流：每 IP 每小时最多 12 个新游戏（内存计数，防脚本刷库；多实例部署时换 Redis）
const createLog = new Map<string, number[]>();
const CREATE_LIMIT = 12;
const CREATE_WINDOW_MS = 60 * 60 * 1000;

function createAllowed(ip: string): boolean {
  const now = Date.now();
  const times = (createLog.get(ip) ?? []).filter((t) => now - t < CREATE_WINDOW_MS);
  if (times.length >= CREATE_LIMIT) {
    createLog.set(ip, times);
    return false;
  }
  times.push(now);
  createLog.set(ip, times);
  if (createLog.size > 10000) createLog.clear();
  return true;
}

/** 游戏库：已发布游戏列表 */
export function GET(): NextResponse {
  return NextResponse.json({ games: getStore().listPublished() });
}

/** 创建游戏：从空白或官方模板起步，返回 id + editKey */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!createAllowed(ip)) {
    return NextResponse.json({ error: "创建太频繁了，休息一会儿再来（每小时上限 12 个）" }, { status: 429 });
  }
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
  else if (template === "blank-sim") config = blankSim(title);
  else if (template === "demo-life" || template === "demo-story" || template === "demo-sim") {
    const file =
      template === "demo-life" ? "life-demo.json" : template === "demo-story" ? "story-demo.json" : "sim-demo.json";
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
  const { id, editKey } = getStore().create({ config, author, designCard: DESIGN_CARD_TEMPLATE });
  return NextResponse.json({ id, editKey });
}
