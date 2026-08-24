"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import GameCover from "@/components/GameCover";

// 我的创作：扫描本机保存的编辑钥匙，列出这台浏览器创建/认领过的所有游戏——
// 草稿也能找回来，不再依赖记住 /edit/:id 链接。
// 当前版本没有账号系统，钥匙即身份：提供钥匙串备份/导入以支持换设备与清缓存自救。

const KIND_CN: Record<string, string> = { life: "随机成长", story: "分支叙事", sim: "经营模拟", unknown: "文字游戏" };

interface MineEntry {
  id: string;
  key: string;
  title: string;
  kind: string;
  published: boolean;
  updatedAt: string;
  missing?: boolean;
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
  const [entries, setEntries] = useState<MineEntry[] | null>(null);
  const [importText, setImportText] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (): Promise<void> => {
    const keys = localKeys();
    const results = await Promise.all(
      keys.map(async ({ id, key }): Promise<MineEntry> => {
        try {
          const res = await fetch(`/api/games/${id}`, { headers: { "x-edit-key": key } });
          if (!res.ok) return { id, key, title: id, kind: "unknown", published: false, updatedAt: "", missing: true };
          const body = await res.json();
          if (!body.canEdit) return { id, key, title: id, kind: "unknown", published: false, updatedAt: "", missing: true };
          return {
            id,
            key,
            title: body.config?.meta?.title ?? id,
            kind: body.config?.driver?.kind ?? "unknown",
            published: !!body.published,
            updatedAt: body.updatedAt ?? "",
          };
        } catch {
          return { id, key, title: id, kind: "unknown", published: false, updatedAt: "", missing: true };
        }
      })
    );
    results.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    setEntries(results);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  return (
    <div className="site">
      <header className="site-header">
        <div className="site-title">
          <Link href="/">字游 WordPlay</Link>
        </div>
        <Link className="btn small" href="/new">
          ＋ 开始创作
        </Link>
      </header>
      <h1 style={{ fontSize: 24, marginBottom: 6 }}>我的创作</h1>
      <p style={{ color: "var(--muted)", marginBottom: 20 }}>
        这台浏览器上有编辑钥匙的所有游戏——包括没发布的草稿。编辑钥匙保存在浏览器里，建议定期备份钥匙串。
      </p>
      {notice && <div className="notice" style={{ marginBottom: 16 }}>{notice}</div>}
      {entries === null ? (
        <p style={{ color: "var(--muted)" }}>加载中…</p>
      ) : entries.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          这台浏览器上还没有任何作品的编辑钥匙。<Link href="/new">去创建一个</Link>，或在下方导入钥匙串。
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
                  <GameCover id={e.id} title={e.title} kind={e.kind} />
                  <div className="game-card-body">
                    <div className="meta">
                      <span className="tag">{KIND_CN[e.kind] ?? KIND_CN.unknown}</span>
                      <span className="tag">{e.published ? "已发布" : "草稿"}</span>
                      {e.updatedAt && <span>{e.updatedAt.slice(0, 10)}</span>}
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
