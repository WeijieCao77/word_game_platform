"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { GameConfig, GameState } from "@/lib/schema";
import {
  initState,
  step,
  choose,
  pendingChoices,
  pendingInput,
  submitInput,
  searchKeyword,
  leagueStandings,
  notebookItems,
  performAction,
  endTurn,
  availableActions,
  eligibleTargets,
  derivedValues,
  upcomingRows,
} from "@/lib/engine";

// 编辑器与播放器同源：/g/:id 的玩家页面和 /edit/:id 的实时预览
// 用的都是这一个组件，换 mode 而已。

interface Props {
  config: GameConfig;
  gameId?: string;
  author?: string;
  mode: "play" | "preview";
}

const KIND_LABEL: Record<string, string> = {
  victory: "结局 · 达成",
  defeat: "结局 · 落幕",
  neutral: "结局",
};

function saveKey(gameId: string): string {
  return `wgp_save_${gameId}`;
}

/** 配置指纹：游戏更新后能识别出旧存档 */
function configHash(config: GameConfig): number {
  const s = JSON.stringify(config);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export default function GamePlayer({ config, gameId, author, mode }: Props): React.ReactElement {
  const [state, setState] = useState<GameState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [staleSave, setStaleSave] = useState(false);
  const [copied, setCopied] = useState(false);
  const [likes, setLikes] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);
  const [targetPick, setTargetPick] = useState<string | null>(null); // 正在选目标的决策 id
  const logEndRef = useRef<HTMLDivElement>(null);

  const newGame = useCallback((): void => {
    try {
      const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      setState(initState(config, seed));
      setFatal(null);
      setStaleSave(false);
      setTargetPick(null);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    }
  }, [config]);

  useEffect(() => {
    if (mode === "play" && gameId) {
      try {
        const raw = localStorage.getItem(saveKey(gameId));
        if (raw) {
          const saved = JSON.parse(raw) as { v: number; cfg?: number; state: GameState };
          if ((saved.v === 1 || saved.v === 2) && saved.state && typeof saved.state.turn === "number") {
            pendingChoices(config, saved.state);
            availableActions(config, saved.state);
            setState(saved.state);
            // 游戏内容更新后旧存档还能继续，但提示玩家新版有新内容
            setStaleSave(saved.cfg !== configHash(config));
            return;
          }
        }
      } catch {
        // 存档损坏/配置已更新：静默开新局
      }
    }
    newGame();
  }, [config, gameId, mode, newGame]);

  useEffect(() => {
    if (mode === "play" && gameId && state) {
      try {
        localStorage.setItem(saveKey(gameId), JSON.stringify({ v: 2, cfg: configHash(config), state }));
      } catch {
        // 存储满等情况不致命
      }
    }
  }, [state, gameId, mode, config]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state?.log.length, state?.pendingCard, state?.ended]);

  const choices = useMemo(() => {
    if (!state) return [];
    try {
      return pendingChoices(config, state);
    } catch {
      return [];
    }
  }, [config, state]);

  const [kwText, setKwText] = useState("");
  const [globalKw, setGlobalKw] = useState("");
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [simTab, setSimTab] = useState<"overview" | "actions" | "roster" | "schedule" | "log">("overview");
  const nbItems = useMemo(() => {
    if (!state || !config.notebook) return [];
    try {
      return notebookItems(config, state);
    } catch {
      return [];
    }
  }, [config, state]);

  const inputGate = useMemo(() => {
    if (!state) return null;
    try {
      return pendingInput(config, state);
    } catch {
      return null;
    }
  }, [config, state]);

  const isSim = config.driver.kind === "sim";
  const actions = useMemo(() => {
    if (!state || !isSim) return [];
    try {
      return availableActions(config, state);
    } catch {
      return [];
    }
  }, [config, state, isSim]);

  const derived = useMemo(() => {
    if (!state || !isSim) return [];
    try {
      return derivedValues(config, state);
    } catch {
      return [];
    }
  }, [config, state, isSim]);

  const upcoming = useMemo(() => {
    if (!state || !isSim) return [];
    try {
      return upcomingRows(config, state);
    } catch {
      return [];
    }
  }, [config, state, isSim]);

  const act = useCallback((fn: () => GameState): void => {
    try {
      setState(fn());
      setTargetPick(null);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // 进入游玩即计一次点击量（每次进入都算——流量是作者的激励），并拉取点赞数
  useEffect(() => {
    if (mode !== "play" || !gameId) return;
    try {
      setLiked(localStorage.getItem(`wgp_liked_${gameId}`) === "1");
    } catch {
      // 隐私模式等场景下静默降级
    }
    void fetch(`/api/games/${gameId}/stats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "play" }),
    })
      .then((r) => r.json())
      .then((b) => typeof b.likes === "number" && setLikes(b.likes))
      .catch(() => undefined);
  }, [mode, gameId]);

  // 游玩时长：页面可见时累计，每 60s 上报一次，离开页面用 sendBeacon 补尾——
  // 创作者后台「平均玩多久」的数据源
  useEffect(() => {
    if (mode !== "play" || !gameId) return;
    let acc = 0;
    let last = Date.now();
    const flush = (useBeacon: boolean): void => {
      const secs = Math.round(acc);
      if (secs < 3) return;
      acc = 0;
      const payload = JSON.stringify({ event: "time", seconds: secs });
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(`/api/games/${gameId}/stats`, new Blob([payload], { type: "application/json" }));
      } else {
        void fetch(`/api/games/${gameId}/stats`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => undefined);
      }
    };
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") acc += (Date.now() - last) / 1000;
      last = Date.now();
      if (acc >= 60) flush(false);
    }, 5000);
    const onVis = (): void => {
      if (document.visibilityState === "visible") last = Date.now();
      else {
        acc += (Date.now() - last) / 1000;
        last = Date.now();
      }
    };
    const onHide = (): void => {
      if (document.visibilityState === "visible") acc += (Date.now() - last) / 1000;
      flush(true);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [mode, gameId]);

  const toggleLike = useCallback((): void => {
    if (!gameId) return;
    const next = !liked;
    setLiked(next);
    setLikes((n) => (n === null ? n : Math.max(0, n + (next ? 1 : -1))));
    try {
      if (next) localStorage.setItem(`wgp_liked_${gameId}`, "1");
      else localStorage.removeItem(`wgp_liked_${gameId}`);
    } catch {
      // 忽略
    }
    void fetch(`/api/games/${gameId}/stats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: next ? "like" : "unlike" }),
    })
      .then((r) => r.json())
      .then((b) => typeof b.likes === "number" && setLikes(b.likes))
      .catch(() => undefined);
  }, [gameId, liked]);

  const restart = useCallback((): void => {
    if (mode === "play" && gameId) {
      try {
        localStorage.removeItem(saveKey(gameId));
      } catch {
        // 忽略
      }
      // 再开一局也是一次游玩
      void fetch(`/api/games/${gameId}/stats`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "play" }),
      }).catch(() => undefined);
    }
    newGame();
  }, [gameId, mode, newGame]);

  const share = useCallback((): void => {
    try {
      void navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时忽略
    }
  }, []);

  const themeClass =
    config.theme?.preset === "dark"
      ? "theme-dark"
      : config.theme?.preset === "terminal"
        ? "theme-terminal"
        : "theme-paper";
  const accentStyle = config.theme?.accent ? ({ "--accent": config.theme.accent } as React.CSSProperties) : undefined;

  if (fatal) {
    return (
      <div className={`player ${themeClass}`} style={accentStyle}>
        <div className="player-inner">
          <div className="player-title">{config.meta.title}</div>
          <div className="notice">游戏运行出错：{fatal}</div>
          <div className="controls">
            <button className="continue-btn" onClick={restart}>
              重新开始
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!state) return <div className="player" />;

  const visibleVars = config.vars.filter((v) => v.visible !== false);
  const timeLabel = config.driver.kind === "life" ? config.driver.time.label : null;
  const continueLabel = timeLabel === "岁" ? "过一年 ▸" : timeLabel ? `下一${timeLabel} ▸` : "继续 ▸";
  const simTime = isSim && config.driver.kind === "sim" ? config.driver.time : null;

  return (
    <div className={`player ${themeClass}`} style={accentStyle}>
      <div className="player-inner">
        {mode === "play" && (
          <div className="player-back">
            <Link href="/">← 返回字游</Link>
          </div>
        )}
        <div className="player-title">{config.meta.title}</div>
        {staleSave && (
          <div className="stale-save-notice">
            <span>这个游戏更新过内容，你的存档来自旧版本，可能错过新玩法（如开局设定）。</span>
            <button className="btn small" onClick={restart}>
              用新版重新开始
            </button>
            <button className="btn small secondary" onClick={() => setStaleSave(false)}>
              继续旧存档
            </button>
          </div>
        )}
        <div className="player-author">
          {author ? (
            <>
              作者：<Link href={`/u/${encodeURIComponent(author)}`}>{author}</Link>
            </>
          ) : (
            config.meta.author && <>作者：{config.meta.author}</>
          )}
        </div>

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
          {isSim && config.driver.kind === "sim" && config.driver.actionPoints !== undefined && !state.ended && (
            <span className="stat ap-stat" title="每回合行动点有限，想清楚这周做什么">
              行动点 <b>{state.apLeft ?? config.driver.actionPoints}</b>/{config.driver.actionPoints}
            </span>
          )}
          {visibleVars.map((v) => (
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

        {config.notebook && state && (
          <>
            <button className="notebook-fab" onClick={() => setNotebookOpen((v) => !v)} title="随时翻看已掌握的线索与档案">
              📔 {config.notebook.label ?? "档案"}（{nbItems.length}）
            </button>
            {notebookOpen && (
              <div className="notebook-drawer">
                <div className="notebook-head">
                  <b>{config.notebook.label ?? "档案"}</b>
                  <button className="linklike" onClick={() => setNotebookOpen(false)}>
                    收起 ✕
                  </button>
                </div>
                {nbItems.length === 0 && <div className="pane-note">还没有掌握任何条目。</div>}
                {Array.from(new Set(nbItems.map((n) => n.category))).map((cat) => (
                  <div key={cat} className="notebook-cat">
                    <div className="notebook-cat-name">{cat}</div>
                    {nbItems
                      .filter((n) => n.category === cat)
                      .map((n) => (
                        <details key={n.id} className="notebook-item">
                          <summary>{n.name}</summary>
                          {n.image && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="log-img"
                              src={/^https?:\/\//.test(n.image) ? n.image : gameId ? `/api/games/${gameId}/assets/${encodeURIComponent(n.image)}` : ""}
                              alt=""
                              loading="lazy"
                            />
                          )}
                          <div className="notebook-text">{n.text}</div>
                        </details>
                      ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {config.search && config.search.entries.length > 0 && state && !state.ended && (
          <form
            className="kw-gate kw-global"
            onSubmit={(e) => {
              e.preventDefault();
              const t = globalKw.trim();
              if (!t) return;
              setGlobalKw("");
              act(() => searchKeyword(config, state, t));
            }}
          >
            <span className="kw-global-icon" aria-hidden>🔎</span>
            <input
              type="text"
              value={globalKw}
              placeholder={config.search.prompt ?? "输入你想到的关键词——人名、地名、事件……"}
              maxLength={40}
              onChange={(e) => setGlobalKw(e.target.value)}
            />
            <button className="btn small" type="submit" disabled={!globalKw.trim()}>
              {config.search.label ?? "检索"}
            </button>
          </form>
        )}

        {(() => {
          const upcomingPanel = upcoming.length > 0 && !state.ended && !state.pendingCard && (
            <div className="upcoming">
              {upcoming.map((u, i) => (
                <div key={i} className="upcoming-item">
                  <span className="upcoming-label">本{config.driver.kind === "sim" ? config.driver.time.turnLabel : "回合"}对阵 · {u.settlement}</span>
                  <span className="upcoming-detail">
                    {Object.entries(u.row).map(([k, v]) => (
                      <span key={k}>
                        {typeof v === "string" ? <b>{v}</b> : `${k} ${v}`}{" "}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          );
          const choiceControls = (choices.length > 0 || inputGate) && (
            <>
              {choices.map((c) => (
                <button key={c.id} className="choice-btn" onClick={() => act(() => choose(config, state, c.id))}>
                  {c.label}
                </button>
              ))}
              {inputGate && (
                <form
                  className="kw-gate"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const t = kwText.trim();
                    if (!t) return;
                    setKwText("");
                    act(() => submitInput(config, state, t));
                  }}
                >
                  <input
                    type="text"
                    value={kwText}
                    placeholder={inputGate.prompt}
                    maxLength={40}
                    onChange={(e) => setKwText(e.target.value)}
                  />
                  <button className="btn small" type="submit" disabled={!kwText.trim()}>
                    检索
                  </button>
                </form>
              )}
            </>
          );
          const endingBanner = state.ended && (
            <div className={`ending-banner ${state.ended.kind}`}>
              <div className="ending-kind">{KIND_LABEL[state.ended.kind]}</div>
              <h2>{state.ended.title}</h2>
              {state.ended.text && <p>{state.ended.text}</p>}
              <p style={{ marginTop: 12 }}>
                <button className="continue-btn" onClick={restart}>
                  再开一局
                </button>
              </p>
            </div>
          );
          const assetUrl = (ref: string): string =>
            /^https?:\/\//.test(ref) ? ref : gameId ? `/api/games/${gameId}/assets/${encodeURIComponent(ref)}` : "";
          const renderEntry = (entry: (typeof state.log)[number], i: number): React.ReactElement => (
            <div key={i} className={`log-${entry.kind}`}>
              {entry.image && assetUrl(entry.image) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="log-img" src={assetUrl(entry.image)} alt="" loading="lazy" />
              )}
              {entry.text}
            </div>
          );
          const fullLog = (
            <div className="gamelog">
              {state.log.map(renderEntry)}
              <div ref={logEndRef} />
            </div>
          );
          const actionPanel = (
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
                          onClick={() => act(() => performAction(config, state, a.id, t.id))}
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
                      {config.driver.kind === "sim" && config.driver.actionPoints !== undefined && (
                        <span className="uses">{a.cost === 0 ? "免费" : `${a.cost}点`}</span>
                      )}
                      {a.usesLeft !== null && <span className="uses">×{a.usesLeft}</span>}
                    </button>
                  )
                )}
              </div>
              <button className="continue-btn" onClick={() => act(() => endTurn(config, state))}>
                结束本{simTime?.turnLabel ?? "回合"} ▸
              </button>
            </>
          );

          if (!isSim) {
            // life / story：阅读流保持原样
            return (
              <>
                {upcomingPanel}
                {fullLog}
                <div className="controls">
                  {state.ended
                    ? endingBanner
                    : choices.length > 0 || inputGate
                      ? choiceControls
                      : config.driver.kind === "life" ? (
                          <button className="continue-btn" onClick={() => act(() => step(config, state))}>
                            {continueLabel}
                          </button>
                        ) : (
                          <button className="continue-btn" onClick={restart}>
                            重新开始
                          </button>
                        )}
                </div>
              </>
            );
          }

          // sim：多页签小游戏界面（像正经经营游戏一样切页操作）
          const recentLog = state.log.slice(-8);
          const pendingEvent = !state.ended && state.pendingCard;
          const lastCardText = [...state.log].reverse().find((l) => l.kind === "card")?.text;
          // 页签由配置推导：没这个模块就没这个页；名字默认取自游戏内容，可用 text.tabLabels 定制
          const labels = config.text?.tabLabels ?? {};
          const dataSettlements = (config.settlements ?? []).filter((st) => (st.data?.length ?? 0) > 0);
          const hasActions = (config.actions ?? []).length > 0;
          const hasRoster = (config.entityTypes?.length ?? 0) > 0 && Object.keys(state.entities ?? {}).length > 0;
          const SIM_TABS: ["overview" | "actions" | "roster" | "schedule" | "log", string][] = [
            ["overview", labels.overview ?? "总览"] as ["overview", string],
            ...(hasActions ? [["actions", labels.actions ?? "行动"] as ["actions", string]] : []),
            ...(hasRoster
              ? [["roster", labels.roster ?? config.entityTypes?.[0]?.name ?? "阵容"] as ["roster", string]]
              : []),
            ...(dataSettlements.length > 0
              ? [["schedule", labels.schedule ?? (dataSettlements.length === 1 ? dataSettlements[0].name : "日程")] as ["schedule", string]]
              : []),
            ["log", labels.log ?? "日志"] as ["log", string],
          ];
          const activeTab = SIM_TABS.some(([t]) => t === simTab) ? simTab : "overview";
          return (
            <>
              {state.ended && <div className="controls">{endingBanner}</div>}
              {pendingEvent && (
                <div className="sim-event">
                  <div className="sim-event-title">⚡ 事件</div>
                  {lastCardText && <div className="sim-event-text">{lastCardText}</div>}
                  <div className="controls">{choiceControls}</div>
                </div>
              )}
              <div className="sim-nav">
                {SIM_TABS.map(([t, label]) => (
                  <button key={t} className={activeTab === t ? "active" : ""} onClick={() => setSimTab(t)}>
                    {label}
                  </button>
                ))}
              </div>
              {activeTab === "overview" && (
                <div className="sim-panel">
                  {upcomingPanel}
                  {state.lastSettlements && Object.keys(state.lastSettlements).length > 0 && (
                    <details className="explain-panel">
                      <summary>上一次结算复盘——为什么是这个结果</summary>
                      {Object.entries(state.lastSettlements).map(([sid, snap]) => (
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
                  )}
                  <div className="gamelog sim-recent">{recentLog.map(renderEntry)}</div>
                  {!state.ended && !pendingEvent && (
                    <div className="controls" style={{ display: "flex", gap: 10 }}>
                      <button className="btn small" onClick={() => setSimTab("actions")}>
                        去安排本{simTime?.turnLabel ?? "回合"} →
                      </button>
                      <button className="btn small secondary" onClick={() => act(() => endTurn(config, state))}>
                        直接结束本{simTime?.turnLabel ?? "回合"} ▸
                      </button>
                    </div>
                  )}
                </div>
              )}
              {activeTab === "actions" && <div className="sim-panel">{!state.ended && !pendingEvent ? actionPanel : <div className="pane-note">先处理上方事件。</div>}</div>}
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
              {activeTab === "log" && <div className="sim-panel">{fullLog}</div>}
            </>
          );
        })()}

        <div className="player-footer">
          {mode === "play" ? (
            <>
              <button className={`like-btn ${liked ? "liked" : ""}`} onClick={toggleLike} title={liked ? "取消点赞" : "给这个游戏点个赞，鼓励作者"}>
                {liked ? "❤" : "♡"} {likes ?? "…"}
              </button>
              <button className="linklike" onClick={share}>
                {copied ? "链接已复制 ✓" : "分享此游戏"}
              </button>
              <button className="linklike" onClick={restart}>
                重新开始
              </button>
              <span>进度已自动存在本地浏览器</span>
              <Link href="/">我也要做一个文字游戏 →</Link>
            </>
          ) : (
            <>
              <button className="linklike" onClick={restart}>
                重置预览
              </button>
              <span>预览与玩家所见完全一致</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** sim 赛程页：每个带 data 的结算展示完整赛程表，标出已赛/下一场 */
function SimSchedule({ config, state }: { config: GameConfig; state: GameState }): React.ReactElement {
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
                      <td>{r.name}{r.isPlayer ? "（你）" : ""}</td>
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
    </div>
  );
}

/** sim 阵容面板：按实体类型分表展示可见属性与标签 */
function Roster({ config, state }: { config: GameConfig; state: GameState }): React.ReactElement | null {
  if (!config.entityTypes?.length || !state.entities) return null;
  return (
    <div className="roster">
      {config.entityTypes.map((t) => {
        const members = (config.entities ?? []).filter((e) => e.type === t.id && state.entities![e.id]);
        if (members.length === 0) return null;
        const cols = t.attributes.filter((a) => a.visible !== false);
        return (
          <details key={t.id} className="roster-group" open>
            <summary>
              {t.name}（{members.length}）
            </summary>
            <div className="roster-scroll">
              <table>
                <thead>
                  <tr>
                    <th>名称</th>
                    {cols.map((a) => (
                      <th key={a.id}>{a.name}</th>
                    ))}
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((e) => {
                    const st = state.entities![e.id];
                    return (
                      <tr key={e.id}>
                        <td>{e.name}</td>
                        {cols.map((a) => (
                          <td key={a.id}>{formatNum(st.attrs[a.id] ?? 0)}</td>
                        ))}
                        <td>
                          {st.tags.map((tag) => (
                            <span key={tag} className="tag">
                              {tag}
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </div>
  );
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();
}
