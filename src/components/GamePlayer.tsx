"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { GameConfig, GameState } from "@/lib/schema";
import {
  initState,
  step,
  choose,
  pendingChoices,
  performAction,
  endTurn,
  availableActions,
  eligibleTargets,
  derivedValues,
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

export default function GamePlayer({ config, gameId, author, mode }: Props): React.ReactElement {
  const [state, setState] = useState<GameState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [targetPick, setTargetPick] = useState<string | null>(null); // 正在选目标的决策 id
  const logEndRef = useRef<HTMLDivElement>(null);

  const newGame = useCallback((): void => {
    try {
      const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      setState(initState(config, seed));
      setFatal(null);
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
          const saved = JSON.parse(raw) as { v: number; state: GameState };
          if (saved.v === 1 && saved.state && typeof saved.state.turn === "number") {
            pendingChoices(config, saved.state);
            availableActions(config, saved.state);
            setState(saved.state);
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
        localStorage.setItem(saveKey(gameId), JSON.stringify({ v: 1, state }));
      } catch {
        // 存储满等情况不致命
      }
    }
  }, [state, gameId, mode]);

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

  const act = useCallback((fn: () => GameState): void => {
    try {
      setState(fn());
      setTargetPick(null);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const restart = useCallback((): void => {
    if (mode === "play" && gameId) {
      try {
        localStorage.removeItem(saveKey(gameId));
      } catch {
        // 忽略
      }
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
    config.theme?.preset === "dark" ? "theme-dark" : config.theme?.preset === "terminal" ? "theme-terminal" : "";
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
        <div className="player-title">{config.meta.title}</div>
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

        {isSim && <Roster config={config} state={state} />}

        <div className="gamelog">
          {state.log.map((entry, i) => (
            <div key={i} className={`log-${entry.kind}`}>
              {entry.text}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        <div className="controls">
          {state.ended ? (
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
          ) : choices.length > 0 ? (
            choices.map((c) => (
              <button key={c.id} className="choice-btn" onClick={() => act(() => choose(config, state, c.id))}>
                {c.label}
              </button>
            ))
          ) : isSim ? (
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
                      {a.usesLeft !== null && <span className="uses">×{a.usesLeft}</span>}
                    </button>
                  )
                )}
              </div>
              <button className="continue-btn" onClick={() => act(() => endTurn(config, state))}>
                结束本{simTime?.turnLabel ?? "回合"} ▸
              </button>
            </>
          ) : config.driver.kind === "life" ? (
            <button className="continue-btn" onClick={() => act(() => step(config, state))}>
              {continueLabel}
            </button>
          ) : (
            <button className="continue-btn" onClick={restart}>
              重新开始
            </button>
          )}
        </div>

        <div className="player-footer">
          {mode === "play" ? (
            <>
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
