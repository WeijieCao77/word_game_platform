import { GameConfig, GameState } from "@/lib/schema";
import { upcomingRows } from "@/lib/engine";
import { formatNum, KIND_LABEL } from "./util";

// 播放器里的几块只读面板：属性条、下一场预告、结局横幅、结算复盘。

/** 顶部属性条：时间/行动点/可见变量/派生值 */
export function StatsBar({
  config,
  state,
  derived,
}: {
  config: GameConfig;
  state: GameState;
  derived: { id: string; name: string; value: number }[];
}): React.ReactElement {
  const timeLabel = config.driver.kind === "life" ? config.driver.time.label : null;
  const simTime = config.driver.kind === "sim" ? config.driver.time : null;
  const ap = config.driver.kind === "sim" ? config.driver.actionPoints : undefined;
  return (
    <div className="stats">
      {timeLabel && (
        <span className="stat">
          {timeLabel}数 <b>{formatNum(state.time ?? 0)}</b>
        </span>
      )}
      {simTime && (
        <span className="stat">
          {simTime.cycleLabel && simTime.turnsPerCycle
            ? `第 ${state.cycle} ${simTime.cycleLabel} · 第 ${state.turn} ${simTime.turnLabel}`
            : `第 ${state.turn} ${simTime.turnLabel}`}
        </span>
      )}
      {ap !== undefined && !state.ended && (
        <span className="stat ap-stat" title="每回合行动点有限，想清楚这周做什么">
          行动点 <b>{state.apLeft ?? ap}</b>/{ap}
        </span>
      )}
      {config.vars
        .filter((v) => v.visible !== false)
        .map((v) => (
          <span className="stat" key={v.id}>
            {v.name} <b>{formatNum(state.vars[v.id] ?? 0)}</b>
          </span>
        ))}
      {derived.map((d) => (
        <span className="stat" key={d.id}>
          {d.name} <b>{formatNum(d.value)}</b>
        </span>
      ))}
    </div>
  );
}

/** 本回合即将结算的对阵/日程预告 */
export function UpcomingPanel({
  config,
  rows,
}: {
  config: GameConfig;
  rows: ReturnType<typeof upcomingRows>;
}): React.ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <div className="upcoming">
      {rows.map((u, i) => (
        <div key={i} className="upcoming-item">
          <span className="upcoming-label">
            本{config.driver.kind === "sim" ? config.driver.time.turnLabel : "回合"}对阵 · {u.settlement}
          </span>
          <span className="upcoming-detail">
            {Object.entries(u.row).map(([k, v]) => (
              <span key={k}>{typeof v === "string" ? <b>{v}</b> : `${k} ${v}`} </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

export function EndingBanner({ state, onRestart }: { state: GameState; onRestart: () => void }): React.ReactElement | null {
  if (!state.ended) return null;
  return (
    <div className={`ending-banner ${state.ended.kind}`}>
      <div className="ending-kind">{KIND_LABEL[state.ended.kind]}</div>
      <h2>{state.ended.title}</h2>
      {state.ended.text && <p>{state.ended.text}</p>}
      <p style={{ marginTop: 12 }}>
        <button className="continue-btn" onClick={onRestart}>
          再开一局
        </button>
      </p>
    </div>
  );
}

/** 结算复盘：把这次结算用到的中间量摊开，回答「为什么是这个结果」 */
export function ExplainPanel({ state }: { state: GameState }): React.ReactElement | null {
  const snaps = state.lastSettlements;
  if (!snaps || Object.keys(snaps).length === 0) return null;
  return (
    <details className="explain-panel">
      <summary>上一次结算复盘——为什么是这个结果</summary>
      {Object.entries(snaps).map(([sid, snap]) => (
        <div key={sid} className="explain-block">
          <b>{snap.name}</b>
          {snap.row && (
            <span className="explain-row">
              {Object.entries(snap.row)
                .map(([k, v]) => (typeof v === "string" ? v : `${k} ${v}`))
                .join(" · ")}
            </span>
          )}
          <div className="explain-locals">
            {Object.entries(snap.locals).map(([k, v]) => (
              <span key={k} className="stat">
                {k} <b>{v}</b>
              </span>
            ))}
          </div>
          {snap.text && <div className="explain-text">{snap.text}</div>}
        </div>
      ))}
    </details>
  );
}
