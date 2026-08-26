"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// 平台有两条路，它们不是「11 个模板里的两个」，是两种做法。
// 之前把自由模式塞进一个 11 项的平铺列表当第 4 行——跟「从示例出发·修仙人生重开」
// 并排，看起来就是个模板，老板自己都没找到它。所以这里先让人选路，再选起点。
const TRACKS = [
  {
    id: "engine" as const,
    name: "快速模式",
    tagline: "聊完就能玩",
    desc: "你说想法，AI 写一份配置喂给平台的通用引擎。有三级校验和 600 局模拟兜底，做出来的东西不容易坏——代价是所有作品共用一套界面。",
    good: "适合：内容为主、玩法常规的作品（人生重开、分支叙事、常规经营）",
  },
  {
    id: "code" as const,
    name: "自由模式",
    tagline: "界面自己定",
    desc: "作品自带一整套网页文件，界面、布局、动效、玩法结构全由 AI 按你的要求写，跑在平台的沙箱里。想做几个专属界面就做几个。",
    good: "适合：界面本身就是卖点的作品（电竞经理、仿某个软件的界面、需要特殊面板）",
  },
];

const ENGINE_TEMPLATES = [
  { id: "blank-sim", name: "空白 · 经营模拟", desc: "经理式：每回合主动决策 → 结算对抗 → 随机事件 → 赛季滚动" },
  { id: "blank-life", name: "空白 · 随机成长", desc: "人生重开式：时间推进 + 按条件与权重抽事件卡" },
  { id: "blank-story", name: "空白 · 分支叙事", desc: "橙光/Twine 式：选项跳转的分支故事" },
  { id: "demo-sim", name: "从示例出发 · 无畏契约经理", desc: "复制官方经营示例（阵容/训练/转会/联赛）改成你的版本" },
  { id: "demo-life", name: "从示例出发 · 修仙人生重开", desc: "复制官方修仙示例改成你的版本" },
  { id: "demo-story", name: "从示例出发 · 雨夜末班车", desc: "复制官方怪谈示例改成你的版本" },
  { id: "demo-romance", name: "从示例出发 · 恋爱（女频）", desc: "复制官方女频恋爱示例（女主视角多线攻略）改成你的版本" },
  { id: "demo-romance-m", name: "从示例出发 · 恋爱（男频）", desc: "复制官方男频恋爱示例（男主视角成长+感情线）改成你的版本" },
  { id: "demo-manor", name: "从示例出发 · 雪夜山庄推理", desc: "复制官方本格推理示例（线索/指认）改成你的版本" },
  { id: "demo-coldcase", name: "从示例出发 · 都市悬案调查", desc: "复制官方社会派推理示例（走访/检索）改成你的版本" },
];

export default function NewGamePage(): React.ReactElement {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [track, setTrack] = useState<"engine" | "code">("engine");
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
        body: JSON.stringify({ title, author, template: track === "code" ? "blank-code" : template }),
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
        <Link className="btn small secondary" href="/mine">
          我的创作
        </Link>
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
          <label>怎么做这部作品</label>
          <div className="track-grid" style={{ marginTop: 8 }}>
            {TRACKS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`track ${track === t.id ? "selected" : ""}`}
                onClick={() => setTrack(t.id)}
              >
                <b>
                  {t.name}
                  <em>{t.tagline}</em>
                </b>
                <span>{t.desc}</span>
                <small>{t.good}</small>
              </button>
            ))}
          </div>
          <p className="pane-note" style={{ marginTop: 8 }}>
            拿不准就选快速模式——它有护栏。之后想换成自由模式，跟 AI 说一声就能切
            （切过去之后配置里的卡片不再生效，等于重做一遍，所以它会先问你确认）。
          </p>
        </div>
        {track === "engine" && (
          <div>
            <label>起点</label>
            <div className="tile-grid" style={{ marginTop: 8 }}>
              {ENGINE_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`tile ${template === t.id ? "selected" : ""}`}
                  onClick={() => setTemplate(t.id)}
                >
                  <b>{t.name}</b>
                  <span>{t.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {track === "code" && (
          <div className="pane-note">
            自由模式没有模板可挑——建好之后是一张起手骨架（index.html / style.css / game.js
            三个文件已经拆好），你跟 AI 说想要什么，它往上写。作品有几百个角色、几十支队伍
            这类大表，可以在工作台的「文件」页签直接<b>上传 CSV</b>，不用让 AI 一条条编。
          </div>
        )}
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
