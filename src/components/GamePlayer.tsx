"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { GameConfig, GameState } from "@/lib/schema";
import {
  initState,
  step,
  pendingChoices,
  pendingInput,
  availableActions,
  derivedValues,
  upcomingRows,
} from "@/lib/engine";
import { ChoiceControls } from "./player/Choices";
import { GameLog } from "./player/LogView";
import Notebook from "./player/Notebook";
import SearchBox from "./player/SearchBox";
import SimView from "./player/SimView";
import { EndingBanner, StatsBar, UpcomingPanel } from "./player/panels";
import { usePlayStats } from "./player/hooks";
import { configHash, saveKey } from "./player/util";

// 编辑器与播放器同源：/g/:id 的玩家页面和 /edit/:id 的实时预览
// 用的都是这一个组件，换 mode 而已。
//
// 这里只做编排：读写存档、调用引擎、把结果分发给各个界面模块（player/ 目录）。
// 改某块界面长什么样 → 去 player/ 下对应文件；改玩法规则 → 去 src/lib/engine。

interface Props {
  config: GameConfig;
  gameId?: string;
  author?: string;
  mode: "play" | "preview";
}

export default function GamePlayer({ config, gameId, author, mode }: Props): React.ReactElement {
  const [state, setState] = useState<GameState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [staleSave, setStaleSave] = useState(false);
  const [copied, setCopied] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const { likes, liked, toggleLike, countPlay } = usePlayStats(mode, gameId);

  const newGame = useCallback((): void => {
    try {
      const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      setState(initState(config, seed));
      setFatal(null);
      setStaleSave(false);
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

  const isSim = config.driver.kind === "sim";

  const choices = useMemo(() => {
    if (!state) return [];
    try {
      return pendingChoices(config, state);
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
      countPlay(); // 再开一局也是一次游玩
    }
    newGame();
  }, [countPlay, gameId, mode, newGame]);

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

  // 检索台/档案夹常驻侧栏：推理类游戏里这两样要一直看得见，不能随正文滚走
  const hasSearch = !!config.search && config.search.entries.length > 0;
  const hasNotebook = !!config.notebook;
  const hasAside = hasSearch || hasNotebook;
  const asideSide = config.search?.side ?? config.notebook?.side ?? "right";

  const timeLabel = config.driver.kind === "life" ? config.driver.time.label : null;
  const continueLabel = timeLabel === "岁" ? "过一年 ▸" : timeLabel ? `下一${timeLabel} ▸` : "继续 ▸";

  return (
    <div className={`player ${themeClass}`} style={accentStyle}>
      <div className={`player-shell${hasAside ? ` has-aside aside-${asideSide}` : ""}`}>
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

        <StatsBar config={config} state={state} derived={derived} />
        {!hasAside && <Notebook config={config} state={state} gameId={gameId} />}

        {isSim ? (
          <SimView
            config={config}
            state={state}
            gameId={gameId}
            act={act}
            restart={restart}
            choices={choices}
            inputGate={inputGate}
            actions={actions}
            upcoming={upcoming}
            logEndRef={logEndRef}
          />
        ) : (
          <>
            {!state.ended && !state.pendingCard && <UpcomingPanel config={config} rows={upcoming} />}
            <GameLog entries={state.log} gameId={gameId} endRef={logEndRef} />
            <div className="controls">
              {state.ended ? (
                <EndingBanner state={state} onRestart={restart} />
              ) : choices.length > 0 || inputGate ? (
                <ChoiceControls config={config} state={state} choices={choices} inputGate={inputGate} act={act} />
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
          </>
        )}

        <div className="player-footer">
          {mode === "play" ? (
            <>
              <button
                className={`like-btn ${liked ? "liked" : ""}`}
                onClick={toggleLike}
                title={liked ? "取消点赞" : "给这个游戏点个赞，鼓励作者"}
              >
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

      {hasAside && (
        <aside className="case-aside">
          {hasSearch && (
            <section className="aside-block">
              <div className="aside-title">{config.search?.label ?? "检索"}</div>
              <SearchBox config={config} state={state} act={act} />
              <p className="aside-hint">想到什么就查什么——人名、地名、案号、你在走访里留意到的词。</p>
            </section>
          )}
          {hasNotebook && <Notebook config={config} state={state} gameId={gameId} variant="aside" />}
        </aside>
      )}
      </div>
    </div>
  );
}
