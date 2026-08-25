"use client";

import { useState } from "react";
import { GameConfig, GameState } from "@/lib/schema";
import { availableActions, eligibleTargets, endTurn, pendingInput, performAction, upcomingRows } from "@/lib/engine";
import { ChoiceControls } from "./Choices";
import { GameLog } from "./LogView";
import Roster from "./Roster";
import SimSchedule from "./SimSchedule";
import PendingBox from "./PendingBox";
import { EndingBanner, ExplainPanel, UpcomingPanel } from "./panels";

// sim 的多页签界面：像一款正经的经营网页游戏那样切页操作，
// 而不是把所有东西堆在一条阅读流里。
// 页签由配置推导——没有这个模块就没有这一页（比如没日程数据就没有赛程页），
// 名字默认取自游戏内容，作者可用 text.tabLabels 定制。

type SimTab = "overview" | "actions" | "roster" | "schedule" | "log";

export default function SimView({
  config,
  state,
  gameId,
  act,
  restart,
  choices,
  inputGate,
  actions,
  upcoming,
  logEndRef,
}: {
  config: GameConfig;
  state: GameState;
  gameId?: string;
  act: (fn: () => GameState) => void;
  restart: () => void;
  choices: { id: string; label: string }[];
  inputGate: ReturnType<typeof pendingInput>;
  actions: ReturnType<typeof availableActions>;
  upcoming: ReturnType<typeof upcomingRows>;
  logEndRef: React.RefObject<HTMLDivElement | null>;
}): React.ReactElement {
  const [tab, setTab] = useState<SimTab>("overview");
  const simTime = config.driver.kind === "sim" ? config.driver.time : null;
  const turnLabel = simTime?.turnLabel ?? "回合";
  const pendingEvent = !state.ended && state.pendingCard;
  const lastCardText = [...state.log].reverse().find((l) => l.kind === "card")?.text;

  const labels = config.text?.tabLabels ?? {};
  const dataSettlements = (config.settlements ?? []).filter((st) => (st.data?.length ?? 0) > 0);
  const hasActions = (config.actions ?? []).length > 0;
  const hasRoster = (config.entityTypes?.length ?? 0) > 0 && Object.keys(state.entities ?? {}).length > 0;
  const tabs: [SimTab, string][] = [
    ["overview", labels.overview ?? "总览"],
    ...(hasActions ? ([["actions", labels.actions ?? "行动"]] as [SimTab, string][]) : []),
    ...(hasRoster ? ([["roster", labels.roster ?? config.entityTypes?.[0]?.name ?? "阵容"]] as [SimTab, string][]) : []),
    ...(dataSettlements.length > 0
      ? ([["schedule", labels.schedule ?? (dataSettlements.length === 1 ? dataSettlements[0].name : "日程")]] as [SimTab, string][])
      : []),
    ["log", labels.log ?? "日志"],
  ];
  const activeTab = tabs.some(([t]) => t === tab) ? tab : "overview";

  return (
    <>
      {state.ended && (
        <div className="controls">
          <EndingBanner state={state} onRestart={restart} />
        </div>
      )}
      {pendingEvent && (
        <div className="sim-event">
          <div className="sim-event-title">⚡ 事件</div>
          {lastCardText && <div className="sim-event-text">{lastCardText}</div>}
          <div className="controls">
            {(choices.length > 0 || inputGate) && (
              <ChoiceControls config={config} state={state} choices={choices} inputGate={inputGate} act={act} />
            )}
          </div>
        </div>
      )}
      <div className="sim-nav">
        {tabs.map(([t, label]) => (
          <button key={t} className={activeTab === t ? "active" : ""} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="sim-panel">
          {!state.ended && !state.pendingCard && <UpcomingPanel config={config} rows={upcoming} />}
          <ExplainPanel state={state} />
          <GameLog entries={state.log.slice(-8)} gameId={gameId} className="gamelog sim-recent" />
          {!state.ended && !pendingEvent && (
            <div className="controls" style={{ display: "flex", gap: 10 }}>
              <button className="btn small" onClick={() => setTab("actions")}>
                去安排本{turnLabel} →
              </button>
              <button className="btn small secondary" onClick={() => act(() => endTurn(config, state))}>
                直接结束本{turnLabel} ▸
              </button>
            </div>
          )}
        </div>
      )}
      {activeTab === "actions" && (
        <div className="sim-panel">
          <PendingBox config={config} state={state} />
          {!state.ended && !pendingEvent ? (
            <ActionPanel config={config} state={state} actions={actions} act={act} turnLabel={turnLabel} />
          ) : (
            <div className="pane-note">先处理上方事件。</div>
          )}
        </div>
      )}
      {activeTab === "roster" && (
        <div className="sim-panel">
          <Roster config={config} state={state} />
        </div>
      )}
      {activeTab === "schedule" && (
        <div className="sim-panel">
          <SimSchedule config={config} state={state} />
        </div>
      )}
      {activeTab === "log" && (
        <div className="sim-panel">
          <GameLog entries={state.log} gameId={gameId} endRef={logEndRef} />
        </div>
      )}
    </>
  );
}

/** 本回合能做的事：行动点预算下的取舍，需要指定对象的决策再选一次目标 */
function ActionPanel({
  config,
  state,
  actions,
  act,
  turnLabel,
}: {
  config: GameConfig;
  state: GameState;
  actions: ReturnType<typeof availableActions>;
  act: (fn: () => GameState) => void;
  turnLabel: string;
}): React.ReactElement {
  const [targetPick, setTargetPick] = useState<string | null>(null);
  const showCost = config.driver.kind === "sim" && config.driver.actionPoints !== undefined;
  return (
    <>
      <div className="action-grid">
        {actions.map((a) =>
          targetPick === a.id ? (
            <div key={a.id} className="target-pick">
              <span>{a.name}：选择目标</span>
              {eligibleTargets(config, state, a.id).map((t) => (
                <button
                  key={t.id}
                  className="choice-btn"
                  onClick={() => {
                    act(() => performAction(config, state, a.id, t.id));
                    setTargetPick(null);
                  }}
                >
                  {t.name}
                </button>
              ))}
              <button className="linklike" onClick={() => setTargetPick(null)}>
                取消
              </button>
            </div>
          ) : (
            <button
              key={a.id}
              className="action-btn"
              disabled={!a.available}
              title={a.reason ?? a.description}
              onClick={() => (a.needsTarget ? setTargetPick(a.id) : act(() => performAction(config, state, a.id)))}
            >
              {a.name}
              {showCost && <span className="uses">{a.cost === 0 ? "免费" : `${a.cost}点`}</span>}
              {a.usesLeft !== null && <span className="uses">×{a.usesLeft}</span>}
            </button>
          )
        )}
      </div>
      <button className="continue-btn" onClick={() => act(() => endTurn(config, state))}>
        结束本{turnLabel} ▸
      </button>
    </>
  );
}
