import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame, quotaKeyOf } from "@/lib/session";
import { GameConfig } from "@/lib/schema";
import { aiConfigured } from "@/lib/ai/provider";
import { runAssistant } from "@/lib/ai/agent";
import { rankLibraryEntries } from "@/lib/library";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const MAX_HISTORY = 24;

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  const record = store.get(id);
  if (!record) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  const editKey = req.headers.get("x-edit-key") ?? "";
  if (!canEditGame(req, id)) {
    return NextResponse.json({ error: "没有编辑权限（editKey 不正确）" }, { status: 403 });
  }
  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "AI 尚未配置：请在服务端设置 AI_BASE_URL / AI_API_KEY / AI_MODEL。平台其他功能不受影响，可直接编辑配置。" },
      { status: 501 }
    );
  }

  // 配额：登录用户按账号记账，游客按 editKey（交接文档要求第一天就有）
  const quotaKey = quotaKeyOf(req, editKey);
  const maxRequests = Number(process.env.AI_DAILY_REQUESTS ?? 40);
  const maxTokens = Number(process.env.AI_DAILY_TOKENS ?? 400000);
  const usage = store.aiUsageToday(quotaKey);
  if (usage.requests >= maxRequests || usage.tokens >= maxTokens) {
    return NextResponse.json(
      { error: `今日 AI 用量已达上限（${maxRequests} 次 / ${maxTokens} tokens），明天再来吧。` },
      { status: 429 }
    );
  }

  let body: { messages?: { role: string; content: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 8000) }));
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "缺少用户消息" }, { status: 400 });
  }

  try {
    const result = await runAssistant(
      {
        config: record.config as GameConfig,
        designCard: record.designCard,
        searchLibrary: (q, category) =>
          rankLibraryEntries(store.libraryList({ q, category, limit: 32 }), record.config as GameConfig)
            .slice(0, 8)
            .map((r) => r.entry),
      },
      history
    );
    const patch: { config?: unknown; designCard?: string } = {};
    if (result.config) patch.config = result.config;
    if (result.designCard !== undefined) patch.designCard = result.designCard;
    if (Object.keys(patch).length > 0) store.update(id, patch);
    // 对话落库：关掉页面再回来，聊天记录还在
    store.appendChat(id, [
      { role: "user", content: history[history.length - 1].content },
      { role: "assistant", content: result.reply || "（无回复）" },
    ]);
    const quota = { ...store.aiConsume(quotaKey, result.totalTokens), maxRequests, maxTokens };
    return NextResponse.json({
      reply: result.reply,
      config: result.config,
      designCard: result.designCard,
      quota,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI 请求失败" },
      { status: 502 }
    );
  }
}
