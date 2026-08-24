import Link from "next/link";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const KIND_CN: Record<string, string> = { life: "随机成长", story: "分支叙事", unknown: "文字游戏" };

export default function HomePage(): React.ReactElement {
  const games = getStore().listPublished();
  return (
    <div className="site">
      <header className="site-header">
        <div className="site-title">
          <Link href="/">字游 WordPlay</Link>
        </div>
        <nav>
          <Link className="btn small" href="/new">
            ＋ 创建游戏
          </Link>
        </nav>
      </header>

      <section className="hero">
        <h1>
          有想法，就能做出一款文字游戏。
        </h1>
        <p>
          不用写代码，不用懂部署。跟 AI 策划聊一聊你的点子——修仙人生、宗门经营、都市怪谈——
          它帮你把想法变成可以玩的游戏：生成、校验、模拟、试玩，满意后一键发布，
          一条链接分享给所有人，打开即玩、无需注册。
        </p>
        <p>
          <Link className="btn" href="/new">
            开始创作 →
          </Link>
        </p>
      </section>

      <h2 className="section-title">游戏库</h2>
      {games.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>还没有已发布的游戏，来做第一个吧。</p>
      ) : (
        <div className="game-grid">
          {games.map((g) => (
            <div className="game-card" key={g.id}>
              <h3>
                <Link href={`/g/${g.id}`}>{g.title}</Link>
              </h3>
              <div className="desc">{g.description || "（暂无简介）"}</div>
              <div className="meta">
                <span className="tag">{KIND_CN[g.kind]}</span>
                {g.author && <Link href={`/u/${encodeURIComponent(g.author)}`}>{g.author}</Link>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
