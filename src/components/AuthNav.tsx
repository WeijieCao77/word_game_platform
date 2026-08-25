"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

// 顶栏右侧的账号状态。游客看到「登录/注册」，登录后看到用户名与退出。
// 注册是可选的——不登录一样能创作和游玩，账号解决的是换设备找回作品。

export interface MeUser {
  username: string;
  role: "user" | "admin";
}

export function useMe(): { me: MeUser | null; loading: boolean; refresh: () => void } {
  const [me, setMe] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    setLoading(true);
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((b) => setMe(b.user ?? null))
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(refresh, [refresh]);
  return { me, loading, refresh };
}

export default function AuthNav(): React.ReactElement {
  const { me, loading, refresh } = useMe();
  const pathname = usePathname();

  if (loading) return <span className="auth-nav" />;
  if (!me) {
    return (
      <span className="auth-nav">
        <Link className="topnav-link" href={`/login?next=${encodeURIComponent(pathname || "/")}`}>
          登录 / 注册
        </Link>
      </span>
    );
  }
  return (
    <span className="auth-nav">
      <Link className="topnav-link" href="/mine" title={me.role === "admin" ? "平台管理员" : "我的账号"}>
        {me.username}
        {me.role === "admin" && <span className="tag admin-tag">管理员</span>}
      </Link>
      <button
        className="linklike"
        onClick={() => {
          void fetch("/api/auth/logout", { method: "POST" }).then(() => refresh());
        }}
      >
        退出
      </button>
    </span>
  );
}
