import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canEditGame } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 事件上报限流：每 IP 每小时 240 次（防脚本刷赞刷量；多实例部署时换 Redis）
const eventLog = new Map<string, number[]>();
const EVENT_LIMIT = 240;
const EVENT_WINDOW_MS = 60 * 60 * 1000;

function eventAllowed(ip: string): boolean {
  const now = Date.now();
  const times = (eventLog.get(ip) ?? []).filter((t) => now - t < EVENT_WINDOW_MS);
  if (times.length >= EVENT_LIMIT) {
    eventLog.set(ip, times);
    return false;
  }
  times.push(now);
  eventLog.set(ip, times);
  if (eventLog.size > 20000) eventLog.clear();
  return true;
}

/** 公开totals；带正确编辑钥匙时附带按日明细（创作者数据后台的数据源） */
export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  const stats = store.getStats(id);
  const canEdit = canEditGame(req, id);
  return NextResponse.json({
    likes: stats.likes,
    plays: stats.plays,
    // 平均游玩时长（秒）；按日明细只给创作者
    avgPlaySeconds: stats.plays > 0 ? Math.round(stats.playSeconds / stats.plays) : 0,
    daily: canEdit ? stats.daily : undefined,
  });
}

/** 上报事件：play（进入游玩）/ like / unlike */
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  const record = store.get(id);
  if (!record) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!eventAllowed(ip)) return NextResponse.json({ error: "操作太频繁" }, { status: 429 });
  let body: { event?: string; seconds?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (body.event === "play") store.addPlay(id);
  else if (body.event === "like") store.addLike(id, 1);
  else if (body.event === "unlike") store.addLike(id, -1);
  else if (body.event === "time" && typeof body.seconds === "number") store.addPlaySeconds(id, body.seconds);
  else return NextResponse.json({ error: "未知事件" }, { status: 400 });
  const stats = store.getStats(id);
  return NextResponse.json({ likes: stats.likes, plays: stats.plays });
}
