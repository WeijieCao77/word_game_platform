"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import GamePlayer from "@/components/GamePlayer";
import GameCover, { COVER_PRESET_LIST } from "@/components/GameCover";
import { GameConfig, ValidationIssue, validateGameConfig } from "@/lib/schema";
import { simulate, summarizeReport } from "@/lib/simulate";
import { parseCardStatus } from "@/lib/ai/designcard";
import { LIBRARY_CATEGORIES, LibraryEntry, insertLibraryCard, rankLibraryEntries, shareBlockReason } from "@/lib/library";

// 创作工作台：左边是 AI 驻场策划（主入口），右边是设计卡/配置/校验/预览。
// 预览用的就是玩家页的 GamePlayer 组件——编辑器与播放器同源。

type Tab = "preview" | "design" | "config" | "check" | "library" | "cover";

interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
}

// ---- 创作流程可视化：阶段条 + 职能徽章 ----

const ROLE_CLASS: Record<string, string> = { 主策: "lead", 剧情: "story", 人设: "chara", 数值: "num" };

/** 流程状态 → 阶段条展示（当前步 + 活跃职能 + 一句话说明） */
const STAGE_VIEW: Record<string, { step: number; roles: string[]; hint: string }> = {
  需求对齐中: { step: 0, roles: ["主策", "剧情", "人设"], hint: "创意策划阶段：聊清题材、角色与玩法方向" },
  方案待确认: { step: 1, roles: ["主策"], hint: "方案已就绪，等你拍板——同意后团队开始搭建" },
  已确认: { step: 2, roles: ["数值", "主策"], hint: "搭建阶段：生成配置、校验、模拟配平" },
  调优中: { step: 3, roles: ["数值", "剧情"], hint: "调优阶段：直接提修改意见，团队改完用模拟验证" },
};
const STAGE_STEPS = ["创意对齐", "方案确认", "搭建", "调优"];

/** 把 AI 消息按【职能】署名拆段，渲染成带徽章的段落 */
function AssistantMsg({ content }: { content: string }): React.ReactElement {
  const parts = content.split(/(?=【(?:主策|剧情|人设|数值)】)/g).filter((p) => p.trim());
  if (parts.length <= 1 && !/^【/.test(content.trim())) {
    return <div className="chat-msg assistant">{content}</div>;
  }
  return (
    <div className="chat-msg assistant">
      {parts.map((p, i) => {
        const m = p.match(/^【(主策|剧情|人设|数值)】\s*/);
        if (!m) return <div key={i}>{p}</div>;
        return (
          <div key={i} className="role-seg">
            <span className={`role-chip ${ROLE_CLASS[m[1]]}`}>{m[1]}</span>
            {p.slice(m[0].length)}
          </div>
        );
      })}
    </div>
  );
}

export default function EditPage({ params }: { params: Promise<{ id: string }> }): React.ReactElement {
  const { id } = use(params);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [configText, setConfigText] = useState("");
  const [designCard, setDesignCard] = useState("");
  const [published, setPublished] = useState(false);
  const [tab, setTab] = useState<Tab>("preview");
  const [dirty, setDirty] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [loadError, setLoadError] = useState("");
  const [simText, setSimText] = useState("");
  const [previewNonce, setPreviewNonce] = useState(0);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatSeconds, setChatSeconds] = useState(0);
  const [hasCover, setHasCover] = useState(false);
  const [assets, setAssets] = useState<{ name: string; contentType: string; size: number }[] | null>(null);
  const [assetName, setAssetName] = useState("");
  const [assetShare, setAssetShare] = useState(false);
  const [libAssets, setLibAssets] = useState<{ id: string; name: string; size: number; author: string }[] | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverVersion, setCoverVersion] = useState(0);
  const [libEntries, setLibEntries] = useState<LibraryEntry[] | null>(null);
  const [libCategory, setLibCategory] = useState("");
  const [libQ, setLibQ] = useState("");
  const [shareCardId, setShareCardId] = useState("");
  const [shareCategory, setShareCategory] = useState<string>(LIBRARY_CATEGORIES[0]);
  const [shareTags, setShareTags] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const loadLibrary = useCallback(async (category: string, q: string): Promise<void> => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (q) params.set("q", q);
    const res = await fetch(`/api/library?${params.toString()}`);
    const body = await res.json();
    setLibEntries(body.entries ?? []);
  }, []);

  useEffect(() => {
    if (!chatBusy) return;
    setChatSeconds(0);
    const t = setInterval(() => setChatSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [chatBusy]);

  useEffect(() => {
    setEditKey(localStorage.getItem(`wgp_key_${id}`));
  }, [id]);

  const load = useCallback(
    async (key: string): Promise<void> => {
      const res = await fetch(`/api/games/${id}`, { headers: { "x-edit-key": key } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "加载失败");
      if (!body.canEdit) throw new Error("编辑钥匙不正确");
      setConfig(body.config as GameConfig);
      setConfigText(JSON.stringify(body.config, null, 2));
      setDesignCard(body.designCard ?? "");
      setPublished(body.published);
      if (Array.isArray(body.chat)) setChat(body.chat as ChatMsg[]);
      setHasCover(!!body.hasCover);
      setDirty(false);
    },
    [id]
  );

  useEffect(() => {
    if (!editKey) return;
    load(editKey).catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [editKey, load]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat, chatBusy]);

  // 有未保存修改或 AI 正在工作时，关页面先确认
  useEffect(() => {
    if (!dirty && !chatBusy) return;
    const warn = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, chatBusy]);

  const issues: ValidationIssue[] = useMemo(() => {
    if (!config) return [];
    return validateGameConfig(config).issues;
  }, [config]);

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const cardStatus = parseCardStatus(designCard);

  // 内容库按当前作品题材排序：贴合的置顶并标出
  const rankedLib = useMemo(() => {
    if (!libEntries || !config) return null;
    return rankLibraryEntries(libEntries, config);
  }, [libEntries, config]);

  const exportConfig = useCallback((): void => {
    if (!config) return;
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${config.meta.title || "game"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg("配置已导出——你的作品永远属于你");
  }, [config]);

  const save = useCallback(async (override?: GameConfig): Promise<boolean> => {
    const payload = override ?? config;
    if (!payload || !editKey) return false;
    setStatusMsg("保存中…");
    try {
      const res = await fetch(`/api/games/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-edit-key": editKey },
        body: JSON.stringify({ config: payload, designCard }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "保存失败");
      setDirty(false);
      setStatusMsg("已保存 ✓");
      return true;
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [config, designCard, editKey, id]);

  const setPreset = useCallback(
    (presetId: string | undefined): void => {
      if (!config) return;
      const meta = { ...config.meta };
      if (presetId) meta.coverPreset = presetId;
      else delete meta.coverPreset;
      const next: GameConfig = { ...config, meta };
      setConfig(next);
      setConfigText(JSON.stringify(next, null, 2));
      void save(next);
    },
    [config, save]
  );

  const uploadCover = useCallback(
    async (file: File): Promise<void> => {
      if (!editKey) return;
      setCoverBusy(true);
      try {
        // 浏览器端裁剪压缩到 640×360 JPEG：上传永远不超限，服务端零图片依赖
        const img = new Image();
        const url = URL.createObjectURL(file);
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("图片读取失败"));
          img.src = url;
        });
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("浏览器不支持 canvas");
        const scale = Math.max(640 / img.width, 360 / img.height);
        ctx.drawImage(img, (640 - img.width * scale) / 2, (360 - img.height * scale) / 2, img.width * scale, img.height * scale);
        URL.revokeObjectURL(url);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
        if (!blob) throw new Error("图片编码失败");
        const res = await fetch(`/api/games/${id}/cover`, {
          method: "PUT",
          headers: { "content-type": "image/jpeg", "x-edit-key": editKey },
          body: blob,
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "上传失败");
        setHasCover(true);
        setCoverVersion((v) => v + 1);
        setStatusMsg("封面已更新 ✓");
      } catch (err) {
        setStatusMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setCoverBusy(false);
      }
    },
    [editKey, id]
  );

  const removeCover = useCallback(async (): Promise<void> => {
    if (!editKey) return;
    setCoverBusy(true);
    try {
      const res = await fetch(`/api/games/${id}/cover`, { method: "DELETE", headers: { "x-edit-key": editKey } });
      if (!res.ok) throw new Error((await res.json()).error ?? "移除失败");
      setHasCover(false);
      setCoverVersion((v) => v + 1);
      setStatusMsg("已移除自定义封面");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCoverBusy(false);
    }
  }, [editKey, id]);

  /** 设计卡「素材清单」自动维护：作者可查，AI 工作室也因此知道有哪些图可用 */
  const syncAssetSection = useCallback(
    (names: string[]): void => {
      const marker = "## 素材清单（自动维护）";
      const body =
        names.length === 0
          ? "（还没有上传素材）"
          : names.map((n) => `- ${n} —— 卡片 image 字段填 "${n}" 即可展示`).join("\n");
      const section = `${marker}\n${body}\n`;
      setDesignCard((prev) => {
        const idx = prev.indexOf(marker);
        let next: string;
        if (idx >= 0) {
          const after = prev.indexOf("\n## ", idx + marker.length);
          next = after >= 0 ? prev.slice(0, idx) + section + prev.slice(after + 1) : prev.slice(0, idx) + section;
        } else {
          next = prev.trimEnd() + "\n\n" + section;
        }
        void fetch(`/api/games/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json", "x-edit-key": editKey ?? "" },
          body: JSON.stringify({ designCard: next }),
        }).catch(() => undefined);
        return next;
      });
    },
    [editKey, id]
  );

  const loadAssets = useCallback(async (): Promise<void> => {
    if (!editKey) return;
    const res = await fetch(`/api/games/${id}/assets`, { headers: { "x-edit-key": editKey } });
    const body = await res.json();
    if (res.ok) setAssets(body.assets ?? []);
  }, [editKey, id]);

  const uploadAsset = useCallback(
    async (file: File): Promise<void> => {
      if (!editKey) return;
      const name = assetName.trim();
      if (!name) {
        setStatusMsg("先给素材起个名字（如 女主立绘、宗门大门）");
        return;
      }
      setCoverBusy(true);
      try {
        const img = new Image();
        const url = URL.createObjectURL(file);
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("图片读取失败"));
          img.src = url;
        });
        const scale = Math.min(1, 900 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx2 = canvas.getContext("2d");
        if (!ctx2) throw new Error("浏览器不支持 canvas");
        ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
        if (!blob) throw new Error("图片编码失败");
        const res = await fetch(
          `/api/games/${id}/assets/${encodeURIComponent(name)}${assetShare ? "?share=1" : ""}`,
          { method: "PUT", headers: { "content-type": "image/jpeg", "x-edit-key": editKey }, body: blob }
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "上传失败");
        setStatusMsg(`素材「${name}」已上传${assetShare ? "，并已分享到公共素材库" : ""} ✓`);
        setAssetName("");
        const list = [...(assets ?? []).filter((a) => a.name !== name), { name, contentType: "image/jpeg", size: blob.size }];
        setAssets(list);
        syncAssetSection(list.map((a) => a.name));
      } catch (err) {
        setStatusMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setCoverBusy(false);
      }
    },
    [assetName, assetShare, assets, editKey, id, syncAssetSection]
  );

  const deleteAsset = useCallback(
    async (name: string): Promise<void> => {
      if (!editKey || !window.confirm(`删除素材「${name}」？引用它的卡片将显示不出图。`)) return;
      const res = await fetch(`/api/games/${id}/assets/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: { "x-edit-key": editKey },
      });
      if (res.ok) {
        const list = (assets ?? []).filter((a) => a.name !== name);
        setAssets(list);
        syncAssetSection(list.map((a) => a.name));
        setStatusMsg(`已删除素材「${name}」`);
      }
    },
    [assets, editKey, id, syncAssetSection]
  );

  const importLibAsset = useCallback(
    async (libId: string, name: string): Promise<void> => {
      if (!editKey) return;
      try {
        const bytes = await (await fetch(`/api/library/assets/${encodeURIComponent(libId)}`)).blob();
        const res = await fetch(`/api/games/${id}/assets/${encodeURIComponent(name)}`, {
          method: "PUT",
          headers: { "content-type": bytes.type || "image/jpeg", "x-edit-key": editKey },
          body: bytes,
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "导入失败");
        setStatusMsg(`已从公共素材库导入「${name}」 ✓`);
        void loadAssets().then(() => {
          setAssets((cur) => {
            if (cur) syncAssetSection(cur.map((a) => a.name));
            return cur;
          });
        });
      } catch (err) {
        setStatusMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [editKey, id, loadAssets, syncAssetSection]
  );

  const rename = useCallback((): void => {
    if (!config) return;
    const t = window.prompt("给游戏起个名字：", config.meta.title)?.trim();
    if (!t || t === config.meta.title) return;
    const next: GameConfig = { ...config, meta: { ...config.meta, title: t.slice(0, 60) } };
    setConfig(next);
    setConfigText(JSON.stringify(next, null, 2));
    void save(next);
  }, [config, save]);

  const togglePublish = useCallback(async (): Promise<void> => {
    if (!editKey) return;
    if (!(await save())) return;
    const res = await fetch(`/api/games/${id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-edit-key": editKey },
      body: JSON.stringify({ published: !published }),
    });
    const body = await res.json();
    if (!res.ok) {
      setStatusMsg(body.error ?? "发布失败");
      return;
    }
    setPublished(body.published);
    setStatusMsg(body.published ? "已发布 ✓ 任何人都能通过链接游玩了" : "已取消发布");
  }, [editKey, id, published, save]);

  const applyConfigText = useCallback((): void => {
    try {
      const parsed = JSON.parse(configText);
      setConfig(parsed as GameConfig);
      setDirty(true);
      setPreviewNonce((n) => n + 1);
      setStatusMsg("配置已应用（未保存）");
    } catch (err) {
      setStatusMsg(`JSON 解析失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [configText]);

  const runSim = useCallback((): void => {
    if (!config) return;
    const check = validateGameConfig(config);
    if (!check.ok) {
      setSimText("配置存在错误，先修复再模拟。");
      return;
    }
    const report = simulate(check.config!, 200, Date.now() % 100000);
    setSimText(summarizeReport(report));
  }, [config]);

  const sendChat = useCallback(async (): Promise<void> => {
    const text = chatInput.trim();
    if (!text || chatBusy || !editKey) return;
    const nextChat: ChatMsg[] = [...chat, { role: "user", content: text }];
    setChat(nextChat);
    setChatInput("");
    setChatBusy(true);
    try {
      if (dirty) await save();
      const controller = new AbortController();
      const kill = setTimeout(() => controller.abort(), 300000);
      const res = await fetch(`/api/games/${id}/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-edit-key": editKey },
        body: JSON.stringify({ messages: nextChat.filter((m) => m.role !== "system") }),
        signal: controller.signal,
      }).finally(() => clearTimeout(kill));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "AI 请求失败");
      setChat((c) => [...c, { role: "assistant", content: body.reply ?? "（无回复）" }]);
      if (body.config) {
        setConfig(body.config as GameConfig);
        setConfigText(JSON.stringify(body.config, null, 2));
        setPreviewNonce((n) => n + 1);
        setDirty(false);
      }
      if (typeof body.designCard === "string") setDesignCard(body.designCard);
      if (body.quota) {
        setStatusMsg(`AI 今日已用 ${body.quota.requests} 次`);
      }
    } catch (err) {
      setChat((c) => [...c, { role: "system", content: `⚠ ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setChatBusy(false);
    }
  }, [chat, chatBusy, chatInput, dirty, editKey, id, save]);

  if (!editKey) {
    return (
      <div className="site">
        <header className="site-header">
          <div className="site-title">
            <Link href="/">字游 WordPlay</Link>
          </div>
        </header>
        <h1 style={{ fontSize: 22, marginBottom: 12 }}>需要编辑钥匙</h1>
        <p style={{ color: "var(--muted)", marginBottom: 16 }}>
          这台浏览器上没有该游戏的编辑钥匙。粘贴创建时获得的钥匙以继续。
        </p>
        <div className="form">
          <input type="text" value={keyInput} placeholder="编辑钥匙" onChange={(e) => setKeyInput(e.target.value)} />
          <button
            className="btn"
            onClick={() => {
              localStorage.setItem(`wgp_key_${id}`, keyInput.trim());
              setEditKey(keyInput.trim());
            }}
          >
            进入工作台
          </button>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="site">
        <p className="notice">{loadError}</p>
        <p style={{ marginTop: 16 }}>
          <button
            className="linklike"
            onClick={() => {
              localStorage.removeItem(`wgp_key_${id}`);
              setEditKey(null);
              setLoadError("");
            }}
          >
            重新输入编辑钥匙
          </button>
        </p>
      </div>
    );
  }

  if (!config) return <div className="site" style={{ color: "var(--muted)" }}>加载中…</div>;

  return (
    <div className="editor">
      <div className="editor-topbar">
        <Link href="/">← 字游</Link>
        <Link href="/mine" style={{ color: "var(--muted)", fontSize: 13 }}>
          我的创作
        </Link>
        <span className="title" title="点击改名" style={{ cursor: "pointer" }} onClick={rename}>
          {config.meta.title} ✎
        </span>
        <span className="tag" title="创作流程：需求对齐中 → 方案待确认 → 已确认 → 调优中">
          {cardStatus}
        </span>
        <span className="status">
          {dirty ? "有未保存修改 · " : ""}
          {errorCount > 0 ? `${errorCount} 个错误 · ` : ""}
          {statusMsg}
        </span>
        <button className="btn small secondary" onClick={exportConfig} title="下载完整游戏配置 JSON——作品可导出，不锁作者">
          导出
        </button>
        <button className={`btn small${dirty ? "" : " secondary"}`} onClick={() => void save()}>
          保存
        </button>
        <button className="btn small secondary" onClick={() => void togglePublish()}>
          {published ? "取消发布" : "发布"}
        </button>
        {published && (
          <Link className="btn small" href={`/g/${id}`} target="_blank">
            打开玩家页 ↗
          </Link>
        )}
      </div>

      <div className="editor-main">
        <div className="chat-pane">
          {(() => {
            const view = STAGE_VIEW[cardStatus] ?? STAGE_VIEW["需求对齐中"];
            return (
              <div className="chat-stagebar" title="创作流程：创意对齐 → 方案确认 → 搭建 → 调优">
                <div className="stage-steps">
                  {STAGE_STEPS.map((s, i) => (
                    <span key={s} className={`stage-step ${i === view.step ? "active" : i < view.step ? "done" : ""}`}>
                      {i < view.step ? "✓ " : ""}
                      {s}
                    </span>
                  ))}
                </div>
                <div className="stage-hint">
                  <span>正在服务：</span>
                  {view.roles.map((r) => (
                    <span key={r} className={`role-chip ${ROLE_CLASS[r]}`}>
                      {r}
                    </span>
                  ))}
                  <span className="stage-hint-text">{view.hint}</span>
                </div>
              </div>
            );
          })()}
          <div className="chat-log">
            {chat.length === 0 && (
              <div className="chat-msg assistant">
                这里是你的驻场游戏工作室——【主策】【剧情】【人设】【数值】四个职能为你服务，
                你是老板：出想法、提方向、拍板就行，专业的事我们补全。
                {"\n\n"}流程：先聊需求（题材基调、角色、玩法循环、结局）→ 我们给完整方案 →
                你点头后才动手搭建 → 一起试玩调优。聊定的共识都记在「设计卡」页签里。
                {"\n\n"}跟我们说说你想做什么——一个题材、一部小说的感觉、或者一个模糊的念头都行。
              </div>
            )}
            {chat.map((m, i) =>
              m.role === "assistant" ? (
                <AssistantMsg key={i} content={m.content} />
              ) : (
                <div key={i} className={`chat-msg ${m.role}`}>
                  {m.content}
                </div>
              )
            )}
            {chatBusy && (
              <div className="chat-msg system">
                AI 策划工作中… {chatSeconds}s{chatSeconds > 15 ? "（生成/修改配置通常要 30~120 秒，它可能正在跑校验和模拟）" : ""}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="chat-input">
            <textarea
              value={chatInput}
              placeholder="例：把这个游戏改成宗门经营题材，加一条叛徒线（Ctrl+Enter 发送）"
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void sendChat();
              }}
            />
            <button className="btn" disabled={chatBusy} onClick={() => void sendChat()}>
              发送
            </button>
          </div>
        </div>

        <div className="work-pane">
          <div className="tabs">
            {(
              [
                ["preview", "预览试玩"],
                ["design", "设计卡"],
                ["config", "配置"],
                ["check", `校验${errorCount > 0 ? ` (${errorCount})` : ""}`],
                ["library", "内容库"],
                ["cover", "封面·素材"],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                className={tab === t ? "active" : ""}
                onClick={() => {
                  setTab(t);
                  if (t === "library" && libEntries === null) void loadLibrary(libCategory, libQ);
                  if (t === "cover" && assets === null) void loadAssets();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === "preview" &&
              (errorCount === 0 ? (
                <div className="preview-frame">
                  <GamePlayer key={previewNonce} config={config} gameId={id} mode="preview" />
                </div>
              ) : (
                <div className="pane-note">配置存在 {errorCount} 个错误，修复后即可预览（见「校验」页）。</div>
              ))}
            {tab === "design" && (
              <textarea
                className="config-editor"
                value={designCard}
                placeholder={
                  "《游戏设计卡》——你和 AI 策划共同维护的设计共识。\n" +
                  "建议包含：题材与基调 / 核心变量 / 调度方式 / 卡池规划 / 结局设计。\n" +
                  "跟 AI 对话时它会读取并更新这里。"
                }
                onChange={(e) => {
                  setDesignCard(e.target.value);
                  setDirty(true);
                }}
              />
            )}
            {tab === "config" && (
              <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <div className="pane-note" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span>底层配置（JSON）。改完点「应用」生效，再「保存」入库。</span>
                  <button className="btn small secondary" onClick={applyConfigText}>
                    应用
                  </button>
                  <button
                    className="btn small secondary"
                    onClick={() => setConfigText(JSON.stringify(config, null, 2))}
                  >
                    还原为当前
                  </button>
                </div>
                <textarea
                  className="config-editor"
                  style={{ flex: 1 }}
                  value={configText}
                  onChange={(e) => setConfigText(e.target.value)}
                  spellCheck={false}
                />
              </div>
            )}
            {tab === "check" && (
              <div>
                <div className="pane-note" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span>
                    {errorCount > 0
                      ? `发现 ${errorCount} 个错误、${issues.length - errorCount} 个警告`
                      : issues.length > 0
                        ? `无错误，${issues.length} 个警告`
                        : "校验通过，没有发现问题 ✓"}
                  </span>
                  <button className="btn small secondary" onClick={runSim}>
                    模拟 200 局
                  </button>
                </div>
                <div className="issues">
                  {issues.map((issue, i) => (
                    <div key={i} className={`issue ${issue.severity}`}>
                      <div className="path">{issue.path}</div>
                      {issue.message}
                    </div>
                  ))}
                </div>
                {simText && <div className="sim-report">{simText}</div>}
              </div>
            )}
            {tab === "cover" && (
              <div>
                <div className="pane-note">
                  封面显示在游戏库、作者页与「我的创作」。上传自定义图片（自动裁剪为 16:9 并压缩），
                  或从素材库选一套主题样式；两者都没有时使用默认渐变。
                </div>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start", padding: "10px 0" }}>
                  <div style={{ width: 300 }}>
                    <GameCover
                      key={coverVersion}
                      id={id}
                      title={config.meta.title}
                      kind={config.driver.kind}
                      preset={config.meta.coverPreset}
                      coverUrl={hasCover ? `/api/games/${id}/cover?v=e${coverVersion}` : undefined}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <label className="btn small secondary" style={{ cursor: "pointer" }}>
                        {coverBusy ? "处理中…" : "上传图片"}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          disabled={coverBusy}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) void uploadCover(f);
                          }}
                        />
                      </label>
                      {hasCover && (
                        <button className="btn small secondary" disabled={coverBusy} onClick={() => void removeCover()}>
                          移除自定义封面
                        </button>
                      )}
                      {config.meta.coverPreset && (
                        <button className="btn small secondary" onClick={() => setPreset(undefined)}>
                          清除预设
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 320 }}>
                    <div className="pane-note" style={{ paddingTop: 0 }}>封面样式库（点击选用）</div>
                    <div className="preset-grid">
                      {COVER_PRESET_LIST.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`preset-tile ${config.meta.coverPreset === p.id ? "selected" : ""}`}
                          onClick={() => setPreset(p.id)}
                          title={p.label}
                        >
                          <GameCover id={`preset-${p.id}`} title={p.label.split("·")[1]?.trim() ?? p.label} kind="unknown" preset={p.id} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pane-note" style={{ borderTop: "1px solid var(--border)", marginTop: 6 }}>
                  <b>游戏内图片素材</b>（角色立绘、场景、宗门图……作者自己上传，卡片的 image 字段按名称引用；
                  上传后清单会自动记进设计卡，AI 工作室会建议放图位）
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      type="text"
                      value={assetName}
                      placeholder="素材名（如 女主立绘）"
                      maxLength={40}
                      style={{ padding: "5px 10px", width: 180 }}
                      onChange={(e) => setAssetName(e.target.value)}
                    />
                    <label className="btn small secondary" style={{ cursor: "pointer" }}>
                      {coverBusy ? "处理中…" : "选择图片上传"}
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        disabled={coverBusy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) void uploadAsset(f);
                        }}
                      />
                    </label>
                    <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
                      <input type="checkbox" checked={assetShare} onChange={(e) => setAssetShare(e.target.checked)} />
                      同时分享到公共素材库（其他创作者可复用）
                    </label>
                  </div>
                  <div className="asset-grid">
                    {assets === null && <span className="pane-note">加载中…</span>}
                    {assets?.length === 0 && <span className="pane-note">还没有素材。</span>}
                    {assets?.map((a) => (
                      <div key={a.name} className="asset-tile">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/games/${id}/assets/${encodeURIComponent(a.name)}?v=${a.size}`} alt={a.name} loading="lazy" />
                        <div className="asset-meta">
                          <span title={`卡片 image 字段填 "${a.name}"`}>{a.name}</span>
                          <button className="linklike danger" onClick={() => void deleteAsset(a.name)}>
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <button
                      className="btn small secondary"
                      onClick={() => {
                        void fetch("/api/library/assets")
                          .then((r) => r.json())
                          .then((b) => setLibAssets(b.assets ?? []));
                      }}
                    >
                      浏览公共素材库
                    </button>
                    {libAssets && (
                      <div className="asset-grid">
                        {libAssets.length === 0 && <span className="pane-note">公共素材库还是空的。</span>}
                        {libAssets.map((a) => (
                          <div key={a.id} className="asset-tile">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/library/assets/${encodeURIComponent(a.id)}`} alt={a.name} loading="lazy" />
                            <div className="asset-meta">
                              <span>
                                {a.name} <em style={{ opacity: 0.6 }}>by {a.author}</em>
                              </span>
                              <button className="linklike" onClick={() => void importLibAsset(a.id, a.name)}>
                                导入
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {tab === "library" && (
              <div>
                <div className="pane-note" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={libCategory}
                    onChange={(e) => {
                      setLibCategory(e.target.value);
                      void loadLibrary(e.target.value, libQ);
                    }}
                  >
                    <option value="">全部分类</option>
                    {LIBRARY_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={libQ}
                    placeholder="搜索标题/文案/标签"
                    style={{ flex: 1, minWidth: 120, padding: "4px 8px" }}
                    onChange={(e) => setLibQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void loadLibrary(libCategory, libQ);
                    }}
                  />
                  <button className="btn small secondary" onClick={() => void loadLibrary(libCategory, libQ)}>
                    搜索
                  </button>
                </div>
                <div className="issues">
                  {libEntries === null && <div className="pane-note">加载中…</div>}
                  {libEntries?.length === 0 && <div className="pane-note">没有匹配的内容。</div>}
                  {rankedLib?.map(({ entry, recommended }) => (
                    <div key={entry.id} className="lib-card">
                      <div className="lib-head">
                        <b>{entry.name}</b>
                        {recommended && (
                          <span className="tag" style={{ color: "var(--accent, #7cd67c)" }} title="标签/变量与当前作品题材贴合，排在前面">
                            贴合本作
                          </span>
                        )}
                        <span className="tag">{entry.category}</span>
                        {entry.tags.map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))}
                        <span className="lib-src">
                          {entry.source === "official" ? "官方" : entry.source === "ai" ? "AI" : entry.author}
                        </span>
                        <button
                          className="btn small"
                          onClick={() => {
                            if (!config) return;
                            const before = config.vars.length;
                            const { config: next, cardId } = insertLibraryCard(config, entry);
                            setConfig(next);
                            setConfigText(JSON.stringify(next, null, 2));
                            setDirty(true);
                            setPreviewNonce((n) => n + 1);
                            const added = next.vars.length - before;
                            setStatusMsg(`已插入「${cardId}」${added > 0 ? `，并补齐 ${added} 个变量` : ""}（未保存）`);
                          }}
                        >
                          插入
                        </button>
                      </div>
                      <div className="lib-preview">{entry.card.text.slice(0, 100)}</div>
                    </div>
                  ))}
                </div>
                <div className="pane-note" style={{ borderTop: "1px solid var(--border)", marginTop: 8 }}>
                  <b>分享本游戏的卡片到内容库</b>（仅限不依赖其他卡片/实体的独立卡）
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select value={shareCardId} onChange={(e) => setShareCardId(e.target.value)}>
                      <option value="">选择卡片…</option>
                      {config.cards
                        .filter((c) => !shareBlockReason(c))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title || c.id}
                          </option>
                        ))}
                    </select>
                    <select value={shareCategory} onChange={(e) => setShareCategory(e.target.value)}>
                      {LIBRARY_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={shareTags}
                      placeholder="标签，逗号分隔（如 修仙,抉择）"
                      style={{ padding: "4px 8px" }}
                      onChange={(e) => setShareTags(e.target.value)}
                    />
                    <button
                      className="btn small secondary"
                      disabled={!shareCardId}
                      onClick={() => {
                        void (async () => {
                          if (dirty) await save();
                          const res = await fetch("/api/library", {
                            method: "POST",
                            headers: { "content-type": "application/json", "x-edit-key": editKey ?? "" },
                            body: JSON.stringify({
                              gameId: id,
                              cardId: shareCardId,
                              category: shareCategory,
                              tags: shareTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
                            }),
                          });
                          const body = await res.json();
                          setStatusMsg(res.ok ? "已分享到内容库 ✓" : body.error ?? "分享失败");
                          if (res.ok) void loadLibrary(libCategory, libQ);
                        })();
                      }}
                    >
                      分享
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
