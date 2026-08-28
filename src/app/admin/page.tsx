"use client";

import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { useCallback, useEffect, useState } from "react";
import { fmtWan } from "@/lib/format";

// 平台开发者后台（暗链，不进导航）：全站数据汇总，只对管理员账号开放。
// 管理员 = 平台第一个注册的账号，之后可由管理员提拔别人。
// 无账号的游客用游玩人次近似「用户规模」，注册账号数单独统计。

interface AdminStats {
  games: { total: number; published: number; drafts: number };
  creators: number;
  accounts: { total: number; admins: number };
  totals: { plays: number; likes: number; playSeconds: number };
  daily: { date: string; plays: number; likes: number; playSeconds: number }[];
  topGames: { id: string; title: string; author: string; plays: number; likes: number; playSeconds: number; published: boolean }[];
  ai: { totalRequests: number; totalTokens: number; todayRequests: number; todayTokens: number };
  library: { cards: number; assets: number };
}

interface QuotaReq {
  id: number;
  userId: string;
  username: string;
  createdAt: string;
  used: number;
  grantAtRequest: number;
  status: "pending" | "granted" | "denied";
  granted: number;
  handledAt: string | null;
}

/** 后台账号清单的一行（旗舰位主动放额用） */
interface Account {
  id: string;
  username: string;
  role: "user" | "admin";
  createdAt: string;
  grant: number;
  used: number;
  flagship: boolean;
}


/**
 * 估算花费。单价走 NEXT_PUBLIC_AI_PRICE_PER_M（元/百万 token），没配就不显示——
 * 与其给一个瞎猜的数字，不如不给。我们的 token 里输入侧占九成以上
 * （每轮都要重发整份配置），所以这里应该填**混合价**，接近输入价。
 */
function fmtCost(tokens: number): string | null {
  const price = Number(process.env.NEXT_PUBLIC_AI_PRICE_PER_M ?? "");
  if (!Number.isFinite(price) || price <= 0) return null;
  return `≈ ¥${((tokens / 1_000_000) * price).toFixed(2)}`;
}

function fmtHours(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
  return `${(seconds / 3600).toFixed(1)} 小时`;
}

interface LibraryGame {
  id: string;
  title: string;
  author: string;
  mode: string;
  plays: number;
  likes: number;
  updatedAt: string;
  codeFiles: number;
  codeBytes: number;
  /** 是否已归属某个账号；无主（游客建的）才允许「划归账号」 */
  owned: boolean;
}

export default function AdminPage(): React.ReactElement {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [library, setLibrary] = useState<LibraryGame[]>([]);
  const [busyGame, setBusyGame] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [quotaReqs, setQuotaReqs] = useState<QuotaReq[]>([]);
  const [defaultGrant, setDefaultGrant] = useState(2_000_000);
  const [flagshipGrant, setFlagshipGrant] = useState(20_000_000);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [acctQuery, setAcctQuery] = useState("");
  const [busyUser, setBusyUser] = useState("");
  const [busyReq, setBusyReq] = useState<number | null>(null);

  const loadQuota = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/admin/quota");
      if (!res.ok) return;
      const body = await res.json();
      setQuotaReqs(body.requests ?? []);
      setAccounts((body.accounts ?? []) as Account[]);
      if (body.defaultGrant) setDefaultGrant(body.defaultGrant);
      if (body.flagshipGrant) setFlagshipGrant(body.flagshipGrant);
    } catch {
      // 后台是暗链工具页，额度这一块加载失败不该把整页拖垮
    }
  }, []);

  /** 主动给某个账号放额 / 升降旗舰位。跟批申请单是同一个接口的另外两个 action。 */
  const actOnUser = useCallback(
    async (userId: string, payload: Record<string, unknown>): Promise<void> => {
      setBusyUser(userId);
      try {
        const res = await fetch("/api/admin/quota", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, ...payload }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? "放额没成功");
          return;
        }
        await loadQuota();
      } finally {
        setBusyUser("");
      }
    },
    [loadQuota]
  );

  const resolveReq = useCallback(
    async (id: number, tokens: number): Promise<void> => {
      setBusyReq(id);
      try {
        await fetch("/api/admin/quota", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, tokens }),
        });
        await loadQuota();
      } finally {
        setBusyReq(null);
      }
    },
    [loadQuota]
  );

  const loadLibrary = useCallback(async (): Promise<void> => {
    const res = await fetch("/api/admin/games");
    if (!res.ok) return;
    const body = await res.json();
    setLibrary((body.games ?? []) as LibraryGame[]);
  }, []);

  /**
   * 把一部作品从公开库撤下来。
   *
   * **只动挂牌，不动链接**：撤下之后它不再出现在公开列表里，
   * 但拿着链接的人（作者、测试者、已经分享出去的人）照样打得开。
   * 原来这两件事共用一个字段，撤下等于把链接一起弄死。
   */
  const takeDown = useCallback(
    async (id: string, listed: boolean): Promise<void> => {
      setBusyGame(id);
      try {
        await fetch("/api/admin/games", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // 撤下动的是**挂牌**，不是链接。原来这里传的是 published，
          // 于是「把半成品撤下公开库」＝「把作者和测试者的链接一起弄死」。
          body: JSON.stringify({ id, listed }),
        });
        await loadLibrary();
      } finally {
        setBusyGame("");
      }
    },
    [loadLibrary]
  );

  /**
   * 彻底删除（清理实测遗留用）。不可恢复——文件、版本、聊天记录一起没，
   * 所以要打全名二次确认。正常创作者的作品别用这个删。
   */
  const removeGame = useCallback(
    async (g: LibraryGame): Promise<void> => {
      const size = g.mode === "code" ? `${g.codeFiles} 个文件 · ${(g.codeBytes / 1000).toFixed(1)}k 字符` : "快速模式";
      if (!window.confirm(`确定彻底删除「${g.title}」（${size}）？\n删除不可恢复，作者带钥匙也找不回来。`)) return;
      setBusyGame(g.id);
      try {
        await fetch("/api/admin/games", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: g.id }),
        });
        await loadLibrary();
      } finally {
        setBusyGame("");
      }
    },
    [loadLibrary]
  );

  /**
   * 收编：把无主作品（游客建的、钥匙已丢）划归某个账号。
   * 实测遗留的作品钥匙只存在于那次 run 里，不划归就永远没人能再编辑。
   */
  const assignOwner = useCallback(
    async (g: LibraryGame): Promise<void> => {
      const username = window.prompt(`把「${g.title}」划归哪个账号？（只对无主作品有效）`, "test1");
      if (!username?.trim()) return;
      setBusyGame(g.id);
      try {
        const res = await fetch("/api/admin/games", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: g.id, username: username.trim() }),
        });
        const body = await res.json();
        setError(res.ok ? "" : body.error ?? "划归失败");
        await loadLibrary();
      } finally {
        setBusyGame("");
      }
    },
    [loadLibrary]
  );

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/stats");
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "加载失败");
        setStats(null);
        return;
      }
      setStats(body as AdminStats);
      await loadQuota();
      await loadLibrary();
    } finally {
      setLoading(false);
    }
  }, [loadQuota, loadLibrary]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="site" style={{ color: "var(--muted)" }}>加载中…</div>;

  if (!stats) {
    return (
      <div className="site" style={{ maxWidth: 460 }}>
        <h1 style={{ fontSize: 22, marginBottom: 12 }}>开发者后台</h1>
        <p style={{ color: "var(--muted)", marginBottom: 16 }}>{error || "需要管理员账号"}</p>
        <div className="hero-actions">
          <Link className="btn" href="/login?next=/admin">
            去登录
          </Link>
          <Link className="btn secondary" href="/">
            返回首页
          </Link>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 18 }}>
          平台的第一个注册账号就是管理员；之后要加管理员，由现有管理员提拔。
        </p>
      </div>
    );
  }

  const maxPlays = Math.max(1, ...stats.daily.map((d) => d.plays));
  return (
    <div className="site">
      <header className="site-header">
        <div className="site-title">
          <Link className="brand-inline" href="/"><BrandMark size={22} />字游 WordPlay</Link> · 开发者后台
        </div>
        <Link className="linklike" href="/mine">
          我的创作
        </Link>
      </header>

      <div className="admin-tiles">
        <div className="admin-tile"><b>{stats.totals.plays}</b><span>总游玩人次</span></div>
        <div className="admin-tile"><b>{stats.accounts.total}</b><span>注册账号（{stats.accounts.admins} 位管理员）</span></div>
        <div className="admin-tile"><b>{stats.creators}</b><span>创作者（署名作者数，含游客）</span></div>
        <div className="admin-tile"><b>{stats.games.total}</b><span>作品总数（{stats.games.published} 个链接开着 / {stats.games.drafts} 个还没发过）</span></div>
        <div className="admin-tile"><b>{stats.totals.likes}</b><span>总点赞</span></div>
        <div className="admin-tile"><b>{fmtHours(stats.totals.playSeconds)}</b><span>总游玩时长</span></div>
        <div className="admin-tile"><b>{stats.ai.todayRequests}</b><span>今日 AI 请求（累计 {stats.ai.totalRequests} 次 / {fmtWan(stats.ai.totalTokens)} tokens{fmtCost(stats.ai.totalTokens) ? ` · ${fmtCost(stats.ai.totalTokens)}` : ""}）</span></div>
        <div className="admin-tile"><b>{stats.library.cards}</b><span>内容库卡片</span></div>
        <div className="admin-tile"><b>{stats.library.assets}</b><span>公共素材</span></div>
      </div>

      <h2 className="section-title">
        额度申请
        {quotaReqs.filter((r) => r.status === "pending").length > 0 && (
          <span className="tag" style={{ marginLeft: 8 }}>
            {quotaReqs.filter((r) => r.status === "pending").length} 条待批
          </span>
        )}
      </h2>
      {quotaReqs.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          还没有人把额度用光。注册账号默认发 {fmtWan(defaultGrant)} tokens，用完会自动出现在这里。
        </p>
      ) : (
        <div className="roster-scroll">
          <table className="admin-table">
            <thead>
              <tr><th>账号</th><th>申请时间</th><th>已用</th><th>手上额度</th><th>操作</th></tr>
            </thead>
            <tbody>
              {quotaReqs.map((r) => (
                <tr key={r.id}>
                  <td>{r.username}</td>
                  <td>{r.createdAt.slice(0, 16).replace("T", " ")}</td>
                  <td>{fmtWan(r.used)}{fmtCost(r.used) ? ` · ${fmtCost(r.used)}` : ""}</td>
                  <td>{fmtWan(r.grantAtRequest)}</td>
                  <td>
                    {r.status === "pending" ? (
                      <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="linklike" disabled={busyReq === r.id} onClick={() => void resolveReq(r.id, defaultGrant)}>
                          再批 {fmtWan(defaultGrant)}
                        </button>
                        <button className="linklike" disabled={busyReq === r.id} onClick={() => void resolveReq(r.id, Math.round(defaultGrant / 2))}>
                          批一半
                        </button>
                        <button className="linklike" disabled={busyReq === r.id} onClick={() => void resolveReq(r.id, 0)}>
                          拒绝
                        </button>
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>
                        {r.status === "granted" ? `已批 ${fmtWan(r.granted)}` : "已拒绝"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">
        账号额度
        <span className="tag" style={{ marginLeft: 8 }}>
          旗舰位 {fmtWan(flagshipGrant)}
        </span>
      </h2>
      {/* 为什么这一块要存在：额度规矩是注册即 {defaultGrant}，而搭一部 VAL MANAGER
          量级的作品实测要 733 万——深度创作者必然不够用。原来后台只有「等他撞墙、
          系统自动开申请单」这一条被动通路，管理员想主动给谁放额是做不到的。 */}
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 10px" }}>
        注册账号默认 {fmtWan(defaultGrant)}。做大体量作品（几十个界面那种）的创作者
        用得完——给他升旗舰位，池子直接放到还剩 {fmtWan(flagshipGrant)}。
        降回普通只摘标签，<b>已经批出去的额度不收回</b>（搭到一半被抽走，作品就烂在半截了）。
      </p>
      <input
        className="input"
        style={{ maxWidth: 260, marginBottom: 10 }}
        placeholder="按账号名筛"
        value={acctQuery}
        onChange={(e) => setAcctQuery(e.target.value)}
      />
      <div className="roster-scroll">
        <table className="admin-table">
          <thead>
            <tr><th>账号</th><th>已用 / 额度</th><th>还剩</th><th>操作</th></tr>
          </thead>
          <tbody>
            {accounts
              .filter((a) => !acctQuery.trim() || a.username.toLowerCase().includes(acctQuery.trim().toLowerCase()))
              .map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.username}
                    {a.flagship && <span className="tag" style={{ marginLeft: 6 }}>旗舰位</span>}
                    {a.role === "admin" && <span className="tag" style={{ marginLeft: 6 }}>管理员</span>}
                  </td>
                  <td>
                    {fmtWan(a.used)} / {a.role === "admin" ? "不限量" : fmtWan(a.grant)}
                    {fmtCost(a.used) ? ` · ${fmtCost(a.used)}` : ""}
                  </td>
                  <td>{a.role === "admin" ? "—" : fmtWan(Math.max(0, a.grant - a.used))}</td>
                  <td>
                    <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {a.flagship ? (
                        <button
                          className="linklike"
                          disabled={busyUser === a.id}
                          onClick={() => void actOnUser(a.id, { action: "flagship", on: false })}
                        >
                          降回普通
                        </button>
                      ) : (
                        <button
                          className="linklike"
                          disabled={busyUser === a.id}
                          onClick={() => void actOnUser(a.id, { action: "flagship", on: true })}
                        >
                          升为旗舰位
                        </button>
                      )}
                      <button
                        className="linklike"
                        disabled={busyUser === a.id}
                        onClick={() => void actOnUser(a.id, { action: "grant", tokens: defaultGrant })}
                      >
                        加 {fmtWan(defaultGrant)}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            {accounts.length === 0 && (
              <tr><td colSpan={4} style={{ color: "var(--muted)" }}>还没有注册账号。</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">近 14 天游玩</h2>
      <div className="admin-daily">
        {[...stats.daily].reverse().map((d) => (
          <div key={d.date} className="admin-day" title={`${d.date}：${d.plays} 次游玩 · ${d.likes} 赞 · ${fmtHours(d.playSeconds)}`}>
            <div className="admin-bar" style={{ height: `${Math.max(4, (d.plays / maxPlays) * 90)}px` }} />
            <span>{d.date.slice(5)}</span>
            <b>{d.plays}</b>
          </div>
        ))}
        {stats.daily.length === 0 && <p style={{ color: "var(--muted)" }}>还没有数据。</p>}
      </div>

      <h2 className="section-title">作品排行（按游玩）</h2>
      <div className="roster-scroll">
        <table className="admin-table">
          <thead>
            <tr><th>#</th><th>作品</th><th>作者</th><th>状态</th><th>游玩</th><th>点赞</th><th>总时长</th></tr>
          </thead>
          <tbody>
            {stats.topGames.map((g, i) => (
              <tr key={g.id}>
                <td>{i + 1}</td>
                <td><Link href={`/g/${g.id}`}>{g.title}</Link></td>
                <td>{g.author || "—"}</td>
                <td>{g.published ? "链接开着" : "还没发过"}</td>
                <td>{g.plays}</td>
                <td>{g.likes}</td>
                <td>{fmtHours(g.playSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="section-title">公开游戏库（{library.length}）</h2>
      <p className="pane-note" style={{ marginBottom: 10 }}>
        这里列的是玩家在首页能看到的全部作品。撤下**只动挂牌**：撤下之后它不再出现在
        公开列表里，但**链接照旧能玩**——作者、测试者、已经分享出去的人都不受影响。
        （以前这两件事是同一个开关，撤下会把链接一起弄死。）
        删除是彻底清掉（实测遗留的半成品用这个），不可恢复，正常创作者的作品别碰。
      </p>
      <div className="roster-scroll">
        <table className="admin-table">
          <thead>
            <tr><th>作品</th><th>作者</th><th>形态</th><th>体量</th><th>游玩</th><th>点赞</th><th></th></tr>
          </thead>
          <tbody>
            {library.map((g) => (
              <tr key={g.id}>
                <td><Link href={g.mode === "code" ? `/p/${g.id}` : `/g/${g.id}`}>{g.title}</Link></td>
                <td>{g.author || "—"}</td>
                <td>{g.mode === "code" ? "自由模式" : "快速模式"}</td>
                <td>
                  {g.mode === "code"
                    ? `${g.codeFiles} 个文件 · ${(g.codeBytes / 1000).toFixed(1)}k 字符`
                    : "—"}
                </td>
                <td>{g.plays}</td>
                <td>{g.likes}</td>
                <td>
                  <button className="linklike" disabled={busyGame === g.id} onClick={() => void takeDown(g.id, false)}>
                    {busyGame === g.id ? "处理中…" : "撤下"}
                  </button>
                  {!g.owned && (
                    <>
                      {" "}
                      <button className="linklike" disabled={busyGame === g.id} onClick={() => void assignOwner(g)}>
                        划归账号
                      </button>
                    </>
                  )}
                  {" "}
                  <button
                    className="linklike"
                    style={{ color: "var(--danger, #e5484d)" }}
                    disabled={busyGame === g.id}
                    onClick={() => void removeGame(g)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {library.length === 0 && (
              <tr><td colSpan={6} style={{ color: "var(--muted)" }}>公开库里还没有作品。</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 18 }}>
        游客不需要账号也能创作与游玩，所以「注册账号」少于「创作者」是正常的。此页面为暗链，不出现在任何导航中。
      </p>
    </div>
  );
}
