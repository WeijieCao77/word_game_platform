"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import GamePlayer from "@/components/GamePlayer";
import { GameConfig, validateGameConfig } from "@/lib/schema";

interface GameData {
  config: GameConfig;
  author: string;
}

export default function PlayPage({ params }: { params: Promise<{ id: string }> }): React.ReactElement {
  const { id } = use(params);
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const editKey = localStorage.getItem(`wgp_key_${id}`) ?? "";
    fetch(`/api/games/${id}`, { headers: editKey ? { "x-edit-key": editKey } : undefined })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "加载失败");
        const check = validateGameConfig(body.config);
        if (!check.ok) throw new Error("这个游戏的配置有错误，暂时无法游玩");
        setData({ config: check.config!, author: body.author });
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  if (error) {
    return (
      <div className="site">
        <p className="notice">{error}</p>
        <p style={{ marginTop: 16 }}>
          <Link href="/">← 回到游戏库</Link>
        </p>
      </div>
    );
  }
  if (!data) return <div className="site" style={{ color: "var(--muted)" }}>加载中…</div>;
  return <GamePlayer config={data.config} gameId={id} author={data.author} mode="play" />;
}
