import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame, currentUser, quotaKeyOf } from "@/lib/session";
import { checkQuota, quotaView, recordSpend } from "@/lib/ai/quota";
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

  // 额度：管理员不限量 / 注册用户走总量额度池（用完由管理员手动批）/ 游客按日额度。
  // 另有一条与身份无关的熔断：烧了不少 token 却一张卡都没搭出来，说明不是在做游戏。
  const quotaKey = quotaKeyOf(req, editKey);
  const user = currentUser(req);
  const cardsCount = (record.config as GameConfig).cards?.length ?? 0;
  const verdict = checkQuota(store, { user, quotaKey, gameId: id, cardsCount });
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.reason, code: verdict.code }, { status: 429 });
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
    recordSpend(store, { user, quotaKey, gameId: id, tokens: result.totalTokens });
    const quota = quotaView(store, { user, quotaKey });
    return NextResponse.json({
      reply: result.reply,
      config: result.config,
      designCard: result.designCard,
      quota,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // 服务端日志留全文，方便按时间点回查（Railway 的 Logs 里能看到）
    console.error("[assistant] 失败:", detail);
    return NextResponse.json({ error: explainAiFailure(detail) }, { status: 502 });
  }
}

/** 把上游返回的技术错误翻译成作者能行动的提示 */
function explainAiFailure(detail: string): string {
  const d = detail.toLowerCase();
  if (d.includes("context") && (d.includes("length") || d.includes("exceed"))) {
    return `这轮对话太长了，超出模型的上下文上限。建议：把要求拆小一点重发，或者新开一个作品从设计卡继续。（原始错误：${detail.slice(0, 160)}）`;
  }
  if (d.includes("max_tokens") || d.includes("too long") || d.includes("output limit")) {
    return `这一轮要生成的内容超过了模型单次输出上限——十几个队伍、几十名选手一次性建出来必然超。让它先建骨架，再分批补名单（每批 15~25 条）。（原始错误：${detail.slice(0, 160)}）`;
  }
  if (d.includes("429") || d.includes("rate limit")) {
    return `AI 服务限流了，等一两分钟再试。（原始错误：${detail.slice(0, 160)}）`;
  }
  if (d.includes("401") || d.includes("403") || d.includes("invalid api key")) {
    return `AI 服务拒绝了这次调用，多半是密钥失效或余额不足，需要在部署环境变量里更新。（原始错误：${detail.slice(0, 160)}）`;
  }
  if (d.includes("timeout") || d.includes("etimedout") || d.includes("fetch failed") || d.includes("socket")) {
    return `连接 AI 服务超时或中断。稍等片刻重试；如果这一轮改动很大，先把要求拆小。（原始错误：${detail.slice(0, 160)}）`;
  }
  return detail || "AI 请求失败";
}
