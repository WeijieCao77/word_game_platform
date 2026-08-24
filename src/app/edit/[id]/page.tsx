"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import GamePlayer from "@/components/GamePlayer";
import { GameConfig, ValidationIssue, validateGameConfig } from "@/lib/schema";
import { simulate, summarizeReport } from "@/lib/simulate";
import { parseCardStatus } from "@/lib/ai/designcard";

// 创作工作台：左边是 AI 驻场策划（主入口），右边是设计卡/配置/校验/预览。
// 预览用的就是玩家页的 GamePlayer 组件——编辑器与播放器同源。

type Tab = "preview" | "design" | "config" | "check";

interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
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
  const chatEndRef = useRef<HTMLDivElement>(null);

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

  const issues: ValidationIssue[] = useMemo(() => {
    if (!config) return [];
    return validateGameConfig(config).issues;
  }, [config]);

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const cardStatus = parseCardStatus(designCard);

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

  const save = useCallback(async (): Promise<boolean> => {
    if (!config || !editKey) return false;
    setStatusMsg("保存中…");
    try {
      const res = await fetch(`/api/games/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-edit-key": editKey },
        body: JSON.stringify({ config, designCard }),
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
        <span className="title">{config.meta.title}</span>
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
        <button className="btn small secondary" onClick={() => void save()}>
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
          <div className="chat-log">
            {chat.length === 0 && (
              <div className="chat-msg assistant">
                我是这个工作台的驻场策划。跟我说说你想做什么样的文字游戏——一个题材、
                一部小说的感觉、或者一个模糊的念头都行。
                {"\n\n"}我们的流程：先聊需求（世界观、玩法循环、你希望玩家每回合做什么、
                数值和结局）→ 我给出完整方案 → 你点头之后我才动手搭建 → 一起试玩调优。
                聊定的内容都会记在「设计卡」页签里。
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                {m.content}
              </div>
            ))}
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
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === "preview" &&
              (errorCount === 0 ? (
                <div className="preview-frame">
                  <GamePlayer key={previewNonce} config={config} mode="preview" />
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
          </div>
        </div>
      </div>
    </div>
  );
}
