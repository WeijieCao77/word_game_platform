"use client";

import { useCallback, useEffect, useState } from "react";

// 玩家侧的统计上报：进入游玩计一次点击量、点赞、游玩时长。
// 数据是创作者激励与开发者后台的地基，所以宁可多记一次也别漏——
// 每次进入、每次重开都算一次游玩，不做用户去重。

export interface PlayStats {
  likes: number | null;
  liked: boolean;
  toggleLike: () => void;
  /** 重开一局时补记一次游玩 */
  countPlay: () => void;
}

export function usePlayStats(mode: "play" | "preview", gameId?: string): PlayStats {
  const [likes, setLikes] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);

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

  const countPlay = useCallback((): void => {
    if (!gameId) return;
    void fetch(`/api/games/${gameId}/stats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "play" }),
    }).catch(() => undefined);
  }, [gameId]);

  return { likes, liked, toggleLike, countPlay };
}
