"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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

function fmtHours(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
  return `${(seconds / 3600).toFixed(1)} 小时`;
}

export default function AdminPage(): React.ReactElement {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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
    } finally {
      setLoading(false);
    }
  }, []);

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
          <Link href="/">字游 WordPlay</Link> · 开发者后台
        </div>
        <Link className="linklike" href="/mine">
          我的创作
        </Link>
      </header>

      <div className="admin-tiles">
        <div className="admin-tile"><b>{stats.totals.plays}</b><span>总游玩人次</span></div>
        <div className="admin-tile"><b>{stats.accounts.total}</b><span>注册账号（{stats.accounts.admins} 位管理员）</span></div>
        <div className="admin-tile"><b>{stats.creators}</b><span>创作者（署名作者数，含游客）</span></div>
        <div className="admin-tile"><b>{stats.games.total}</b><span>作品总数（{stats.games.published} 已发布 / {stats.games.drafts} 草稿）</span></div>
        <div className="admin-tile"><b>{stats.totals.likes}</b><span>总点赞</span></div>
        <div className="admin-tile"><b>{fmtHours(stats.totals.playSeconds)}</b><span>总游玩时长</span></div>
        <div className="admin-tile"><b>{stats.ai.todayRequests}</b><span>今日 AI 请求（累计 {stats.ai.totalRequests} 次 / {Math.round(stats.ai.totalTokens / 1000)}k tokens）</span></div>
        <div className="admin-tile"><b>{stats.library.cards}</b><span>内容库卡片</span></div>
        <div className="admin-tile"><b>{stats.library.assets}</b><span>公共素材</span></div>
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
                <td>{g.published ? "已发布" : "草稿"}</td>
                <td>{g.plays}</td>
                <td>{g.likes}</td>
                <td>{fmtHours(g.playSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 18 }}>
        游客不需要账号也能创作与游玩，所以「注册账号」少于「创作者」是正常的。此页面为暗链，不出现在任何导航中。
      </p>
    </div>
  );
}
