import Link from "next/link";
import { getStore } from "@/lib/store";
import GameCover from "@/components/GameCover";

export const dynamic = "force-dynamic";

const KIND_CN: Record<string, string> = { life: "随机成长", story: "分支叙事", sim: "经营模拟", unknown: "文字游戏" };

export default function HomePage(): React.ReactElement {
  const games = getStore().listPublished();
  const flagshipUrl = process.env.FLAGSHIP_URL;
  return (
    <>
      <nav className="topnav">
        <div className="topnav-inner">
          <Link className="brand" href="/">
            字游<span className="brand-accent">·</span>WordPlay
          </Link>
          <a className="topnav-link" href="#library">
            游戏库
          </a>
          <Link className="topnav-link" href="/new">
            创作工作台
          </Link>
          <Link className="topnav-link" href="/mine">
            我的创作
          </Link>
          <span className="topnav-spacer" />
          <Link className="btn small" href="/new">
            ＋ 开始创作
          </Link>
        </div>
      </nav>

      <div className="store">
        <section className="hero">
          <h1>有想法，就能做出一款文字游戏</h1>
          <p>
            不用写代码，不用懂部署。跟 AI 策划聊一聊你的点子——修仙人生、战队经营、都市怪谈——
            对齐方案后它帮你搭好整个游戏：生成、校验、模拟、试玩，一键发布，链接即玩、无需注册。
          </p>
          <div className="hero-actions">
            <Link className="btn" href="/new">
              开始创作 →
            </Link>
            <a className="btn secondary" href="#library">
              先逛逛游戏库
            </a>
          </div>
        </section>

        {flagshipUrl && (
          <>
            <h2 className="section-title">旗舰作品</h2>
            <a className="flagship-banner" href={flagshipUrl} target="_blank" rel="noreferrer">
              <GameCover id="val-manager" title="VAL MANAGER · 无畏契约电竞经理" kind="flagship" wide />
              <span className="flagship-desc">
                真实 VCT 数据的电竞经理模拟——本平台的机制灵感来源。执掌一支真实战队，征战四大赛区 ↗
              </span>
            </a>
          </>
        )}

        <h2 className="section-title" id="library">
          游戏库
        </h2>
        {games.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>还没有已发布的游戏，来做第一个吧。</p>
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
                      <span className="tag">{KIND_CN[g.kind]}</span>
                      <span>{g.author}</span>
                      <span className="stat-chip" title="点赞">♡ {g.likes}</span>
                      <span className="stat-chip" title="游玩次数">▶ {g.plays}</span>
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}

        <footer className="store-footer">
          <span>字游 WordPlay · 文字游戏创作与游玩平台</span>
          <span>免登录游玩 · 作品可导出 · AI 驻场策划</span>
        </footer>
      </div>
    </>
  );
}
