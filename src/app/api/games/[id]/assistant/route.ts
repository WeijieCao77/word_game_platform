import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame, currentUser, quotaKeyOf } from "@/lib/session";
import { checkQuota, quotaView, recordSpend } from "@/lib/ai/quota";
import { GameConfig } from "@/lib/schema";
import { aiConfigured } from "@/lib/ai/provider";
import { runAssistant } from "@/lib/ai/agent";
import { rankLibraryEntries } from "@/lib/library";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const MAX_HISTORY = 24;

// 额度读数：工作台一进来就要显示「已用多少 / 还剩多少」，不必等发完一条消息。
export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canEditGame(req, id)) return NextResponse.json({ error: "没有编辑权限" }, { status: 403 });
  const editKey = req.headers.get("x-edit-key") ?? "";
  const user = currentUser(req);
  // ?job=<id> 是异步那一轮的轮询口：请求早就返回了，活还在后台跑，
  // 前端靠这里问「跑完没有、跑到哪了」。
  const jobId = new URL(req.url).searchParams.get("job");
  if (jobId) {
    const job = store.jobGet(jobId);
    if (!job || job.gameId !== id) return NextResponse.json({ error: "没有这个任务" }, { status: 404 });
    return NextResponse.json({
      job: { id: job.id, status: job.status, note: job.note, error: job.error, updatedAt: job.updatedAt },
      ...(job.status === "done" ? (job.result as object) : {}),
    });
  }
  return NextResponse.json({
    quota: quotaView(store, { user, quotaKey: quotaKeyOf(req, editKey) }),
    // 页面刷新后还能接回正在跑的那一轮，不至于「我刚才说的话去哪了」
    running: store.jobRunning(id)?.id ?? null,
  });
}

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

  let body: { messages?: { role: string; content: string }[]; async?: boolean };
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

  const asyncMode = body.async === true;
  // 一轮的活抽成一个函数：同步模式直接 await，异步模式丢到后台跑。
  // 两条路跑的是同一段代码，不会出现「异步那条忘了记额度」这种事。
  const runOneRound = async (onNote?: (note: string) => void): Promise<Record<string, unknown>> => {
    const result = await runAssistant(
      {
        config: record.config as GameConfig,
        designCard: record.designCard,
        mode: store.gameMode(id),
        // 异步任务不受网关脸色，单轮可以放开跑（默认 12 分钟）——
        // 这正是异步化要换来的东西：AI 一轮能干完一整块，而不是刚起头就被叫停。
        budgetMs: asyncMode ? Number(process.env.AI_ROUND_BUDGET_ASYNC_MS ?? 720_000) : undefined,
        // 改一次存一次：网关掐断连接时（线上实测撞过 502），
        // 这一轮已经做完的部分不会白做
        persist: (patch) => {
          store.update(id, patch);
          onNote?.("正在写配置…");
        },
        files: {
          list: () => store.fileList(id).map((f) => ({ path: f.path, size: f.size })),
          read: (path) => store.fileRead(id, path),
          write: (path, content) => {
            store.fileWrite(id, path, content);
            if (store.gameMode(id) !== "code") store.gameSetMode(id, "code");
            onNote?.(`正在写 ${path}…`);
          },
        },
        // 回切（自由 → 快速）：创作者点头后由 AI 触发，文件保留但不再执行
        setMode: (m) => {
          if (store.gameMode(id) !== m) store.gameSetMode(id, m);
        },
        errors: {
          list: () => store.errorList(id),
          clear: () => store.errorClear(id),
        },
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
    return {
      reply: result.reply,
      config: result.config,
      designCard: result.designCard,
      filesChanged: result.filesChanged,
      mode: store.gameMode(id),
      quota: quotaView(store, { user, quotaKey }),
    };
  };

  // 异步模式：请求立刻返回一个任务号，活在后台跑，前端轮询要结果。
  //
  // 这才是 502 的根治。同步模式下一轮必须在网关的耐心之内跑完，所以单轮预算
  // 只能压到 240 秒——AI 一轮干不完一件事，复刻一个大作品要十几轮一个小时。
  // 异步之后单轮想跑多久跑多久（见 agent 的 AI_ROUND_BUDGET_CODE_MS），
  // 连接断了也不影响后台那一轮，作者刷新页面还能接回来。
  if (asyncMode) {
    // 已经有一轮在跑：**把它的任务号带回去**，让前端直接接上去轮询。
    // 早先这里只回一句「还有一轮在跑」，作者刷新一下页面就和那一轮失联了，
    // 之后发什么都被顶回来——看上去就是「我改不了了」。
    const busy = store.jobRunning(id);
    if (busy) {
      return NextResponse.json(
        {
          error: "这部作品还有一轮在跑，先接着看它的结果（同时改同一份配置会互相覆盖）。",
          jobId: busy.id,
          note: busy.note,
        },
        { status: 409 }
      );
    }
    const jobId = randomBytes(9).toString("base64url");
    if (!store.jobCreate(id, jobId)) {
      const other = store.jobRunning(id);
      return NextResponse.json({ error: "这部作品还有一轮在跑", jobId: other?.id }, { status: 409 });
    }
    // 心跳：任务活在这个进程里，进程一死它就没了。每 20 秒盖个时间戳，
    // 让 jobRunning 能凭「静默超过三分钟」把尸体判死，而不是把作者锁在那儿干等。
    const beat = setInterval(() => store.jobHeartbeat(jobId), 20_000);
    if (typeof beat.unref === "function") beat.unref();
    void runOneRound((note) => store.jobNote(jobId, note))
      .then((payload) => store.jobDone(jobId, payload))
      .catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err);
        console.error("[assistant] 异步任务失败:", detail);
        store.jobFail(jobId, explainAiFailure(detail));
      })
      .finally(() => clearInterval(beat));
    return NextResponse.json({ jobId }, { status: 202 });
  }

  try {
    return NextResponse.json(await runOneRound());
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // 服务端日志留全文，方便按时间点回查（Railway 的 Logs 里能看到）
    console.error("[assistant] 失败:", detail);
    return NextResponse.json({ error: explainAiFailure(detail) }, { status: 502 });
  }
}

/**
 * 放弃当前这一轮。
 *
 * 后台那个 Promise 拦不住（拦了也没意义，写到一半的配置已经落库了），
 * 但**锁必须立刻放开**——不然作者只能干等三分钟心跳超时。
 */
export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canEditGame(req, id)) return NextResponse.json({ error: "没有编辑权限" }, { status: 403 });
  return NextResponse.json({ abandoned: store.jobAbandon(id) });
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
