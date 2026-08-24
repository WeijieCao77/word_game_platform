"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const TEMPLATES = [
  { id: "blank-sim", name: "空白 · 经营模拟", desc: "经理式：每回合主动决策 → 结算对抗 → 随机事件 → 赛季滚动" },
  { id: "blank-life", name: "空白 · 随机成长", desc: "人生重开式：时间推进 + 按条件与权重抽事件卡" },
  { id: "blank-story", name: "空白 · 分支叙事", desc: "橙光/Twine 式：选项跳转的分支故事" },
  { id: "demo-sim", name: "从示例出发 · 电竞经理 Lite", desc: "复制官方经营示例（阵容/训练/转会/联赛）改成你的版本" },
  { id: "demo-life", name: "从示例出发 · 修仙人生重开", desc: "复制官方修仙示例改成你的版本" },
  { id: "demo-story", name: "从示例出发 · 雨夜末班车", desc: "复制官方怪谈短篇改成你的版本" },
];

export default function NewGamePage(): React.ReactElement {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [template, setTemplate] = useState("blank-life");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async (): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, author, template }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "创建失败");
      localStorage.setItem(`wgp_key_${data.id}`, data.editKey);
      if (author) localStorage.setItem("wgp_author", author);
      router.push(`/edit/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="site">
      <header className="site-header">
        <div className="site-title">
          <Link href="/">字游 WordPlay</Link>
        </div>
      </header>
      <h1 style={{ fontSize: 24, marginBottom: 18 }}>创建新游戏</h1>
      <div className="form">
        <div>
          <label>游戏名（之后随时能改）</label>
          <input type="text" value={title} maxLength={60} placeholder="例如：我的宗门经营日记" onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label>作者名（展示在游戏页与作者主页）</label>
          <input type="text" value={author} maxLength={40} placeholder="你的笔名" onChange={(e) => setAuthor(e.target.value)} />
        </div>
        <div>
          <label>起点</label>
          {TEMPLATES.map((t) => (
            <div key={t.id} style={{ margin: "6px 0" }}>
              <label style={{ color: "inherit", fontSize: 14, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="template"
                  checked={template === t.id}
                  onChange={() => setTemplate(t.id)}
                  style={{ marginRight: 8 }}
                />
                <b>{t.name}</b>
                <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 13 }}>{t.desc}</span>
              </label>
            </div>
          ))}
        </div>
        {error && <div className="notice">{error}</div>}
        <div>
          <button className="btn" disabled={busy} onClick={() => void create()}>
            {busy ? "创建中…" : "创建并进入工作台 →"}
          </button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          创建后会得到一把编辑钥匙（保存在此浏览器）。当前版本没有账号系统——换设备编辑需要带上钥匙，别弄丢。
        </p>
      </div>
    </div>
  );
}
