import Link from "next/link";
import { getStore } from "@/lib/store";
import GameCover from "@/components/GameCover";
import AuthNav from "@/components/AuthNav";
import BrandMark from "@/components/BrandMark";

export const dynamic = "force-dynamic";

const KIND_CN: Record<string, string> = { life: "随机成长", story: "分支叙事", sim: "经营模拟", unknown: "文字游戏" };

/** 游戏库分类：按「怎么玩」分三档，题材（meta.genre）作为附加筛选出现在后面 */
const KIND_TABS: { key: string; label: string }[] = [
  { key: "", label: "全部" },
  { key: "sim", label: "经营模拟" },
  { key: "story", label: "分支叙事" },
  { key: "life", label: "随机成长" },
];
const SORT_TABS: { key: string; label: string }[] = [
  { key: "new", label: "最新" },
  { key: "hot", label: "最热" },
  { key: "liked", label: "最赞" },
];

function libraryHref(cat: string, genre: string, sort: string): string {
  const q = new URLSearchParams();
  if (cat) q.set("cat", cat);
  if (genre) q.set("genre", genre);
  if (sort && sort !== "new") q.set("sort", sort);
  const qs = q.toString();
  return `/${qs ? `?${qs}` : ""}#library`;
}

/** 简介越长，背面字号收得越小——让整段话在卡片背面一次显示完 */
function descClass(desc: string): string {
  const n = (desc ?? "").length;
  if (n > 190) return "xxs";
  if (n > 130) return "xs";
  if (n > 95) return "sm";
  if (n > 65) return "md";
  return "";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; genre?: string; sort?: string }>;
}): Promise<React.ReactElement> {
  const sp = await searchParams;
  const cat = sp.cat ?? "";
  const genre = sp.genre ?? "";
  const sort = sp.sort === "hot" || sp.sort === "liked" ? sp.sort : "new";
  const all = getStore().listPublished(100, sort);
  // 题材标签从已发布作品里现算——作者填了才出现，不写死一张表
  const genres = Array.from(new Set(all.map((g) => g.genre).filter((x): x is string => !!x))).slice(0, 12);
  const games = all.filter((g) => (!cat || g.kind === cat) && (!genre || g.genre === genre));
  const flagshipUrl = process.env.FLAGSHIP_URL;
  // 旗舰作品的署名：默认「官方出品」，部署时可用 FLAGSHIP_AUTHOR 改成任何名字
  const flagshipAuthor = process.env.FLAGSHIP_AUTHOR || "官方出品";
  return (
    <>
      <nav className="topnav">
        <div className="topnav-inner">
          <Link className="brand" href="/">
            <BrandMark size={26} />
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
          <AuthNav />
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
            <Link className="flagship-banner" href="/flagship">
              <div className="flagship-flip">
                <div className="flagship-face flagship-front">
                  <GameCover id="val-manager" title="VAL MANAGER · 无畏契约电竞经理" kind="flagship" wide />
                  <span className="flagship-desc">
                    <span className="flagship-meta">
                      <span className="tag">经营模拟</span>
                      <span className="flagship-author">作者：{flagshipAuthor}</span>
                      <span className="flagship-sep">·</span>
                      <span>站内直接开玩</span>
                    </span>
                    真实 VCT 数据的电竞经理模拟——本平台的机制灵感来源。执掌一支真实战队，征战四大赛区。
                  </span>
                </div>
                <div className="flagship-face flagship-back">
                  <b className="flagship-back-title">VAL MANAGER · 无畏契约电竞经理</b>
                  <span className="flagship-back-by">
                    <span className="tag">经营模拟</span>
                    作者：{flagshipAuthor}
                  </span>
                  <p>
                    执掌一支真实战队打完整个赛季：引援与续约、日常训练与体能管理、赛前战术准备、
                    赛场上的临场调整——每一个决定都会写进战绩。选手与战力取自 vlr.gg 的真实 VCT 数据，
                    四大赛区、常规赛到季后赛的完整赛程。
                  </p>
                  <p className="flagship-back-note">
                    它是本平台的机制灵感来源：字游的经营模拟调度器——行动点取舍、活的积分榜、
                    结算复盘——都是从这款游戏倒推出来的。现在你也能用工作台做出这个量级的作品。
                  </p>
                  <span className="cover-hover-cta">站内直接开玩 →</span>
                </div>
              </div>
            </Link>
          </>
        )}

        <h2 className="section-title" id="library">
          游戏库
        </h2>

        <div className="lib-filters">
          <div className="lib-row">
            {KIND_TABS.map((t) => (
              <Link
                key={t.key}
                className={`lib-chip${cat === t.key && !genre ? " active" : ""}`}
                href={libraryHref(t.key, "", sort)}
              >
                {t.label}
              </Link>
            ))}
            {genres.map((g) => (
              <Link
                key={g}
                className={`lib-chip genre${genre === g ? " active" : ""}`}
                href={libraryHref("", g, sort)}
              >
                {g}
              </Link>
            ))}
          </div>
          <div className="lib-row lib-sort">
            <span className="lib-sort-label">排序</span>
            {SORT_TABS.map((t) => (
              <Link
                key={t.key}
                className={`lib-chip small${sort === t.key ? " active" : ""}`}
                href={libraryHref(cat, genre, t.key)}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
        {games.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            {cat || genre ? (
              <>
                这个分类下还没有作品。<Link href="/#library">看看全部</Link>，或者<Link href="/new">自己做一个</Link>。
              </>
            ) : (
              <>还没有已发布的游戏，来做第一个吧。</>
            )}
          </p>
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
                          <span className="tag">{KIND_CN[g.kind]}</span>
                          {g.genre && <span className="tag genre-tag">{g.genre}</span>}
                          <span>{g.author}</span>
                          <span className="stat-chip" title="点赞">♡ {g.likes}</span>
                          <span className="stat-chip" title="游玩次数">▶ {g.plays}</span>
                        </div>
                      </div>
                    </div>
                    <div className="card-face card-back">
                      <b className="card-back-title">{g.title}</b>
                      <p className={descClass(g.description)}>{g.description || "作者还没写简介——点开试试手气。"}</p>
                      <div className="card-back-foot">
                        <span className="tag">{KIND_CN[g.kind]}</span>
                        <span className="cover-hover-cta">开始游玩 →</span>
                      </div>
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
