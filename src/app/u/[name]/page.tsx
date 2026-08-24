import Link from "next/link";
import { getStore } from "@/lib/store";
import GameCover from "@/components/GameCover";

export const dynamic = "force-dynamic";

export default async function AuthorPage({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<React.ReactElement> {
  const { name } = await params;
  const author = decodeURIComponent(name);
  const games = getStore().listByAuthor(author);
  return (
    <div className="site">
      <header className="site-header">
        <div className="site-title">
          <Link href="/">字游·WordPlay</Link>
        </div>
        <Link className="btn small" href="/new">
          ＋ 开始创作
        </Link>
      </header>
      <h1 style={{ fontSize: 24, marginBottom: 6 }}>{author}</h1>
      <p style={{ color: "var(--muted)", marginBottom: 20 }}>已发布 {games.length} 款游戏</p>
      {games.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>这位作者还没有发布过游戏。</p>
      ) : (
        <div className="game-grid">
          {games.map((g) => (
            <div className="game-card" key={g.id}>
              <Link className="card-link" href={`/g/${g.id}`}>
                <GameCover
                  id={g.id}
                  title={g.title}
                  kind={g.kind}
                  preset={g.coverPreset}
                  coverUrl={g.hasCover ? `/api/games/${g.id}/cover?v=${encodeURIComponent(g.updatedAt)}` : undefined}
                />
                <div className="game-card-body">
                  <div className="desc">{g.description || "（暂无简介）"}</div>
                  <div className="meta">
                    <span className="stat-chip" title="点赞">♡ {g.likes}</span>
                    <span className="stat-chip" title="游玩次数">▶ {g.plays}</span>
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
