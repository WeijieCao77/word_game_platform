"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";

// 登录 / 注册。注册完会顺手把这台浏览器上的游客作品认领进账号——
// 之前不登录做的东西不会白做。

function collectLocalKeys(): { id: string; editKey: string }[] {
  const out: { id: string; editKey: string }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("wgp_key_")) continue;
      const v = localStorage.getItem(k);
      if (v) out.push({ id: k.slice("wgp_key_".length), editKey: v });
    }
  } catch {
    // 隐私模式下拿不到就算了
  }
  return out;
}

function LoginForm(): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/mine";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const submit = useCallback(async (): Promise<void> => {
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "失败了，再试一次");
      // 把本机游客作品收进账号（无主的才会成功，别人的动不了）
      const keys = collectLocalKeys();
      let claimed = 0;
      if (keys.length > 0) {
        const cl = await fetch("/api/auth/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ keys }),
        })
          .then((r) => r.json())
          .catch(() => ({ claimed: 0 }));
        claimed = cl.claimed ?? 0;
      }
      const isAdmin = body.user?.role === "admin";
      setNote(
        `${mode === "register" ? "账号已创建" : "已登录"}${claimed > 0 ? `，本机 ${claimed} 部作品已收进账号` : ""}${
          isAdmin ? "；你是平台管理员" : ""
        }`
      );
      setTimeout(() => {
        router.push(next);
        router.refresh();
      }, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, mode, next, password, router, username]);

  return (
    <div className="site" style={{ maxWidth: 420 }}>
      <header className="site-header">
        <div className="site-title">
          <Link href="/">字游·WordPlay</Link>
        </div>
      </header>

      <div className="auth-tabs">
        <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
          登录
        </button>
        <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
          注册
        </button>
      </div>

      <p className="auth-hint">
        {mode === "register"
          ? "注册只为一件事：换设备、清缓存后还能找回你的作品。不注册也能创作和游玩。"
          : "登录后，你的作品跟着账号走，不再依赖这台浏览器里的编辑钥匙。"}
      </p>

      {error && <div className="notice" style={{ marginBottom: 12 }}>{error}</div>}
      {note && <div className="auth-note">{note}</div>}

      <div className="form">
        <label>
          用户名
          <input
            value={username}
            autoComplete="username"
            placeholder="2~20 个字符，中英文都行"
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            placeholder={mode === "register" ? "至少 8 位，别用纯数字" : "输入密码"}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </label>
        <button className="btn" disabled={busy || !username.trim() || !password} onClick={() => void submit()}>
          {busy ? "处理中…" : mode === "register" ? "创建账号" : "登录"}
        </button>
      </div>

      <p className="auth-foot">
        <Link href="/new">先不注册，直接开始创作 →</Link>
      </p>
      <p className="auth-foot" style={{ opacity: 0.7 }}>
        密码用 scrypt 加盐哈希保存，平台看不到你的明文口令；会话 cookie 是 httpOnly 的，页面脚本读不到。
      </p>
    </div>
  );
}

export default function LoginPage(): React.ReactElement {
  return (
    <Suspense fallback={<div className="site" style={{ color: "var(--muted)" }}>加载中…</div>}>
      <LoginForm />
    </Suspense>
  );
}
