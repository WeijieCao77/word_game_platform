import { GameConfig, GameState } from "@/lib/schema";
import { leagueStandings } from "@/lib/engine";

/**
 * sim 赛程页：活联赛的积分榜（NPC 之间也在互赛，榜是活的）+
 * 每个带 data 的结算的完整日程表，标出已赛/下一场。
 */
export default function SimSchedule({ config, state }: { config: GameConfig; state: GameState }): React.ReactElement {
  const withData = (config.settlements ?? []).filter((st) => (st.data?.length ?? 0) > 0);
  const leagues = config.leagues ?? [];
  if (withData.length === 0 && leagues.length === 0) return <div className="pane-note">这个游戏没有固定日程。</div>;
  return (
    <div className="sched">
      {leagues.map((lg) => {
        const rows = leagueStandings(config, state, lg.id);
        return (
          <div key={lg.id} className="sched-block">
            <div className="sched-title">{lg.name} · 积分榜</div>
            <div className="roster-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>队伍</th>
                    <th>胜</th>
                    <th>负</th>
                    <th>净胜</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.name}
                      className={`${r.isPlayer ? "standings-me" : ""} ${lg.playoffs && r.rank === lg.playoffs ? "standings-line" : ""}`}
                    >
                      <td>{r.rank}</td>
                      <td>
                        {r.name}
                        {r.isPlayer ? "（你）" : ""}
                      </td>
                      <td>{r.w}</td>
                      <td>{r.l}</td>
                      <td>{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lg.playoffs && <div className="pane-note">线上为前 {lg.playoffs} 名（晋级区）</div>}
          </div>
        );
      })}
      {withData.map((st) => {
        const rows = st.data!;
        const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
        const runIdx = state.counters?.[st.id] ?? 0;
        const nextIdx = runIdx % rows.length;
        const lap = Math.floor(runIdx / rows.length);
        return (
          <div key={st.id} className="sched-block">
            <div className="sched-title">{st.name}</div>
            <div className="roster-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    {cols.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const done = lap > 0 || i < nextIdx;
                    const isNext = i === nextIdx;
                    return (
                      <tr key={i} className={isNext ? "sched-next" : done ? "sched-done" : ""}>
                        <td>{i + 1}</td>
                        {cols.map((c) => (
                          <td key={c}>{r[c] === undefined ? "—" : String(r[c])}</td>
                        ))}
                        <td>{isNext ? "▶ 下一场" : done ? "已赛" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <BracketBoard config={config} state={state} />
    </div>
  );
}

/**
 * 淘汰赛对阵表。
 * 只在打完之后显示——季后赛的悬念在于「谁淘汰了谁」，一轮一轮列出来就够了，
 * 不必画成树状图（手机上根本看不清）。
 */
function BracketBoard({ config, state }: { config: GameConfig; state: GameState }): React.ReactElement | null {
  const played = (config.brackets ?? []).filter((b) => state.brackets?.[b.id]);
  if (played.length === 0) return null;
  return (
    <>
      {played.map((def) => {
        const run = state.brackets![def.id];
        const me = (config.leagues ?? []).find((l) => l.id === def.league)?.playerTeam;
        const roundName = (r: number, total: number): string =>
          r === total ? "决赛" : r === total - 1 ? "半决赛" : `第 ${r} 轮`;
        return (
          <div key={def.id} className="sched-block">
            <div className="sched-title">
              {def.name}
              <span className="tag">{run.champion === me ? "夺冠" : `冠军 ${run.champion}`}</span>
            </div>
            {run.rounds.map((rd) => (
              <div key={rd.round} className="bracket-round">
                <div className="bracket-round-name">{roundName(rd.round, run.rounds.length)}</div>
                {rd.pairs.map((pair, i) => {
                  const w = rd.winners[i];
                  return (
                    <div key={i} className={`bracket-pair${pair.includes(me ?? "") ? " mine" : ""}`}>
                      <span className={pair[0] === w ? "bracket-win" : "bracket-lose"}>{pair[0]}</span>
                      <span className="bracket-vs">vs</span>
                      <span className={pair[1] === w ? "bracket-win" : "bracket-lose"}>{pair[1]}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
