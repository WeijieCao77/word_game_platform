"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GamePlayer from "@/components/GamePlayer";
import { GameConfig, validateGameConfig } from "@/lib/schema";

interface GameData {
  config: GameConfig;
  author: string;
}

export default function PlayPage({ params }: { params: Promise<{ id: string }> }): React.ReactElement {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const editKey = localStorage.getItem(`wgp_key_${id}`) ?? "";
    fetch(`/api/games/${id}`, { headers: editKey ? { "x-edit-key": editKey } : undefined })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "加载失败");
        // 自由模式的作品不走通用引擎——它自带一套页面，在 /p/:id。
        // 在这里转过去，游戏库卡片、作者页、以及别人手上已经分享出去的
        // /g/ 链接就都不用改，照样点得开。
        if (body.mode === "code") {
          router.replace(`/p/${id}`);
          return;
        }
        const check = validateGameConfig(body.config);
        if (!check.ok) throw new Error("这个游戏的配置有错误，暂时无法游玩");
        setData({ config: check.config!, author: body.author });
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [id, router]);

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
