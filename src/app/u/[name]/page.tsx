import Link from "next/link";
import { getStore } from "@/lib/store";
import GameCover from "@/components/GameCover";

export const dynamic = "force-dynamic";

/** 简介越长，背面字号收得越小——让整段话在卡片背面一次显示完 */
function descClass(desc: string): string {
  const n = (desc ?? "").length;
  if (n > 190) return "xxs";
  if (n > 130) return "xs";
  if (n > 95) return "sm";
  if (n > 65) return "md";
  return "";
}

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
                <div className="card-flip">
                  <div className="card-face card-front">
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
                  </div>
                  <div className="card-face card-back">
                    <b className="card-back-title">{g.title}</b>
                    <p className={descClass(g.description)}>{g.description || "作者还没写简介。"}</p>
                    <div className="card-back-foot">
                      <span className="cover-hover-cta">开始游玩 →</span>
                    </div>
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
