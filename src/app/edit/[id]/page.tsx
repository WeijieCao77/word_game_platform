"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Tour from "@/components/Tour";
import ChatPane, { QuotaInfo } from "@/components/editor/ChatPane";
import PreviewTab from "@/components/editor/tabs/PreviewTab";
import DesignTab from "@/components/editor/tabs/DesignTab";
import ConfigTab from "@/components/editor/tabs/ConfigTab";
import CheckTab from "@/components/editor/tabs/CheckTab";
import CoverTab from "@/components/editor/tabs/CoverTab";
import AssetsSection from "@/components/editor/tabs/AssetsSection";
import LibraryTab from "@/components/editor/tabs/LibraryTab";
import FilesTab, { FileItem } from "@/components/editor/tabs/FilesTab";
import SplitHandle, { useSplit } from "@/components/editor/SplitHandle";
import { buildTourSteps } from "@/components/editor/tourSteps";
import { compressAsset, compressCover, withAssetSection } from "@/components/editor/assets";
import { AssetItem, ChatMsg, LibAssetItem, Tab } from "@/components/editor/types";
import { GameConfig, ValidationIssue, validateGameConfig } from "@/lib/schema";
import { simulate, summarizeReport } from "@/lib/simulate";
import { parseCardStatus } from "@/lib/ai/designcard";
import { LIBRARY_CATEGORIES, LibraryEntry, insertLibraryCard, rankLibraryEntries } from "@/lib/library";

// 创作工作台：左边是 AI 驻场策划（主入口），右边是设计卡/配置/校验/预览。
// 预览用的就是玩家页的 GamePlayer 组件——编辑器与播放器同源。
//
// 这个文件只做编排：编辑钥匙、加载/保存/发布、AI 对话请求、页签状态，
// 再把数据与回调分发给 src/components/editor/ 下的各块界面。
// 改某块界面长什么样 → 去 editor/ 对应文件（左边对话区 ChatPane，右边六个页签在 tabs/）。

/** 新手引导看过一次就不再自动弹（顶栏「引导」可随时重看） */
const TOUR_KEY = "wgp_tour_edit_v1";

/** token 数看着舒服些：4321 → 4.3k，1000000 → 1M */
function kilo(n: number): string {
  if (n >= 1_000_000) return n % 1_000_000 === 0 ? `${n / 1_000_000}M` : `${(n / 1_000_000).toFixed(2)}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * 配额提示以 token 为主——真正先耗尽的通常是 token 而不是次数，
 * 让作者一眼看到「还剩多少」，次数放在后面做参考。
 */
function quotaText(q: QuotaInfo): string {
  if (q.unlimited) return `管理员 · 不限量（累计已用 ${kilo(q.used)} tokens）`;
  if (q.kind === "guest") {
    return (
      `游客额度：今日已用 ${kilo(q.used)}/${kilo(q.limit)} tokens，还剩 ${kilo(q.remaining)}` +
      `（零点重置；注册后一次拿一大笔，作品也不会因换设备而丢）`
    );
  }
  return `AI 额度：已用 ${kilo(q.used)}/${kilo(q.limit)} tokens，还剩 ${kilo(q.remaining)}`;
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
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [simText, setSimText] = useState("");
  const [previewNonce, setPreviewNonce] = useState(0);
  // 自由模式：作品形态与文件清单（快速模式下 files 一直是 null，页签也不出现）
  const [mode, setMode] = useState<"engine" | "code">("engine");
  const [files, setFiles] = useState<FileItem[] | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatSeconds, setChatSeconds] = useState(0);
  const [hasCover, setHasCover] = useState(false);
  const [assets, setAssets] = useState<AssetItem[] | null>(null);
  const [assetName, setAssetName] = useState("");
  // 默认分享到公共素材库（老板定的：共建素材池），创作者不想共享自己取消勾选
  const [assetShare, setAssetShare] = useState(true);
  const [libAssets, setLibAssets] = useState<LibAssetItem[] | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverVersion, setCoverVersion] = useState(0);
  const [libEntries, setLibEntries] = useState<LibraryEntry[] | null>(null);
  const [libCategory, setLibCategory] = useState("");
  const [libQ, setLibQ] = useState("");
  const [shareCardId, setShareCardId] = useState("");
  const [shareCategory, setShareCategory] = useState<string>(LIBRARY_CATEGORIES[0]);
  const [shareTags, setShareTags] = useState("");
  const [tourOpen, setTourOpen] = useState(false);
  const split = useSplit();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const reloadFiles = useCallback(async (): Promise<void> => {
    if (!editKey) return;
    try {
      const res = await fetch(`/api/games/${id}/files`, { headers: { "x-edit-key": editKey } });
      if (!res.ok) return;
      const body = await res.json();
      setFiles((body.files ?? []) as FileItem[]);
      if (body.mode === "code") setMode("code");
    } catch {
      // 清单取不到不影响别的事，静默
    }
  }, [editKey, id]);

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

  useEffect(() => {
    if (mode === "code" && files === null) void reloadFiles();
  }, [mode, files, reloadFiles]);

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
      setMode(body.mode === "code" ? "code" : "engine");
      setDirty(false);
      // 额度读数一进来就要有，不必等发完第一条消息
      try {
        const q = await fetch(`/api/games/${id}/assistant`, { headers: { "x-edit-key": key } });
        if (q.ok) setQuota((await q.json()).quota ?? null);
      } catch {
        // 额度读数取不到不影响创作，静默即可
      }
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
        const blob = await compressCover(file);
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
      setDesignCard((prev) => {
        const next = withAssetSection(prev, names);
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
        const blob = await compressAsset(file);
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

  const browseLibAssets = useCallback((): void => {
    void fetch("/api/library/assets")
      .then((r) => r.json())
      .then((b) => setLibAssets(b.assets ?? []));
  }, []);

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

  /** 切页签（含内容库/素材的懒加载）——页签栏和新手引导共用 */
  const openTab = useCallback(
    (t: Tab): void => {
      setTab(t);
      if (t === "library" && libEntries === null) void loadLibrary(libCategory, libQ);
      if (t === "cover" && assets === null) void loadAssets();
    },
    [assets, libCategory, libEntries, libQ, loadAssets, loadLibrary]
  );

  const tourSteps = useMemo(() => buildTourSteps(openTab), [openTab]);

  const configLoaded = config !== null;
  // 第一次进工作台自动开引导；看完或跳过后不再打扰
  useEffect(() => {
    if (!configLoaded) return;
    try {
      if (localStorage.getItem(TOUR_KEY)) return;
    } catch {
      return;
    }
    const t = setTimeout(() => setTourOpen(true), 500);
    return () => clearTimeout(t);
  }, [configLoaded]);

  const closeTour = useCallback((): void => {
    setTourOpen(false);
    try {
      localStorage.setItem(TOUR_KEY, "done");
    } catch {
      /* 隐私模式下不记也无妨 */
    }
  }, []);

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

  const revertConfigText = useCallback((): void => {
    setConfigText(JSON.stringify(config, null, 2));
  }, [config]);

  const editDesignCard = useCallback((value: string): void => {
    setDesignCard(value);
    setDirty(true);
  }, []);

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

  // ---- 内容库：筛选/搜索、插入到本作、把本作卡片分享出去 ----

  const changeLibCategory = useCallback(
    (category: string): void => {
      setLibCategory(category);
      void loadLibrary(category, libQ);
    },
    [libQ, loadLibrary]
  );

  const searchLibrary = useCallback((): void => {
    void loadLibrary(libCategory, libQ);
  }, [libCategory, libQ, loadLibrary]);

  const insertCard = useCallback(
    (entry: LibraryEntry): void => {
      if (!config) return;
      const before = config.vars.length;
      const { config: next, cardId } = insertLibraryCard(config, entry);
      setConfig(next);
      setConfigText(JSON.stringify(next, null, 2));
      setDirty(true);
      setPreviewNonce((n) => n + 1);
      const added = next.vars.length - before;
      setStatusMsg(`已插入「${cardId}」${added > 0 ? `，并补齐 ${added} 个变量` : ""}（未保存）`);
    },
    [config]
  );

  const shareCard = useCallback((): void => {
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
  }, [dirty, editKey, id, libCategory, libQ, loadLibrary, save, shareCardId, shareCategory, shareTags]);

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
      // 网关超时/请求体过大这类失败返回的是 HTML，不是 JSON——别让真正的原因被吞掉
      const rawText = await res.text();
      let body: {
        error?: string;
        reply?: string;
        config?: unknown;
        designCard?: string;
        quota?: QuotaInfo;
        filesChanged?: boolean;
        mode?: string;
      };
      try {
        body = JSON.parse(rawText);
      } catch {
        // 502/503/504 是网关把连接掐了，不是服务端拒绝——那一轮很可能还在跑、
        // 甚至已经跑完。别让作者以为自己那句话说错了。
        const gatewayDown = res.status === 502 || res.status === 503 || res.status === 504;
        throw new Error(
          res.ok
            ? `服务返回了无法解析的内容（HTTP ${res.status}）：${rawText.slice(0, 120)}`
            : gatewayDown
              ? `网关中断了这次请求（HTTP ${res.status}）。这一轮生成得久，连接先断了——服务端那边可能已经改完了，我这就去把最新的配置拉回来看看。`
              : `请求失败 HTTP ${res.status}：${rawText.replace(/<[^>]+>/g, " ").trim().slice(0, 160) || "网关未返回具体原因，多半是这一轮生成太大或耗时过长"}`
        );
      }
      if (!res.ok) throw new Error(body.error ?? `请求失败 HTTP ${res.status}`);
      setChat((c) => [...c, { role: "assistant", content: body.reply ?? "（无回复）" }]);
      if (body.config) {
        setConfig(body.config as GameConfig);
        setConfigText(JSON.stringify(body.config, null, 2));
        setPreviewNonce((n) => n + 1);
        setDirty(false);
      }
      if (typeof body.designCard === "string") setDesignCard(body.designCard);
      // AI 动过文件：把形态与清单同步过来，并让预览重挂载——
      // 「说生效却没看到变化」多半就是这里没刷
      if (body.mode === "code" || body.filesChanged) {
        setMode("code");
        void reloadFiles();
        setPreviewNonce((n) => n + 1);
      }
      if (body.quota) {
        setQuota(body.quota);
        setStatusMsg(quotaText(body.quota));
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      const msg = aborted
        ? "等待超过 5 分钟已自动中断。多半是这一轮要生成的东西太多了——把要求拆小一点（比如先建骨架，再分批补名单），或者让它先只改一部分。你的对话记录都还在。"
        : err instanceof Error
          ? err.message
          : String(err);
      setChat((c) => [...c, { role: "system", content: `⚠ ${msg}` }]);

      // 请求断了不等于活没干完。端到端实测里撞见过：网关回了 502
      // Application failed to respond，可服务端那一轮其实已经把配置写进库了——
      // 前端只是没收到回信。这种时候最坑的是「AI 说要搭，结果界面什么都没变」，
      // 作者会以为平台坏了。所以出错之后回头拉一次作品：真变了就把它接上来。
      try {
        const before = JSON.stringify(config);
        const res2 = await fetch(`/api/games/${id}`, { headers: { "x-edit-key": editKey } });
        if (res2.ok) {
          const fresh = await res2.json();
          const changed = JSON.stringify(fresh.config) !== before;
          if (typeof fresh.designCard === "string") setDesignCard(fresh.designCard);
          if (fresh.mode === "code") {
            setMode("code");
            void reloadFiles();
            setPreviewNonce((n) => n + 1);
          }
          if (changed) {
            setConfig(fresh.config as GameConfig);
            setConfigText(JSON.stringify(fresh.config, null, 2));
            setPreviewNonce((n) => n + 1);
            setDirty(false);
            setChat((c) => [
              ...c,
              {
                role: "system",
                content:
                  "不过服务端那一轮其实做完了——我把最新的配置拉回来了，预览已经刷新，你先看看改成什么样。" +
                  "要接着改就直接说，不用重发刚才那句。",
              },
            ]);
          }
        }
      } catch {
        // 连拉都拉不动，那就是真断了，上面那条报错已经说清楚了
      }
    } finally {
      setChatBusy(false);
    }
  }, [chat, chatBusy, chatInput, config, dirty, editKey, id, reloadFiles, save]);

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
        <button className="linklike" onClick={() => setTourOpen(true)} title="重看新手引导：每个板块是干嘛的">
          引导
        </button>
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

      <div className="editor-main" style={{ "--chat-w": `${split.pct}%` } as React.CSSProperties}>
        <ChatPane
          cardStatus={cardStatus}
          chat={chat}
          chatBusy={chatBusy}
          chatSeconds={chatSeconds}
          chatInput={chatInput}
          onChatInput={setChatInput}
          onSend={() => void sendChat()}
          chatEndRef={chatEndRef}
          quota={quota}
        />

        <SplitHandle pct={split.pct} dragging={split.dragging} onPointerDown={split.onPointerDown} onReset={split.reset} onNudge={split.nudge} />

        <div className="work-pane">
          <div className="tabs">
            {(
              (mode === "code"
                ? // 自由模式：游戏本体是文件，配置只剩 meta；
                  // 内容库（卡片复用）与校验（通用引擎的规则）在这里都用不上
                  [
                    ["preview", "预览试玩"],
                    ["files", `文件${files ? ` (${files.length})` : ""}`],
                    ["design", "设计卡"],
                    ["config", "配置"],
                    ["cover", "封面·素材"],
                  ]
                : [
                    ["preview", "预览试玩"],
                    ["design", "设计卡"],
                    ["config", "配置"],
                    ["check", `校验${errorCount > 0 ? ` (${errorCount})` : ""}`],
                    ["library", "内容库"],
                    ["cover", "封面·素材"],
                  ]) as [Tab, string][]
            ).map(([t, label]) => (
              <button key={t} data-tour={`tab-${t}`} className={tab === t ? "active" : ""} onClick={() => openTab(t)}>
                {label}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === "preview" && (
              <PreviewTab
                config={config}
                gameId={id}
                errorCount={errorCount}
                previewNonce={previewNonce}
                mode={mode}
                editKey={editKey ?? ""}
              />
            )}
            {tab === "files" && (
              <FilesTab
                gameId={id}
                editKey={editKey ?? ""}
                files={files}
                onReload={() => void reloadFiles()}
                onPreviewRefresh={() => setPreviewNonce((n) => n + 1)}
              />
            )}
            {tab === "design" && <DesignTab designCard={designCard} onChange={editDesignCard} />}
            {tab === "config" && (
              <ConfigTab
                configText={configText}
                onConfigText={setConfigText}
                onApply={applyConfigText}
                onRevert={revertConfigText}
              />
            )}
            {tab === "check" && (
              <CheckTab issues={issues} errorCount={errorCount} simText={simText} onRunSim={runSim} />
            )}
            {tab === "cover" && (
              <CoverTab
                gameId={id}
                config={config}
                hasCover={hasCover}
                coverBusy={coverBusy}
                coverVersion={coverVersion}
                onUploadCover={(f) => void uploadCover(f)}
                onRemoveCover={() => void removeCover()}
                onSetPreset={setPreset}
              >
                <AssetsSection
                  gameId={id}
                  assets={assets}
                  assetName={assetName}
                  assetShare={assetShare}
                  busy={coverBusy}
                  libAssets={libAssets}
                  onAssetName={setAssetName}
                  onAssetShare={setAssetShare}
                  onUploadAsset={(f) => void uploadAsset(f)}
                  onDeleteAsset={(name) => void deleteAsset(name)}
                  onBrowseLibAssets={browseLibAssets}
                  onImportLibAsset={(libId, name) => void importLibAsset(libId, name)}
                />
              </CoverTab>
            )}
            {tab === "library" && (
              <LibraryTab
                config={config}
                libCategory={libCategory}
                libQ={libQ}
                libEntries={libEntries}
                rankedLib={rankedLib}
                onCategoryChange={changeLibCategory}
                onQChange={setLibQ}
                onSearch={searchLibrary}
                onInsert={insertCard}
                shareCardId={shareCardId}
                shareCategory={shareCategory}
                shareTags={shareTags}
                onShareCardId={setShareCardId}
                onShareCategory={setShareCategory}
                onShareTags={setShareTags}
                onShare={shareCard}
              />
            )}
          </div>
        </div>
      </div>

      <Tour steps={tourSteps} open={tourOpen} onClose={closeTour} />
    </div>
  );
}
