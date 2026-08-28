"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Tour from "@/components/Tour";
import ChatPane, { QuotaInfo } from "@/components/editor/ChatPane";
import PreviewTab from "@/components/editor/tabs/PreviewTab";
import DesignTab from "@/components/editor/tabs/DesignTab";
import ConfigTab from "@/components/editor/tabs/ConfigTab";
import CheckTab from "@/components/editor/tabs/CheckTab";
import PlayCheckTab from "@/components/editor/tabs/PlayCheckTab";
import { GateIssue } from "@/lib/publish-gate";
import CoverTab from "@/components/editor/tabs/CoverTab";
import AssetsSection from "@/components/editor/tabs/AssetsSection";
import LibraryTab from "@/components/editor/tabs/LibraryTab";
import FilesTab, { FileItem } from "@/components/editor/tabs/FilesTab";
import SplitHandle, { useSplit } from "@/components/editor/SplitHandle";
import { buildTourSteps } from "@/components/editor/tourSteps";
import { compressAsset, compressCover, withAssetSection } from "@/components/editor/assets";
import { AssetItem, ChatMsg, LibAssetItem, Tab } from "@/components/editor/types";
import { runPlayCheck } from "@/components/playcheck-run";
import { PlayCheckReport } from "@/lib/playcheck/types";
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
  return `${q.flagship ? "旗舰位额度" : "AI 额度"}：已用 ${kilo(q.used)}/${kilo(q.limit)} tokens，还剩 ${kilo(q.remaining)}`;
}

export default function EditPage({ params }: { params: Promise<{ id: string }> }): React.ReactElement {
  const { id } = use(params);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [configText, setConfigText] = useState("");
  const [designCard, setDesignCard] = useState("");
  // 「发布」原来是一个开关管三件事，现在是三件事：
  //   published    链接可达（拿到链接能不能玩）
  //   listed       公开挂牌（游戏库里列不列出来）
  //   drift        草稿比线上多改了几个文件（自由模式；>0 就该发新版本了）
  const [published, setPublished] = useState(false);
  const [listed, setListed] = useState(false);
  const [drift, setDrift] = useState(0);
  const [tab, setTab] = useState<Tab>("preview");
  // 试玩体检：平台开一个看不见的沙箱 iframe 真去点一遍（见 @/components/playcheck-run）。
  // 「点了没反应」这类问题一个异常都不抛，前面所有护栏都照不到——
  // 老板那三次投诉（名字没地方填、一排点不了、点了就卡）全在这个盲区里。
  const [checkReport, setCheckReport] = useState<PlayCheckReport | null>(null);
  const [checkSummary, setCheckSummary] = useState("");
  const [checkErr, setCheckErr] = useState("");
  const [checking, setChecking] = useState(false);
  // AI 挂号要体检时，这一页替它跑。用 ref 而不是 state：轮询每 2 秒一次，
  // 用 state 挡重入会因为闭包拿到旧值而重复触发。
  const checkingRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  // 发布被门槛拦下来时那几条。摆在「体检」页签里——作者找「为什么发不了」
  // 第一个会去的就是那儿，而且拦住它的多半就是体检那一层。
  const [gateIssues, setGateIssues] = useState<GateIssue[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [simText, setSimText] = useState("");
  const [previewNonce, setPreviewNonce] = useState(0);
  // 自由模式：作品形态与文件清单（快速模式下 files 一直是 null，页签也不出现）
  const [mode, setMode] = useState<"engine" | "code">("engine");
  // 一轮跑完时要判断当前形态，可闭包里的 state 是那一轮开始时的旧值——用 ref 接住
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [files, setFiles] = useState<FileItem[] | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatSeconds, setChatSeconds] = useState(0);
  /** 后台那一轮干到哪一步了（异步模式下服务端报上来的一句话） */
  const [jobNote, setJobNote] = useState("");
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

  // 打开工作台就把这部作品收进账号（登录着才有效，没登录会被 401 挡掉）。
  //
  // 老板定的规矩：登录状态下的作品直接归账号；游客做到一半才注册的，
  // 得把本机的作品收录进去。原来这一步只在 /mine 上有个按钮——
  // **漏点一次，换设备就什么都找不回来，而且没有任何提示**。
  // 作者真正待着的地方是工作台，所以在这儿也补一次。
  // 安全：服务端只认领当前无主的作品，且必须出示正确的编辑钥匙。
  useEffect(() => {
    if (!editKey) return;
    void fetch("/api/auth/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: [{ id, editKey }] }),
    }).catch(() => null);
  }, [id, editKey]);

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
      setListed(!!body.listed);
      setDrift(Number(body.unpublishedFiles) || 0);
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

  /**
   * 发布这件事拆成了三件，这里是共用的那一次请求。
   *
   * 原来只有一个开关，写着「发布 / 取消发布」。作品一旦发布，作者再改就
   * **没有任何按钮能把改动推给玩家**——那个按钮这时候写着「取消发布」。
   * 要上线只能先取消（链接当场对所有人 403，链接立刻死掉）再点发布，
   * 中间一段真空，而且界面上没有任何地方提示要这么做。
   */
  const doPublish = useCallback(
    async (
      what: { publishVersion?: boolean; linkOpen?: boolean; listed?: boolean },
      okMsg: (b: { published: boolean; listed: boolean; version: number }) => string
    ): Promise<void> => {
      if (!editKey) return;
      if (!(await save())) return;
      const res = await fetch(`/api/games/${id}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-edit-key": editKey },
        body: JSON.stringify(what),
      });
      const body = await res.json();
      if (!res.ok) {
        // 自由模式的发布门槛会回一串结构化的问题。顶栏那条状态只有一行，
        // 塞不下——所以只在那儿说一句话，详情摆进「体检」页签，并且切过去。
        const list = Array.isArray(body.issues) && body.gate === "code" ? (body.issues as GateIssue[]) : [];
        setGateIssues(list);
        if (list.length) {
          const n = list.filter((i) => i.level === "error").length;
          setStatusMsg(`发不了：${n} 处得先修，详情在「体检」页签`);
          setTab("playcheck");
        } else {
          setStatusMsg(String(body.error ?? "发布失败").split("\n")[0]);
        }
        return;
      }
      setGateIssues([]);
      setPublished(!!body.published);
      setListed(!!body.listed);
      if (what.publishVersion) setDrift(0);
      setStatusMsg(okMsg(body));
    },
    [editKey, id, save]
  );

  /** ① 发新版本：把当前草稿打成快照推给玩家。**随时可点** */
  const publishVersion = useCallback(
    () => doPublish({ publishVersion: true }, (b) => `第 ${b.version} 版已推给玩家 ✓`),
    [doPublish]
  );

  /** ② 链接可达：拿到链接的人能不能玩 */
  const toggleLink = useCallback(
    () =>
      doPublish({ linkOpen: !published }, (b) =>
        b.published ? "链接已打开 ✓ 拿到链接就能玩" : "链接已关闭，只有你自己打得开"
      ),
    [doPublish, published]
  );

  /** ③ 公开挂牌：在游戏库里列不列出来。**关掉它不会弄死链接** */
  const toggleListed = useCallback(
    () =>
      doPublish({ listed: !listed }, (b) =>
        b.listed ? "已挂上公开游戏库 ✓" : "已从公开库撤下（链接照旧能玩）"
      ),
    [doPublish, listed]
  );

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

  /**
   * 跑一次试玩体检。
   *
   * 平台开一个屏幕外的沙箱 iframe，把作品从开局点一遍：走得下去吗、
   * 导航点得动吗、切过去那一页有没有真东西。结果存进服务端，
   * **下一轮 AI 的上下文里就会出现【试玩体检】**——这才是它的主要用途：
   * 以前这类问题一个异常都不抛，AI 每轮拿到的都是「没有报错记录」，
   * 于是连着四轮修不动一个开局。
   */
  const runCheckNow = useCallback(async (): Promise<void> => {
    if (!editKey || checking) return;
    setChecking(true);
    setCheckErr("");
    const r = await runPlayCheck(id, editKey);
    setChecking(false);
    if (r.error) {
      setCheckErr(r.error);
      setStatusMsg(`试玩体检没跑成：${r.error}`);
      return;
    }
    setCheckReport(r.report);
    setCheckSummary(r.summary);
    setStatusMsg(`试玩体检：${r.summary}`);
  }, [editKey, id, checking]);

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

  /**
   * 发一句给 AI。
   *
   * rounds > 1 = **连续搭建**：服务端一轮接一轮地跑，中间替作者说「接着做」。
   * 差距的大头是「没跑够」——靠人一句句催，一次坐下最多几轮，
   * 而一部一万三千行的作品要三四十轮。
   */
  // ask 是「不经过输入框直接说一句」——预览报错时的「让 AI 去修」走的就是这条路，
  // 作者不用自己去抄那段报错原文（老板的原话：我不要自己去手动做操作）
  const sendChat = useCallback(async (rounds = 1, ask?: string): Promise<void> => {
    const text = (ask ?? chatInput).trim() || (rounds > 1 ? "接着做，照剩余清单往下搭。" : "");
    if (!text || chatBusy || !editKey) return;
    const nextChat: ChatMsg[] = [...chat, { role: "user", content: text }];
    setChat(nextChat);
    setChatInput("");
    setChatBusy(true);
    // 网关把连接掐断（502/503/504）时置位：断的是连接不是活，服务端那一轮多半还在跑
    let gatewayCut = false;
    try {
      if (dirty) await save();
      const controller = new AbortController();
      const kill = setTimeout(() => controller.abort(), 300000);
      // 异步模式：请求立刻回一个任务号，活在后台跑，这里轮询要结果。
      // 同步那条路一轮必须在网关的耐心之内跑完（240 秒），最重的那一轮必然 502；
      // 异步之后连接断了也不影响后台，刷新页面还能接回来。
      const res = await fetch(`/api/games/${id}/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-edit-key": editKey },
        body: JSON.stringify({ messages: nextChat.filter((m) => m.role !== "system"), async: true, rounds }),
        signal: controller.signal,
      }).finally(() => clearTimeout(kill));
      // 网关超时/请求体过大这类失败返回的是 HTML，不是 JSON——别让真正的原因被吞掉
      const rawText = await res.text();
      let body: {
        error?: string;
        jobId?: string;
        job?: { status?: string; note?: string; error?: string };
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
        gatewayCut = res.status === 502 || res.status === 503 || res.status === 504;
        throw new Error(
          res.ok
            ? `服务返回了无法解析的内容（HTTP ${res.status}）：${rawText.slice(0, 120)}`
            : gatewayCut
              ? `网关中断了这次请求（HTTP ${res.status}）。这一轮生成得久，连接先断了——服务端多半还在跑，我每隔几秒去看一眼，跑完就把回复捞回来。先别重发。`
              : `请求失败 HTTP ${res.status}：${rawText.replace(/<[^>]+>/g, " ").trim().slice(0, 160) || "网关未返回具体原因，多半是这一轮生成太大或耗时过长"}`
        );
      }
      // 409 + jobId = 上一轮还在跑。**接上去看它的结果**，而不是把作者顶回来。
      // 顶回来是最糟的处理：作者不知道那一轮跑到哪了，只知道自己发什么都失败，
      // 于是「我改不了了」。接上去至少能看着它跑完，跑完再重发这一句。
      let resendHint = false;
      if (res.status === 409 && body.jobId) {
        resendHint = true;
        setChat((c) => [
          ...c,
          { role: "system", content: "⚠ 上一轮还在跑，先接着看它的结果。它一跑完，你刚才那句话再发一次就行。" },
        ]);
      } else if (!res.ok) {
        throw new Error(body.error ?? `请求失败 HTTP ${res.status}`);
      }
      // 202 + jobId = 后台开跑了，接下来靠轮询。轮询本身很轻（一条 SQL），所以 2 秒一次。
      // 上限跟着轮数走：连续搭 20 轮可能跑几个小时，按 1200 次（40 分钟）掐掉，
      // 页面会误报「跑了太久」而后台其实还在好好地搭。
      if (body.jobId) {
        const jobId = body.jobId;
        const maxPolls = 1200 * Math.max(1, rounds);
        let done: typeof body | null = null;
        for (let i = 0; i < maxPolls && !done; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const p = await fetch(`/api/games/${id}/assistant?job=${encodeURIComponent(jobId)}`, {
            headers: { "x-edit-key": editKey },
          }).catch(() => null);
          if (!p || !p.ok) continue; // 网络抖一下不该让这一轮白跑
          const pb = await p.json();
          // AI 在这一轮里要一份体检：它跑在服务端，开不了浏览器，
          // 而这一页正开着——就由这一页去跑，跑完 POST 回去，
          // 服务端那一轮当场接着往下走。这就是「写完能自己验」的那条线。
          if (pb.checkWanted && !checkingRef.current) {
            checkingRef.current = true;
            void runPlayCheck(id, editKey)
              .catch(() => null)
              .finally(() => {
                checkingRef.current = false;
              });
          }
          if (pb.job?.status === "done") done = pb;
          else if (pb.job?.status === "error") throw new Error(pb.job.error || "这一轮失败了");
          else if (pb.job?.note) setJobNote(pb.job.note);
        }
        setJobNote("");
        if (!done) throw new Error("这一轮跑了太久还没结束。刷新页面看看结果——服务端是改一次存一次的，做完的部分不会丢。");
        body = done;
      }
      setChat((c) => [
        ...c,
        { role: "assistant", content: body.reply ?? "（无回复）" },
        ...(resendHint
          ? [{ role: "system" as const, content: "✓ 上一轮跑完了。现在可以把你刚才那句话再发一次。" }]
          : []),
      ]);
      if (body.config) {
        setConfig(body.config as GameConfig);
        setConfigText(JSON.stringify(body.config, null, 2));
        setPreviewNonce((n) => n + 1);
        setDirty(false);
      }
      if (typeof body.designCard === "string") setDesignCard(body.designCard);
      // 形态可能被这一轮切走（两个方向都可能：写文件切到自由，创作者点头切回快速）。
      // 服务端报的 mode 是这一轮之后的真实形态，以它为准，别只认「切到 code」那一半——
      // 回切之后页签还停在自由模式，作者会以为没切成功。
      if (body.mode === "code" || body.mode === "engine") setMode(body.mode);
      if (body.mode === "code" || body.filesChanged) {
        void reloadFiles();
      }
      if (body.mode || body.filesChanged) setPreviewNonce((n) => n + 1);
      if (body.quota) {
        setQuota(body.quota);
        setStatusMsg(quotaText(body.quota));
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      // 「断的是连接，不是活」的三种情况：客户端 5 分钟超时、网关掐断、网络层失败。
      // 服务端是改一次存一次、整轮跑完把回复落库的——这三种都值得回头把活捞回来。
      const recoverable = aborted || gatewayCut || err instanceof TypeError;
      const msg = aborted
        ? "等待超过 5 分钟已自动中断。多半是这一轮要生成的东西太多了。我每隔几秒去服务端看一眼有没有跑完——先别重发。"
        : err instanceof TypeError
          ? `网络断了一下（${err.message}）。服务端那一轮可能还在跑——我每隔几秒去看一眼，跑完就把回复捞回来，先别重发。`
          : err instanceof Error
            ? err.message
            : String(err);
      setChat((c) => [...c, { role: "system", content: `⚠ ${msg}` }]);

      // 轻量根治「502 之后作者对着报错干瞪眼」：回复和聊天记录都在服务端
      // （整轮跑完时把「你这句 + AI 回复」一起落库），所以每隔几秒拉一次，
      // 看到自己这句话后面跟着回复，就说明那一轮跑完了——整份接上，别让作者重发白烧额度。
      let recovered = false;
      if (recoverable && editKey) {
        for (let i = 0; i < 22 && !recovered; i++) {
          await new Promise((r) => setTimeout(r, 8000));
          try {
            const poll = await fetch(`/api/games/${id}`, { headers: { "x-edit-key": editKey } });
            if (!poll.ok) continue;
            const fresh = await poll.json();
            const sc = (Array.isArray(fresh.chat) ? fresh.chat : []) as ChatMsg[];
            const at = sc.map((m) => (m.role === "user" ? m.content : "")).lastIndexOf(text);
            if (at < 0 || !sc.slice(at + 1).some((m) => m.role === "assistant")) continue;
            recovered = true;
            setChat([
              ...sc,
              {
                role: "system",
                content: "✓ 捞回来了——刚才只是连接断了，这一轮的活没丢。接着说下一句就行，不用重发。",
              },
            ]);
            if (fresh.config) {
              setConfig(fresh.config as GameConfig);
              setConfigText(JSON.stringify(fresh.config, null, 2));
              setDirty(false);
            }
            if (typeof fresh.designCard === "string") setDesignCard(fresh.designCard);
            if (fresh.mode === "code") {
              setMode("code");
              void reloadFiles();
            }
            setPreviewNonce((n) => n + 1);
            try {
              const q = await fetch(`/api/games/${id}/assistant`, { headers: { "x-edit-key": editKey } });
              if (q.ok) setQuota((await q.json()).quota ?? null);
            } catch {
              // 额度读数拉不到不碍事
            }
          } catch {
            // 单次拉取失败不退出——网关抖动正是这条通道存在的原因
          }
        }
        if (!recovered) {
          setChat((c) => [
            ...c,
            {
              role: "system",
              content:
                "等了几分钟还是没看到那一轮的结果，它可能真的失败了。刷新页面再看一眼聊天记录，还没有的话把刚才那句重发一次。",
            },
          ]);
        }
      }

      // 请求断了不等于活没干完。端到端实测里撞见过：网关回了 502
      // Application failed to respond，可服务端那一轮其实已经把配置写进库了——
      // 前端只是没收到回信。这种时候最坑的是「AI 说要搭，结果界面什么都没变」，
      // 作者会以为平台坏了。所以出错之后回头拉一次作品：真变了就把它接上来。
      if (!recovered) try {
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
      setJobNote("");
      // 每轮干完自动体检一次。**这一步是给 AI 跑的，不是给作者跑的**：
      // 结果存进服务端后会自动出现在下一轮的【试玩体检】里。
      // 指望作者记得点是靠不住的，而不跑的话 AI 下一轮又是个瞎子。
      if (modeRef.current === "code") void runCheckNow();
    }
  }, [chat, chatBusy, chatInput, config, dirty, editKey, id, reloadFiles, save, runCheckNow]);

  // 连续搭建的轮数。10 轮是个有依据的默认：实测最好的一次就是 12 轮到 4,500 行。
  const [autoRounds, setAutoRounds] = useState(10);

  /**
   * 放弃当前这一轮。
   *
   * 后台那个 Promise 拦不住，但**锁要立刻放开**——不然作者只能干等心跳超时，
   * 期间发什么都被顶回来。这是那句「我改不了了」的出口。
   */
  const abandonRound = useCallback(async () => {
    if (!editKey) return;
    await fetch(`/api/games/${id}/assistant`, {
      method: "DELETE",
      headers: { "x-edit-key": editKey },
    }).catch(() => null);
    setJobNote("");
    setChatBusy(false);
    setChat((c) => [...c, { role: "system", content: "已放弃这一轮。已经写进去的部分不会丢，接着说下一句就行。" }]);
  }, [editKey, id]);

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
        {/* 游客做到一半想注册却找不到入口——额度条上写着「注册后额度大得多」，
            可整个工作台一个登录入口都没有。next 带上当前作品，登录后原地回来，
            本机的作品也会被自动收进账号（登录页会拿本地钥匙去认领）。 */}
        {quota?.kind === "guest" && (
          <Link
            className="btn small"
            href={`/login?next=${encodeURIComponent(`/edit/${id}`)}`}
            title="注册或登录：额度大得多，作品也不会因为换设备而丢"
          >
            注册 / 登录
          </Link>
        )}
        <button className="linklike" onClick={() => setTourOpen(true)} title="重看新手引导：每个板块是干嘛的">
          引导
        </button>
        <button className="btn small secondary" onClick={exportConfig} title="下载完整游戏配置 JSON——作品可导出，不锁作者">
          导出
        </button>
        <button className={`btn small${dirty ? "" : " secondary"}`} onClick={() => void save()}>
          保存
        </button>
        {/* 发布是三件事，不是一个开关。挤在一起的代价见 publish/route.ts 顶上那段。 */}
        <button
          className={`btn small${drift > 0 || !published ? "" : " secondary"}`}
          onClick={() => void publishVersion()}
          title="把当前草稿打成快照推给玩家。随时可点——改一轮就发一轮"
        >
          发新版本{drift > 0 ? `（${drift} 个文件没发）` : ""}
        </button>
        <button
          className="btn small secondary"
          onClick={() => void toggleLink()}
          title="拿到链接的人能不能玩。跟挂不挂公开库是两件事"
        >
          链接：{published ? "开" : "关"}
        </button>
        <button
          className="btn small secondary"
          onClick={() => void toggleListed()}
          title="在公开游戏库里列不列出来。关掉它不会弄死链接"
        >
          公开库：{listed ? "挂着" : "没挂"}
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
          jobNote={jobNote}
          onAbandon={abandonRound}
          loginHref={`/login?next=${encodeURIComponent(`/edit/${id}`)}`}
          chatInput={chatInput}
          onChatInput={setChatInput}
          onSend={() => void sendChat()}
          autoRounds={autoRounds}
          onAutoRounds={setAutoRounds}
          onAutoBuild={() => void sendChat(autoRounds)}
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
                    // 自由模式的「校验」：通用引擎那套规则在这儿用不上，
                    // 能量的是「真去点一遍走不走得通」——外加运行报错。
                    ["playcheck", `体检${checking ? " …" : ""}`],
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
                onFixError={(m) => void sendChat(1, m)}
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
            {tab === "playcheck" && (
              <PlayCheckTab
                gameId={id}
                editKey={editKey}
                report={checkReport}
                summary={checkSummary}
                checking={checking}
                error={checkErr}
                gateIssues={gateIssues}
                onRun={() => void runCheckNow()}
                onFix={(msg) => {
                  setChatInput(msg);
                  setStatusMsg("体检结论已经放进对话框，点发送就行");
                }}
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
