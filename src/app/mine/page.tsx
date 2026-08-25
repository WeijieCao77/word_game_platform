"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import GameCover from "@/components/GameCover";
import BrandMark from "@/components/BrandMark";
import AuthNav, { useMe } from "@/components/AuthNav";

// 我的创作：扫描本机保存的编辑钥匙，列出这台浏览器创建/认领过的所有游戏——
// 草稿也能找回来，不再依赖记住 /edit/:id 链接。
// 两种身份并存：游客靠本机编辑钥匙（钥匙串可备份/导入），注册用户靠账号——
// 登录后作品跟着账号走，换设备直接找回。本机的无主作品可以一键收进账号。

const KIND_CN: Record<string, string> = { life: "随机成长", story: "分支叙事", sim: "经营模拟", unknown: "文字游戏" };

interface MineEntry {
  id: string;
  key: string;
  title: string;
  kind: string;
  published: boolean;
  updatedAt: string;
  hasCover?: boolean;
  coverPreset?: string;
  likes?: number;
  plays?: number;
  avgPlaySeconds?: number;
  missing?: boolean;
  /** 已绑定别人的账号：本机虽有钥匙也不能再编辑 */
  lockedByOther?: boolean;
}

function fmtDuration(s?: number): string {
  if (!s) return "—";
  if (s < 60) return `${s} 秒`;
  return `${Math.round(s / 60)} 分钟`;
}

function localKeys(): { id: string; key: string }[] {
  const out: { id: string; key: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith("wgp_key_")) continue;
    const v = localStorage.getItem(k);
    if (v) out.push({ id: k.slice("wgp_key_".length), key: v });
  }
  return out;
}

export default function MinePage(): React.ReactElement {
  const { me, refresh: refreshMe } = useMe();
  const [claiming, setClaiming] = useState(false);
  const [entries, setEntries] = useState<MineEntry[] | null>(null);
  const [importText, setImportText] = useState("");
  const [notice, setNotice] = useState("");

  const [lockedCount, setLockedCount] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    const keys = localKeys();

    // 本机编辑钥匙持有的作品
    const byKey = await Promise.all(
      keys.map(async ({ id, key }): Promise<MineEntry> => {
        try {
          const res = await fetch(`/api/games/${id}`, { headers: { "x-edit-key": key } });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            // 403 + owned：钥匙没问题，是这部作品已经绑定到别的账号了
            if (res.status === 403 && err.owned) {
              return { id, key, title: id, kind: "unknown", published: false, updatedAt: "", lockedByOther: true };
            }
            return { id, key, title: id, kind: "unknown", published: false, updatedAt: "", missing: true };
          }
          const body = await res.json();
          // 作品已绑定账号、而当前不是归属人：钥匙不再授权，从列表里拿掉
          if (!body.canEdit) {
            return {
              id,
              key,
              title: body.config?.meta?.title ?? id,
              kind: "unknown",
              published: false,
              updatedAt: "",
              missing: !body.owned,
              lockedByOther: !!body.owned,
            };
          }
          let stats: { likes?: number; plays?: number; avgPlaySeconds?: number } = {};
          try {
            stats = await (await fetch(`/api/games/${id}/stats`, { headers: { "x-edit-key": key } })).json();
          } catch {
            // 统计拉取失败不影响列表
          }
          return {
            likes: stats.likes,
            plays: stats.plays,
            avgPlaySeconds: stats.avgPlaySeconds,
            id,
            key,
            title: body.config?.meta?.title ?? id,
            kind: body.config?.driver?.kind ?? "unknown",
            published: !!body.published,
            updatedAt: body.updatedAt ?? "",
            hasCover: !!body.hasCover,
            coverPreset: body.config?.meta?.coverPreset,
          };
        } catch {
          return { id, key, title: id, kind: "unknown", published: false, updatedAt: "", missing: true };
        }
      })
    );

    // 账号名下的作品（换设备登录也能看到，本机没钥匙也算）
    let byAccount: MineEntry[] = [];
    try {
      const res = await fetch("/api/auth/games");
      if (res.ok) {
        const body = (await res.json()) as { games?: { id: string; title: string; kind: string; updatedAt: string; hasCover?: boolean; coverPreset?: string; likes?: number; plays?: number }[] };
        byAccount = (body.games ?? []).map((g) => ({
          id: g.id,
          key: "",
          title: g.title,
          kind: g.kind ?? "unknown",
          published: false,
          updatedAt: g.updatedAt ?? "",
          hasCover: g.hasCover,
          coverPreset: g.coverPreset,
          likes: g.likes,
          plays: g.plays,
        }));
      }
    } catch {
      // 未登录或网络问题：只显示本机钥匙的部分
    }

    const usable = byKey.filter((e) => !e.lockedByOther);
    setLockedCount(byKey.filter((e) => e.lockedByOther).length);

    // 合并去重：本机钥匙的条目信息更全（含发布状态与统计），优先保留
    const merged = new Map<string, MineEntry>();
    for (const e of byAccount) merged.set(e.id, e);
    for (const e of usable) merged.set(e.id, { ...merged.get(e.id), ...e });

    const results = [...merged.values()];
    results.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    setEntries(results);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, me?.username]);

  const exportKeyring = useCallback((): void => {
    const data = { platform: "wordplay", exportedAt: new Date().toISOString(), games: localKeys() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wordplay-钥匙串.json";
    a.click();
    URL.revokeObjectURL(url);
    setNotice("钥匙串已导出——存好这个文件，换设备或清缓存后导入即可找回所有作品");
  }, []);

  const importKeyring = useCallback((): void => {
    try {
      const data = JSON.parse(importText) as { games?: { id?: string; key?: string }[] };
      let added = 0;
      for (const g of data.games ?? []) {
        if (typeof g.id === "string" && typeof g.key === "string" && g.id && g.key) {
          localStorage.setItem(`wgp_key_${g.id}`, g.key);
          added++;
        }
      }
      setImportText("");
      setNotice(`已导入 ${added} 把钥匙`);
      void refresh();
    } catch {
      setNotice("导入失败：内容不是合法的钥匙串 JSON");
    }
  }, [importText, refresh]);

  const forget = useCallback(
    (id: string): void => {
      localStorage.removeItem(`wgp_key_${id}`);
      void refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    (e: MineEntry): void => {
      const warn = e.published
        ? `确定删除《${e.title}》吗？\n\n这个游戏已经发布，删除后玩家的链接会全部失效，且无法恢复。\n如需备份，请先到工作台点「导出」。`
        : `确定删除草稿《${e.title}》吗？删除后无法恢复。`;
      if (!window.confirm(warn)) return;
      void (async () => {
        try {
          const res = await fetch(`/api/games/${e.id}`, { method: "DELETE", headers: { "x-edit-key": e.key } });
          if (!res.ok) throw new Error((await res.json()).error ?? "删除失败");
          localStorage.removeItem(`wgp_key_${e.id}`);
          setNotice(`已删除《${e.title}》`);
          void refresh();
        } catch (err) {
          setNotice(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [refresh]
  );

  return (
    <div className="site">
      <header className="site-header">
        <div className="site-title">
          <Link className="brand-inline" href="/"><BrandMark size={22} />字游 WordPlay</Link>
        </div>
        <AuthNav />
        <Link className="btn small" href="/new">
          ＋ 开始创作
        </Link>
      </header>
      <h1 style={{ fontSize: 24, marginBottom: 6 }}>我的创作</h1>
      <p style={{ color: "var(--muted)", marginBottom: 16 }}>
        这台浏览器上有编辑钥匙的所有游戏——包括没发布的草稿。
      </p>

      <div className="account-bar">
        {me ? (
          <>
            <span>
              已登录 <b>{me.username}</b>
              {me.role === "admin" && <span className="tag admin-tag">管理员</span>}
              ——新作品会自动记在账号名下，换设备登录即可找回。
            </span>
            <button
              className="btn small secondary"
              disabled={claiming || !entries || entries.length === 0}
              onClick={() => {
                setClaiming(true);
                const keys = localKeys().map((k) => ({ id: k.id, editKey: k.key }));
                void fetch("/api/auth/claim", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ keys }),
                })
                  .then((r) => r.json())
                  .then((b) =>
                    setNotice(
                      b.claimed > 0
                        ? `已把本机 ${b.claimed} 部作品收进账号 ✓`
                        : "本机作品都已经在账号名下了（或不属于你）"
                    )
                  )
                  .catch(() => setNotice("认领失败，稍后再试"))
                  .finally(() => setClaiming(false));
              }}
            >
              {claiming ? "处理中…" : "把本机作品收进账号"}
            </button>
            {me.role === "admin" && (
              <Link className="linklike" href="/admin">
                开发者后台 →
              </Link>
            )}
          </>
        ) : (
          <>
            <span>
              你现在是<b>游客</b>：作品靠这台浏览器里的编辑钥匙认人，清缓存或换设备就找不回来了。
            </span>
            <Link className="btn small" href="/login?next=/mine" onClick={() => refreshMe()}>
              注册 / 登录，把作品绑到账号
            </Link>
          </>
        )}
      </div>
      {notice && <div className="notice" style={{ marginBottom: 16 }}>{notice}</div>}
      {lockedCount > 0 && (
        <div className="notice" style={{ marginBottom: 16 }}>
          这台浏览器上还有 {lockedCount} 部作品已经绑定到别的账号——作品一旦收进账号，
          编辑钥匙就不再单独生效了。登录那个账号才能看到和编辑它们。
        </div>
      )}
      {entries === null ? (
        <p style={{ color: "var(--muted)" }}>加载中…</p>
      ) : entries.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          {lockedCount > 0 ? (
            <>当前账号名下还没有作品。<Link href="/new">去创建一个</Link>，或登录上面提到的那个账号。</>
          ) : (
            <>这台浏览器上还没有任何作品的编辑钥匙。<Link href="/new">去创建一个</Link>，或在下方导入钥匙串。</>
          )}
        </p>
      ) : (
        <div className="game-grid">
          {entries.map((e) =>
            e.missing ? (
              <div className="game-card" key={e.id} style={{ opacity: 0.6 }}>
                <div className="game-card-body">
                  <div className="desc">
                    游戏 {e.id} 打不开了（可能已被删除，或钥匙失效）。
                  </div>
                  <div className="meta">
                    <button className="linklike" onClick={() => forget(e.id)}>
                      从本机移除这把钥匙
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="game-card" key={e.id}>
                <Link className="card-link" href={`/edit/${e.id}`}>
                  <GameCover
                    id={e.id}
                    title={e.title}
                    kind={e.kind}
                    preset={e.coverPreset}
                    coverUrl={e.hasCover ? `/api/games/${e.id}/cover?v=${encodeURIComponent(e.updatedAt)}` : undefined}
                  />
                  <div className="game-card-body">
                    <div className="meta">
                      <span className="tag">{KIND_CN[e.kind] ?? KIND_CN.unknown}</span>
                      <span className="tag">{e.published ? "已发布" : "草稿"}</span>
                      {e.updatedAt && <span>{e.updatedAt.slice(0, 10)}</span>}
                    </div>
                    <div className="meta" style={{ marginTop: 6 }} title="点赞 · 游玩次数 · 平均游玩时长">
                      <span className="stat-chip">♡ {e.likes ?? 0}</span>
                      <span className="stat-chip">▶ {e.plays ?? 0}</span>
                      <span className="stat-chip">⌀ {fmtDuration(e.avgPlaySeconds)}</span>
                    </div>
                  </div>
                </Link>
                <div className="game-card-body" style={{ paddingTop: 0 }}>
                  <div className="meta">
                    <Link className="tag" href={`/edit/${e.id}`}>
                      继续创作 →
                    </Link>
                    {e.published && (
                      <Link className="tag" href={`/g/${e.id}`}>
                        玩家页
                      </Link>
                    )}
                    <span style={{ flex: 1 }} />
                    <button className="linklike danger" title="删除这个作品（不可恢复）" onClick={() => remove(e)}>
                      删除
                    </button>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      )}

      <div className="form" style={{ marginTop: 32, maxWidth: 560 }}>
        <b>钥匙串备份</b>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          编辑钥匙只存在浏览器里——清缓存、换设备都会丢。导出成文件存好；在新设备上粘贴导入即可找回全部作品。
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn small secondary" onClick={exportKeyring}>
            导出钥匙串
          </button>
        </div>
        <textarea
          value={importText}
          placeholder='粘贴钥匙串 JSON（{"games":[{"id":"…","key":"…"}]}）'
          style={{ minHeight: 72 }}
          onChange={(e) => setImportText(e.target.value)}
        />
        <div>
          <button className="btn small secondary" disabled={!importText.trim()} onClick={importKeyring}>
            导入钥匙串
          </button>
        </div>
      </div>
    </div>
  );
}
