"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import BrandMark from "@/components/BrandMark";

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
    <div className="auth-page">
      <Link className="auth-logo" href="/" aria-label="回到字游首页">
        <BrandMark size={44} />
      </Link>
      <h1 className="auth-title">{mode === "login" ? "登录字游 WordPlay" : "创建字游账号"}</h1>

      <div className="auth-card">
        {error && <div className="auth-error">{error}</div>}
        {note && <div className="auth-ok">{note}</div>}

        <div className="auth-field">
          <label htmlFor="auth-user">用户名</label>
          <input
            id="auth-user"
            value={username}
            autoComplete="username"
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          {mode === "register" && <p className="auth-help">2~20 个字符，中英文、数字、下划线、连字符</p>}
        </div>

        <div className="auth-field">
          <label htmlFor="auth-pw">密码</label>
          <input
            id="auth-pw"
            type="password"
            value={password}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          {mode === "register" && <p className="auth-help">至少 8 位，不能是纯数字。目前还没有找回密码功能，请记牢。</p>}
        </div>

        <button className="auth-submit" disabled={busy || !username.trim() || !password} onClick={() => void submit()}>
          {busy ? "处理中…" : mode === "register" ? "创建账号" : "登录"}
        </button>
      </div>

      <div className="auth-switch">
        {mode === "login" ? (
          <>
            还没有账号？
            <button className="linklike" onClick={() => { setMode("register"); setError(""); }}>
              注册一个
            </button>
          </>
        ) : (
          <>
            已经有账号了？
            <button className="linklike" onClick={() => { setMode("login"); setError(""); }}>
              去登录
            </button>
          </>
        )}
      </div>

      <div className="auth-guest">
        <Link href="/new">先不注册，直接开始创作 →</Link>
        <p>
          账号只解决一件事：换设备、清缓存后还能找回你的作品。
          不注册照样能创作、发布、游玩。
        </p>
      </div>

      <footer className="auth-legal">
        密码用 scrypt 加盐哈希保存，平台看不到你的明文口令；会话 cookie 是 httpOnly 的，页面脚本读不到。
      </footer>
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
