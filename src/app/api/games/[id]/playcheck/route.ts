import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { canPlayCheck } from "@/lib/session";
import { parsePlayCheck, summarizePlayCheck, describePlayCheck } from "@/lib/playcheck/report";
import { playCheckHasIssue } from "@/lib/playcheck/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 试玩体检的报告出入口。
 *
 * 跟 `errors` 那条**故意不一样**：报错谁踩到都算数，所以那边不要编辑钥匙；
 * 体检是主动跑出来的（工作台的隐藏 iframe 或实测脚本开 `?wgpcheck=1`），
 * 而且 /play 那一层已经只肯给作者注入体检脚本了，这里就跟着要编辑权限——
 * 免得有人拿伪造的报告去污染 AI 下一轮的上下文。
 */
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  // 跟 /play 那一层用同一把尺子：跑得了体检，就存得进报告。
  // 两边不一致的话，管理员能跑出结果却存不进去——白跑一趟，而且没人看得出为什么。
  if (!canPlayCheck(req, id)) return NextResponse.json({ error: "没有编辑权限" }, { status: 403 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const report = parsePlayCheck(raw);
  store.playCheckSet(id, report);
  return NextResponse.json({
    ok: true,
    ok_play: !playCheckHasIssue(report),
    summary: summarizePlayCheck(report),
    // 给 AI 看的那一整段也一并带上：实测脚本要拿它当「这一轮到底哪儿不行」的原话，
    // 免得脚本自己再编一套说法——平台对「玩不玩得动」只能有一种说法。
    text: describePlayCheck(report),
    report,
  });
}

/** 最近一次体检的结果。作者的「体检」页签和实测脚本都读这里。 */
export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const store = getStore();
  if (!store.get(id)) return NextResponse.json({ error: "游戏不存在" }, { status: 404 });
  if (!canPlayCheck(req, id)) return NextResponse.json({ error: "没有编辑权限" }, { status: 403 });
  const report = store.playCheckGet(id);
  if (!report) return NextResponse.json({ report: null, summary: "还没体检过" });
  return NextResponse.json({
    report,
    ok_play: !playCheckHasIssue(report),
    summary: summarizePlayCheck(report),
    text: describePlayCheck(report),
  });
}
