import { GameConfig, GameConfigSchema, validateGameConfig, ValidationIssue } from "@/lib/schema";
import { simulate, summarizeReport } from "@/lib/simulate";
import { ChatMessage, ToolDef, callChat } from "./provider";
import { SKILL_PACKS, buildSystemPrompt } from "./prompt";
import { DESIGN_CARD_TEMPLATE, configUnlocked, parseCardStatus } from "./designcard";
import { LibraryEntry } from "@/lib/library";

// 驻场策划 agent 循环：带四个工具，改坏了会被校验器当场打回并自动重试。

const MAX_ROUNDS = 6;

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "update_design_card",
      description: "更新《游戏设计卡》——与创作者的设计共识备忘录（markdown 全文替换）",
      parameters: {
        type: "object",
        properties: { content: { type: "string", description: "设计卡完整内容" } },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_config",
      description:
        "以完整 GameConfig JSON 替换当前游戏配置。会自动做结构+语义校验：有错误则不落盘并返回错误清单，请修正后重试；只有警告则落盘成功。",
      parameters: {
        type: "object",
        properties: { config: { type: "object", description: "完整的 GameConfig 对象" } },
        required: ["config"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "patch_config",
      description:
        "分批写配置：只提交某一个分节的条目，避免一次吐出整份 JSON 被输出上限截断。" +
        "内容多的游戏（几十个选手/几十张卡）必须用它分批建：先用 update_config 建骨架，" +
        "再用本工具一批批 append（每批 15~25 条）。只做结构校验，语义校验用 validate 收尾。",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            description: "要写的分节",
            enum: ["cards", "entities", "entityTypes", "actions", "settlements", "endings", "vars", "curves", "leagues"],
          },
          mode: {
            type: "string",
            description: "append=追加（同 id 覆盖），replace=整节替换。默认 append",
            enum: ["append", "replace"],
          },
          items: { type: "array", description: "该分节的条目数组", items: { type: "object" } },
        },
        required: ["section", "items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "列出这部作品当前有哪些文件（自由模式）。改代码之前先看一眼有什么。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读一个文件的全文（自由模式）。要改哪个文件就先读哪个，不要凭印象重写。",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "相对路径，如 index.html" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "写入一个文件（自由模式），已存在则整份覆盖。入口必须叫 index.html。" +
        "文件较大时按模块拆开（index.html / game.js / style.css），别把几千行塞进一个文件。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_skill",
      description:
        "取一份技能包的全文。系统提示里只常驻核心规则与一行索引，写法细节要用它取——不要凭印象猜。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "技能包名，见系统提示末尾的「还能取用的技能包」" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_config",
      description:
        "按需读取当前配置某个分节的完整内容。配置很大时上下文里只有目录（id + 一句话），" +
        "要改某几张卡之前先用它把原文取出来，不要凭目录猜。一次最多取 12 条。",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: ["cards", "entities", "entityTypes", "actions", "settlements", "endings", "vars", "curves", "leagues", "search", "notebook", "meta", "text", "driver"],
          },
          ids: { type: "array", description: "要取的条目 id；不填则取整节（可能被截断）", items: { type: "string" } },
        },
        required: ["section"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "validate",
      description: "对当前配置跑结构+语义校验，返回问题清单",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_library",
      description:
        "搜索平台内容库（官方与创作者共享的现成事件卡：机遇/挑战/日常/抉择）。写事件卡之前先搜，能复用或改编就不要从零写。返回的卡片附带 requiredVars（引用到的变量定义），插入配置时要把缺失的变量一起补进 vars。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "关键词（题材/标题/文案），可为空" },
          category: { type: "string", description: "可选：机遇 / 挑战 / 日常 / 抉择" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "simulate",
      description: "用随机策略把当前配置跑 N 局，返回结局覆盖率、平均局长、从未触发的内容等报告",
      parameters: {
        type: "object",
        properties: { runs: { type: "number", description: "局数，默认 200，最多 500" } },
      },
    },
  },
];

export interface AgentContext {
  config: GameConfig;
  designCard: string;
  searchLibrary?: (q: string, category?: string) => LibraryEntry[];
  /**
   * 自由模式的文件读写。传了才会把三个文件工具给 AI——
   * 快速模式的作品不该看到它们，免得 AI 分心去写代码。
   */
  files?: {
    list: () => { path: string; size: number }[];
    read: (path: string) => string | null;
    write: (path: string, content: string) => void;
  };
}

export interface AgentResult {
  reply: string;
  config?: GameConfig;
  designCard?: string;
  /** 这一轮有没有动过自由模式的文件（前端据此刷新预览） */
  filesChanged?: boolean;
  totalTokens: number;
}

function issuesToText(issues: ValidationIssue[]): string {
  if (issues.length === 0) return "校验通过，没有发现问题。";
  return issues.map((i) => `[${i.severity === "error" ? "错误" : "警告"}] ${i.path}: ${i.message}`).join("\n");
}

/** 超过这个字符数就不再把整份配置塞进上下文，改发结构摘要 + 按需读取 */
const CONFIG_INLINE_LIMIT = 16000;

function firstLine(text: string | undefined, n = 26): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * 大配置的结构摘要。
 *
 * 上下文不能随作品规模线性增长——90 个选手的配置有十几万字符，每轮都发一遍
 * 既撑爆上下文也烧光额度。所以大游戏只发「目录」：有哪些卡、哪些变量、哪些结局，
 * 每条给个 id 和一句话；AI 要看某几张卡的全文时用 read_config 工具按需取。
 */
function summarizeConfig(config: GameConfig): string {
  const L: string[] = [];
  const d = config.driver;
  L.push(`driver: ${d.kind}` + (d.kind === "life" ? `（${d.time.label} ${d.time.start}~${d.time.max}）` : d.kind === "sim" ? `（${d.time.turnLabel}，${d.time.maxCycles} 个${d.time.cycleLabel ?? "周期"}）` : `（起始卡 ${d.startCard}）`));
  L.push(`vars(${config.vars.length}): ` + config.vars.map((v) => `${v.id}=${v.initial}${v.visible === false ? "(隐藏)" : ""}`).join(" / "));
  L.push(
    `cards(${config.cards.length}): ` +
      config.cards
        .map((c) => {
          const flags = [c.priority !== undefined ? `P${c.priority}` : "", c.once ? "once" : "", c.weight ? `w${c.weight}` : "", (c.choices?.length ?? 0) > 0 ? `${c.choices!.length}选` : "", c.textVariants?.length ? `${c.textVariants.length}变体` : "", c.goto ? `→${c.goto}` : ""].filter(Boolean).join(",");
          return `${c.id}[${flags}] "${firstLine(c.text)}"`;
        })
        .join(" / ")
  );
  L.push(`endings(${config.endings.length}): ` + config.endings.map((e) => `${e.id}(${e.kind})${e.condition ? ` if ${e.condition}` : ""}`).join(" / "));
  if (config.actions?.length) L.push(`actions(${config.actions.length}): ` + config.actions.map((a) => `${a.id}(${a.cost ?? 1}点)`).join(" / "));
  if (config.settlements?.length) L.push(`settlements(${config.settlements.length}): ` + config.settlements.map((st) => `${st.id}(${st.data?.length ?? 0} 行数据, ${st.outcomes.length} 个 outcome)`).join(" / "));
  if (config.entityTypes?.length) L.push(`entityTypes: ` + config.entityTypes.map((t) => `${t.id}[${t.attributes.map((a) => a.id).join(",")}]`).join(" / "));
  if (config.entities?.length) L.push(`entities(${config.entities.length}): ` + config.entities.map((e) => `${e.id}(${e.type})`).join(" / "));
  if (config.curves?.length) L.push(`curves(${config.curves.length}): ` + config.curves.map((c) => c.id).join(" / "));
  if (config.leagues?.length) L.push(`leagues(${config.leagues.length}): ` + config.leagues.map((l) => l.id).join(" / "));
  if (config.search) L.push(`search: ${config.search.entries.length} 个词条（${config.search.entries.map((e) => e.keywords[0]).join("、")}）`);
  if (config.notebook) L.push(`notebook: ${config.notebook.items.length} 条`);
  return L.join("\n");
}

export async function runAssistant(
  ctx: AgentContext,
  history: { role: "user" | "assistant"; content: string }[]
): Promise<AgentResult> {
  let config = ctx.config;
  let designCard = ctx.designCard || DESIGN_CARD_TEMPLATE;
  let configChanged = false;
  let filesChanged = false;
  let designChanged = ctx.designCard !== designCard;
  let totalTokens = 0;

  const configJson = JSON.stringify(config);
  const configBlock =
    configJson.length <= CONFIG_INLINE_LIMIT
      ? `【当前游戏配置】\n${configJson}`
      : `【当前游戏配置·目录】（配置已有 ${Math.round(configJson.length / 1000)}k 字符，太大不再整份贴出来。\n` +
        `要看某几张卡/某个结算的完整内容，用 read_config 工具按 id 取；\n` +
        `要改内容用 patch_config 分批写，不要求你重发整份配置。）\n${summarizeConfig(config)}`;
  const contextMsg =
    `【当前设计卡】\n${designCard}\n\n` +
    `${configBlock}\n\n` +
    `【当前校验结果】\n${issuesToText(validateGameConfig(config).issues)}`;

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(config) },
    { role: "system", content: contextMsg },
    ...history.map((m): ChatMessage => ({ role: m.role, content: m.content })),
  ];

  // 作品已经有卡片 = 已经搭出来了，创作者现在是在改成品，配置写入不再受设计卡门禁约束
  const alreadyBuilt = config.cards.length > 0;
  const writeAllowed = (): boolean => alreadyBuilt || configUnlocked(designCard);
  // 同一个拒绝理由连着撞两次就别再耗轮次了——模型不会自己想通，直接把话说给创作者听
  let blockedTimes = 0;
  let blockedReason = "";
  const rejectWrite = (what: string): string => {
    blockedTimes += 1;
    blockedReason =
      `配置写入被流程门禁挡住了：设计卡状态还是「${parseCardStatus(designCard)}」，` +
      `而这个作品还没有任何卡片，属于「从零开搭」。` +
      `按流程要先跟创作者把方案对齐、拿到明确同意，再把设计卡状态改成「已确认」。`;
    return `已拒绝（${what}）：${blockedReason}`;
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (blockedTimes >= 2) break;
    const { message, totalTokens: used } = await callChat(messages, TOOLS);
    totalTokens += used;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return {
        reply: message.content ?? "（无回复）",
        config: configChanged ? config : undefined,
        designCard: designChanged ? designCard : undefined,
        filesChanged,
        totalTokens,
      };
    }

    for (const call of message.tool_calls) {
      let result: string;
      try {
        const args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
        result = runTool(call.function.name, args);
      } catch (err) {
        result = `工具执行失败：${err instanceof Error ? err.message : String(err)}`;
      }
      messages.push({ role: "tool", content: result, tool_call_id: call.id });
    }

    function runTool(name: string, args: Record<string, unknown>): string {
      switch (name) {
        case "update_design_card": {
          if (typeof args.content !== "string") return "参数错误：content 必须是字符串";
          designCard = args.content.slice(0, 20000);
          designChanged = true;
          return "设计卡已更新。";
        }
        case "update_config": {
          // 流程门禁：需求没对齐、方案没经创作者批准，禁止**从零**生成配置。
          // 但作品已经搭出来了（有卡片）就不该再拦——那时创作者是在改自己的成品，
          // 拦下来会导致「说什么都没反应」：AI 反复被拒、轮次烧光、只回一句废话。
          if (!writeAllowed()) {
            return rejectWrite("生成配置");
          }
          const raw = typeof args.config === "string" ? JSON.parse(args.config) : args.config;
          const check = validateGameConfig(raw);
          const errors = check.issues.filter((i) => i.severity === "error");
          if (errors.length > 0) {
            return `配置未通过校验（未落盘），请修正后重新提交完整配置：\n${issuesToText(errors)}`;
          }
          config = check.config!;
          configChanged = true;
          const warnings = check.issues.filter((i) => i.severity === "warning");
          return warnings.length > 0
            ? `配置已更新。有 ${warnings.length} 个警告可酌情处理：\n${issuesToText(warnings)}`
            : "配置已更新，校验全部通过。";
        }
        case "patch_config": {
          if (!writeAllowed()) {
            return rejectWrite("分批写入配置");
          }
          const section = String(args.section ?? "");
          const allowed = ["cards", "entities", "entityTypes", "actions", "settlements", "endings", "vars", "curves", "leagues"];
          if (!allowed.includes(section)) return `不支持的分节「${section}」，可用：${allowed.join(" / ")}`;
          const raw = typeof args.items === "string" ? JSON.parse(args.items) : args.items;
          if (!Array.isArray(raw)) return "参数错误：items 必须是数组";
          const mode = args.mode === "replace" ? "replace" : "append";

          const current = config as unknown as Record<string, unknown>;
          const before = Array.isArray(current[section]) ? (current[section] as Record<string, unknown>[]) : [];
          let merged: Record<string, unknown>[];
          if (mode === "replace") {
            merged = raw as Record<string, unknown>[];
          } else {
            const byId = new Map<string, Record<string, unknown>>();
            for (const it of [...before, ...(raw as Record<string, unknown>[])]) {
              const key = String(it?.id ?? `${byId.size}`);
              byId.set(key, it); // 同 id 后来居上，分批重跑不会写出重复条目
            }
            merged = [...byId.values()];
          }

          // 只做结构校验：分批过程中难免有暂时的悬空引用（卡片先于结局写入），
          // 那属于语义问题，交给 validate 在收尾时统一查。
          const candidate = { ...(config as object), [section]: merged };
          const structural = GameConfigSchema.safeParse(candidate);
          if (!structural.success) {
            const first = structural.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
            return `这一批结构不合法（未落盘）：\n${first}`;
          }
          config = structural.data as GameConfig;
          configChanged = true;
          const semantic = validateGameConfig(config).issues.filter((i) => i.severity === "error");
          return semantic.length > 0
            ? `已写入 ${section}：本批 ${raw.length} 条，该分节现在共 ${merged.length} 条。` +
                `当前还有 ${semantic.length} 处语义错误（分批途中正常，全部写完后用 validate 收尾修掉）。`
            : `已写入 ${section}：本批 ${raw.length} 条，该分节现在共 ${merged.length} 条，校验通过。`;
        }
        case "list_files": {
          if (!ctx.files) return "这部作品是快速模式（配置 + 通用引擎），没有文件可列。";
          const list = ctx.files.list();
          if (list.length === 0) return "还没有任何文件。自由模式的入口必须是 index.html。";
          return list.map((f) => `${f.path}（${f.size} 字符）`).join("\n");
        }
        case "read_file": {
          if (!ctx.files) return "这部作品是快速模式，没有文件可读。";
          const path = String(args.path ?? "");
          const content = ctx.files.read(path);
          if (content === null) return `没有这个文件：${path}`;
          const MAX = 30000;
          return content.length > MAX
            ? `${content.slice(0, MAX)}\n…（文件过长已截断，${content.length} 字符）`
            : content;
        }
        case "write_file": {
          if (!ctx.files) return "这部作品是快速模式，不能写文件。";
          const path = String(args.path ?? "");
          const content = typeof args.content === "string" ? args.content : "";
          if (!path || path.includes("..") || path.startsWith("/") || !/^[A-Za-z0-9/._-]+$/.test(path)) {
            return `路径不合法：${path}（只许相对路径，字母数字点横线斜杠）`;
          }
          if (content.length > 400000) return "单个文件太大了（上限 40 万字符），按模块拆开写。";
          ctx.files.write(path, content);
          filesChanged = true;
          return `已写入 ${path}（${content.length} 字符）。`;
        }
        case "read_skill": {
          const key = String(args.name ?? "");
          const pack = SKILL_PACKS[key];
          if (!pack) {
            return `没有叫「${key}」的技能包。可用：${Object.keys(SKILL_PACKS).join(" / ")}`;
          }
          return pack.body;
        }
        case "read_config": {
          const section = String(args.section ?? "");
          const bag = (config as unknown as Record<string, unknown>)[section];
          if (bag === undefined) return `配置里没有「${section}」这一节。`;
          const ids = Array.isArray(args.ids) ? args.ids.map(String) : null;
          let payload: unknown = bag;
          if (Array.isArray(bag)) {
            const list = bag as Record<string, unknown>[];
            payload = ids ? list.filter((it) => ids.includes(String(it?.id))).slice(0, 12) : list.slice(0, 12);
          }
          const out = JSON.stringify(payload);
          const MAX = 24000;
          return out.length > MAX
            ? `${out.slice(0, MAX)}\n…（内容过长已截断，请用 ids 指定要看的条目）`
            : out;
        }
        case "search_library": {
          if (!ctx.searchLibrary) return "内容库当前不可用。";
          const entries = ctx.searchLibrary(String(args.query ?? ""), args.category ? String(args.category) : undefined).slice(0, 8);
          if (entries.length === 0) return "内容库里没有匹配的卡片，需要自己写。";
          return JSON.stringify(
            entries.map((e) => ({ 名称: e.name, 分类: e.category, 标签: e.tags, 卡片: e.card, 需要的变量: e.requiredVars })),
            null,
            0
          );
        }
        case "validate":
          return issuesToText(validateGameConfig(config).issues);
        case "simulate": {
          const check = validateGameConfig(config);
          if (!check.ok) return "配置存在错误，无法模拟。先用 validate 查看并修复。";
          const runs = Math.min(Math.max(Number(args.runs) || 200, 20), 500);
          return summarizeReport(simulate(check.config!, runs, Date.now() % 100000));
        }
        default:
          return `未知工具 ${name}`;
      }
    }
  }

  // 走到这里说明：要么工具轮次用尽，要么同一个门禁连撞两次。
  // 以前这里回一句「这轮修改步骤较多，我先停在这里」——等于什么都没说，
  // 创作者连「哪里卡住了」都看不到，只会以为 AI 坏了。改成再问一次模型，
  // 这次不给工具，强制它用文字交代现状。
  messages.push({
    role: "system",
    content:
      (blockedTimes >= 2
        ? `你连续被流程门禁拒绝。${blockedReason}\n`
        : `工具调用轮次已用尽（上限 ${MAX_ROUNDS} 轮）。\n`) +
      "现在不要再调用任何工具，直接用中文回答创作者：" +
      "①这一轮你实际改了什么（没改就直说没改）；②卡在哪、为什么；" +
      "③需要创作者做什么决定或补什么信息。不要重复套话。",
  });
  try {
    const { message, totalTokens: used } = await callChat(messages);
    totalTokens += used;
    if (message.content && message.content.trim()) {
      return {
        reply: message.content,
        config: configChanged ? config : undefined,
        designCard: designChanged ? designCard : undefined,
        filesChanged,
        totalTokens,
      };
    }
  } catch {
    // 收尾这次调用失败就用下面的兜底文案，不要因此丢掉本轮已经生效的改动
  }
  return {
    reply:
      blockedTimes >= 2
        ? `${blockedReason}\n\n你可以直接回我「按这个方案开搭」，我就把设计卡状态推进到「已确认」再动手。`
        : `这一轮工具用满了 ${MAX_ROUNDS} 轮还没收尾。` +
          (configChanged ? "已经写入的改动都生效了，" : "配置没有产生改动，") +
          "再说一次你想要的效果，我接着做。",
    config: configChanged ? config : undefined,
    designCard: designChanged ? designCard : undefined,
    filesChanged,
    totalTokens,
  };
}
