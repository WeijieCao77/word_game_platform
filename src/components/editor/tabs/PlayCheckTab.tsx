"use client";

import { useCallback, useEffect, useState } from "react";
import { PlayCheckReport } from "@/lib/playcheck/types";
import { GateIssue } from "@/lib/publish-gate";

/**
 * 体检页签（只有自由模式有）。
 *
 * 补的是一个很难堪的空白：平台其实一直攒着这部作品的健康状况——运行报错、
 * 接线体检、发布落差、现在还有试玩体检——但这些**全部只发给了 AI**，
 * 作者在界面上一条都看不到。于是作者判断作品好没好的唯一手段，是自己点开预览自己踩，
 * 踩到了也说不出所以然，只能跟 AI 说「还是玩不了」。平台把创作者当成了人肉冒烟测试机。
 *
 * 这一页不做新算法，只是把已经有的东西摆出来。
 */

interface RuntimeError {
  at: string;
  message: string;
  source: string;
}

export default function PlayCheckTab({
  gameId,
  editKey,
  report,
  summary,
  checking,
  error,
  gateIssues = [],
  onRun,
  onFix,
}: {
  gameId: string;
  editKey: string;
  report: PlayCheckReport | null;
  summary: string;
  checking: boolean;
  error: string;
  /** 刚才发布被门槛拦下来的原因（没被拦就是空） */
  gateIssues?: GateIssue[];
  onRun: () => void;
  /** 「让 AI 去修」——把体检结论直接发进对话，作者不用自己抄 */
  onFix?: (message: string) => void;
}): React.ReactElement {
  const [errs, setErrs] = useState<RuntimeError[]>([]);

  const reload = useCallback(() => {
    void fetch(`/api/games/${gameId}/errors`, { headers: { "x-edit-key": editKey } })
      .then((r) => (r.ok ? r.json() : { errors: [] }))
      .then((b) => setErrs((b.errors ?? []) as RuntimeError[]))
      .catch(() => setErrs([]));
  }, [gameId, editKey]);

  useEffect(reload, [reload, report]);

  const stuck = report?.stuck;
  // 没卡住、却也没走到主界面——单独当一条问题显示。
  // 不显示的话，这份报告在界面上跟「试玩通过」长得一模一样（线上就绿过一次）。
  const notArrived = !!report && !report.stuck && !report.arrived && report.bootText > 0;
  const dead = (report?.nav ?? []).filter((n) => !n.changed && !n.already);
  const deadOnPath = (report?.steps ?? []).flatMap((s) => s.dead);
  const empty = (report?.nav ?? []).filter((n) => n.changed && n.textLen < 40 && n.clickable === 0);

  return (
    <div>
      <div className="pane-note" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span>{checking ? "正在替你玩一遍…" : error ? `⚠ ${error}` : summary || "还没体检过"}</span>
        <button className="btn small secondary" onClick={onRun} disabled={checking}>
          {checking ? "体检中…" : "再体检一次"}
        </button>
        {report && (stuck || notArrived || dead.length > 0 || deadOnPath.length > 0) && onFix && (
          <button className="btn small" onClick={() => onFix(fixPrompt(report))}>
            让 AI 去修
          </button>
        )}
      </div>

      {gateIssues.length > 0 && (
        <div className="issues" style={{ marginTop: 10 }}>
          <div className="pane-note" style={{ marginBottom: 6 }}>
            <strong>刚才发布没成——这几条得先过：</strong>
          </div>
          {gateIssues.map((g, i) => (
            <div key={i} className={`issue ${g.level === "error" ? "error" : "warn"}`}>
              <div className="path">{g.level === "error" ? "拦住发布" : "不拦，但看一眼"}</div>
              {g.what}
              {g.how && (
                <div style={{ marginTop: 6, opacity: 0.75 }}>怎么办：{g.how}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {report && (
        <div className="issues">
          {report.bootText <= 0 && (
            <div className="issue error">
              <div className="path">开局白屏</div>
              页面载完了，正文一个字都没有。
            </div>
          )}
          {stuck && (
            <div className="issue error">
              <div className="path">开局卡在第 {stuck.step} 步</div>
              {stuck.why === "no-clickable"
                ? "这一屏根本没有能点的东西，玩家到这里就没路了。"
                : `这一屏能点的都试了一遍（${stuck.tried.join("、") || "无"}），点完界面一个字都没变。`}
              {stuck.filled.length > 0 && `（体检已经先替玩家把「${stuck.filled.join("、")}」填上了。）`}
              <div style={{ marginTop: 6, opacity: 0.75 }}>那一屏：{stuck.screen || "（空白）"}</div>
            </div>
          )}
          {notArrived && (
            <div className="issue error">
              <div className="path">走了 {report.walked} 步，没走到主界面</div>
              {report.nav.length > 0
                ? `一路上只找到一组 ${report.nav.length} 项的页签（${report.nav
                    .map((n) => n.label)
                    .join("、")}），多半是某一屏里的分区页签，不是主界面那一排。`
                : "一路上一组导航都没找到。"}
              <div style={{ marginTop: 6, opacity: 0.75 }}>
                作品本来就没有导航栏（纯线性故事）的话，这一条忽略即可；
                说好有一整排页签的话，就是开局这条路还没通到主界面。
              </div>
            </div>
          )}
          {deadOnPath.length > 0 && (
            <div className="issue error">
              <div className="path">开局路上 {deadOnPath.length} 个按钮点了没反应</div>
              {deadOnPath.join("、")}
              <div style={{ marginTop: 6, opacity: 0.75 }}>
                流程最后是靠点别的东西才走下去的——这些按钮玩家一样会去点。
              </div>
            </div>
          )}
          {dead.length > 0 && (
            <div className="issue error">
              <div className="path">导航 {dead.length}/{report.nav.length} 项点了没反应</div>
              {dead.map((n) => n.label).join("、")}
            </div>
          )}
          {empty.length > 0 && (
            <div className="issue warn">
              <div className="path">切得过去，但里面几乎是空的</div>
              {empty.map((n) => `${n.label}（${n.textLen} 字 / 0 个可点元素）`).join("、")}
            </div>
          )}
          {report.notes.map((n, i) => (
            <div key={i} className="issue warn">
              <div className="path">体检自己的情况</div>
              {n}
            </div>
          ))}
          {!stuck && !notArrived && dead.length === 0 && deadOnPath.length === 0 && empty.length === 0 && report.bootText > 0 && (
            <div className="issue">
              <div className="path">试玩通过</div>
              开局走通 {report.walked} 步走到主界面，导航 {report.nav.length} 项都能切。
              这只说明走得动，不说明好玩，也不说明数值对。
            </div>
          )}
          <div className="pane-note" style={{ marginTop: 8, opacity: 0.7 }}>
            体检时间 {new Date(report.at).toLocaleString("zh-CN")}，耗时 {(report.ms / 1000).toFixed(1)} 秒。
            体检**只查走不走得通**：点了有没有反应、页面有没有真东西。
          </div>
        </div>
      )}

      <div className="pane-note" style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
        <span>运行报错{errs.length > 0 ? `（${errs.length} 条）` : "：暂时没有"}</span>
        <button className="btn small secondary" onClick={reload}>
          刷新
        </button>
      </div>
      <div className="issues">
        {errs.slice(0, 12).map((e, i) => (
          <div key={i} className="issue error">
            <div className="path">
              {e.source || "未知位置"} · {new Date(e.at).toLocaleString("zh-CN")}
            </div>
            {e.message}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 把体检结论写成一句能直接发给 AI 的话 */
function fixPrompt(r: PlayCheckReport): string {
  const parts: string[] = ["平台的试玩体检刚在浏览器里自动玩了一遍，查到这些问题，请按顺序修："];
  if (r.bootText <= 0) parts.push("· 开局白屏：页面载完之后正文一个字都没有。");
  if (r.stuck) {
    parts.push(
      r.stuck.why === "no-clickable"
        ? `· 开局第 ${r.stuck.step} 步这一屏根本没有能点的东西，玩家到这里就没路了。`
        : `· 开局第 ${r.stuck.step} 步走不下去：能点的都试了一遍（${r.stuck.tried.join("、")}），` +
            `点完界面一个字都没变。那一屏：「${r.stuck.screen}」`
    );
  }
  if (!r.stuck && !r.arrived) {
    parts.push(
      `· 体检点了 ${r.walked} 步都没走到有导航栏的主界面` +
        (r.nav.length ? `（只找到一组 ${r.nav.length} 项的页签：${r.nav.map((n) => n.label).join("、")}）` : "") +
        `。作品本来就没有导航栏的话忽略这条，否则就是开局这条路还没通到主界面。`
    );
  }
  const onPath = r.steps.flatMap((s) => s.dead);
  if (onPath.length) parts.push(`· 开局路上这些按钮点了没反应：${onPath.join("、")}。`);
  const dead = r.nav.filter((n) => !n.changed && !n.already);
  if (dead.length) parts.push(`· 导航这几项点了没反应：${dead.map((n) => n.label).join("、")}。`);
  const empty = r.nav.filter((n) => n.changed && n.textLen < 40 && n.clickable === 0);
  if (empty.length) parts.push(`· 这几页切得过去但里面是空的：${empty.map((n) => n.label).join("、")}。`);
  parts.push("注意这类问题不抛异常，read_errors 里是空的——别拿「没有报错记录」当作没问题。");
  parts.push("先修「走不下去」那一条：开局过不去，后面做得再多玩家也看不到。");
  return parts.join("\n");
}
