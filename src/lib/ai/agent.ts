import { GameConfig, GameConfigSchema, validateGameConfig, ValidationIssue } from "@/lib/schema";
import { simulate, summarizeReport } from "@/lib/simulate";
import { ChatMessage, ToolDef, callChat } from "./provider";
import { SKILL_PACKS, buildSystemPrompt } from "./prompt";
import { GameMode } from "@/lib/store/types";
import { DESIGN_CARD_TEMPLATE, configUnlocked, parseCardStatus } from "./designcard";
import { LibraryEntry } from "@/lib/library";
import { viewFile } from "./file-view";
import { checkFileSyntax, describeProblem } from "@/lib/syntax-check";
import { checkWiring, describeWiring } from "@/lib/wiring";

// 驻场策划 agent 循环：带四个工具，改坏了会被校验器当场打回并自动重试。

const MAX_ROUNDS = 6;
/**
 * 一次对话里最多让 AI 连着用多少次工具。
 *
 * 快速模式 6 次够了：改配置是一次写一整节。自由模式不一样——它要
 * 「看目录 → 读那一段 → 改三处 → 再核一遍」，六次刚够干一件事。
 * 而复刻 VAL MANAGER 那个体量（13,132 行）靠的正是「一轮里多干几件事」。
 * 真正的刹车是墙钟预算（roundBudgetMs），轮次上限只是个兜底，不该由它当瓶颈。
 */
/**
 * 一轮对话里最多让模型说几次话（每次可以带若干工具调用）。
 *
 * 自由模式这个数从 16 提到 40：**该管住一轮的是时间，不是次数**。
 * 异步化之后一轮有 12 分钟，16 次说话在时间用满之前就被数完了——
 * 于是每轮只长一千来字符，一部一万三千行的作品永远搭不完。
 * 真正的闸门是下面的 budgetMs，到点就收尾、把做完的存下来。
 */
function maxToolRounds(mode: GameMode): number {
  if (mode === "code") return Number(process.env.AI_MAX_TOOL_ROUNDS_CODE ?? 40);
  return Number(process.env.AI_MAX_TOOL_ROUNDS ?? MAX_ROUNDS);
}
/**
 * 一轮对话最多占用多久（毫秒）。
 *
 * 线上实测两次都撞在同一个地方：第 1 轮（纯聊方案）32 秒稳过，第 2 轮
 * （「按这个开搭」，真要动手的那一轮）连撞三次 502 Application failed to respond。
 * 根子是一次请求里塞了太多事——多轮模型调用 + 校验 + 几百局模拟，
 * 而模拟是**纯 CPU 的同步长任务**（量过：manager 规模 600 局要 30 秒），
 * 那段时间 Node 的事件循环被占死，网关看到的就是「这个应用没反应」。
 *
 * 所以给每一轮设一个墙钟预算：超了就不再开新的工具轮，把已经做完的部分
 * 交代清楚返回。配置是改一次存一次的，所以「分几轮搭完」不会丢东西——
 * 这也正是搭一个大作品该有的样子：一口气搭完本来就不现实。
 */
function roundBudgetMs(mode: GameMode): number {
  // 自由模式要宽得多：实测一次「写一份上万字符的文件」的模型调用要 2~3 分钟
  // （流式，连接是活的，只是内容多）。40 秒的预算等于每轮只写得动一个文件，
  // 后面几轮全是「先交个底」——那不是在保护请求，是在拦着 AI 干活。
  // 上限仍留在工作台那 5 分钟的等待上限之内。
  if (mode === "code") return Number(process.env.AI_ROUND_BUDGET_CODE_MS ?? 180_000);
  return Number(process.env.AI_ROUND_BUDGET_MS ?? 40_000);
}

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
        properties: {
          config: { type: "object", description: "完整的 GameConfig 对象" },
          switchToEngine: {
            type: "boolean",
            description:
              "仅当这部作品现在是自由模式、创作者明确同意切回快速模式时才带 true。" +
              "切回去之后页面文件不再执行（文件仍然保留），游戏改由通用引擎按配置渲染。",
          },
        },
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
          switchToEngine: {
            type: "boolean",
            description:
              "仅当这部作品现在是自由模式、创作者明确同意切回快速模式时才带 true（含义同 update_config）。",
          },
        },
        required: ["section", "items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_errors",
      description:
        "看这部作品在浏览器里抛过什么异常（自由模式）。**每一轮动手之前先看一眼**——" +
        "自由模式没有校验器，作品炸了不会有人通知你，这里就是唯一的线索。" +
        "修完之后带 clear: true 再调一次，把旧错清掉，免得下一轮被它误导。",
      parameters: {
        type: "object",
        properties: {
          clear: { type: "boolean", description: "读完就清空（确认修好了再用）" },
        },
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
      description:
        "读文件（自由模式）。要改哪个文件就先读哪个，不要凭印象重写。" +
        "文件小就直接给全文；**大文件给的是目录**（每一节在第几行），再用 from/lines 看某一段。" +
        "改之前想确认某段原文在不在、唯不唯一，用 find 搜——patch_file 的 find 必须唯一，这一步能省一次失败。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对路径，如 game.js" },
          from: { type: "number", description: "从第几行开始读（1 起）。大文件先看目录再决定读哪段。" },
          lines: { type: "number", description: "读多少行，默认 140，最多 400。" },
          find: {
            type: "string",
            description: "搜一小段原文，返回它出现在第几行、出现几次、以及上下文。",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "写入一个文件（自由模式），已存在则整份覆盖。**新建文件用它；改已有文件请用 patch_file**" +
        "（整份重写会把全文再吐一遍，额度烧得飞快）。入口必须叫 index.html。" +
        "文件较大时按模块拆开（index.html / game.js / style.css），别把几千行塞进一个文件。" +
        "注意：快速模式的作品一旦写文件就切到自由模式，配置里的卡片不再生效——" +
        "那种情况必须先取得创作者明确同意，再带 switchToCode: true 调用。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          switchToCode: {
            type: "boolean",
            description: "把一部已有配置内容的快速模式作品切到自由模式。只有创作者明确同意后才填 true。",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "patch_file",
      description:
        "改一个已有文件的局部（自由模式）。**改东西优先用它，不要用 write_file 整份重写**——" +
        "重写一份一万字符的 game.js 要把全文再吐一遍，改十次就是十遍，额度烧得飞快。" +
        "一次可以带多处改动，按顺序应用。每个 find 必须在文件里**只出现一次**（要改多处相同的写 all: true），" +
        "所以 find 要带够上下文（连着上下几行一起写），不要只写一个变量名。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对路径，如 game.js" },
          edits: {
            type: "array",
            description: "这一批改动，按顺序应用",
            items: {
              type: "object",
              properties: {
                find: { type: "string", description: "要被替换的原文，必须与文件内容逐字一致" },
                replace: { type: "string", description: "替换成什么；写空字符串就是删掉这一段" },
                all: { type: "boolean", description: "原文出现多次时是否全部替换，默认只允许唯一匹配" },
              },
              required: ["find", "replace"],
            },
          },
        },
        required: ["path", "edits"],
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
  /** 作品形态：决定发哪套守则（自由模式讲代码，快速模式讲配置） */
  mode?: GameMode;
  /**
   * 每次配置/设计卡真的变了就立刻落盘。
   *
   * 不传也能跑（调用方在结束后统一保存），但那样有个真实的坑：
   * 生成量大的那一轮可能被网关掐掉（线上实测撞过 502），
   * 请求死在半路，这一轮辛辛苦苦改的东西就全丢了。
   * 传了这个回调，改一次存一次——连接断了，活还在。
   */
  persist?: (patch: { config?: GameConfig; designCard?: string }) => void;
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
  /** 切轨：自由模式写文件时切到 code，创作者同意回切时切回 engine。不传则形态不变 */
  setMode?: (mode: GameMode) => void;
  /**
   * 单轮墙钟预算的覆盖值（毫秒）。
   *
   * 默认值是被**网关的耐心**逼出来的：同步请求超过几分钟必然 502，
   * 所以只能压到 240 秒，AI 一轮干不完一件事。异步任务没有这个约束——
   * 请求早就返回了，活在后台跑——所以那条路会传一个大得多的值进来。
   */
  budgetMs?: number;
  /**
   * 作品在浏览器里抛过的异常。自由模式版的「校验器」——
   * 快速模式写错了会被三级校验当场打回，自由模式原本 AI 一无所知。
   */
  errors?: {
    list: () => { at: string; message: string; stack: string; source: string }[];
    clear: () => void;
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
  // 一轮里只切一次轨，别每次写配置都再宣布一遍
  let switchedToEngine = false;

  const mode: GameMode = ctx.mode ?? "engine";
  const configJson = JSON.stringify(config);
  const configBlock =
    configJson.length <= CONFIG_INLINE_LIMIT
      ? `【当前游戏配置】\n${configJson}`
      : `【当前游戏配置·目录】（配置已有 ${Math.round(configJson.length / 1000)}k 字符，太大不再整份贴出来。\n` +
        `要看某几张卡/某个结算的完整内容，用 read_config 工具按 id 取；\n` +
        `要改内容用 patch_config 分批写，不要求你重发整份配置。）\n${summarizeConfig(config)}`;
  // 自由模式下配置只剩 meta，游戏本体在文件里——上下文该给的是文件清单，
  // 以及通用引擎的校验结果（那套规则在这里不适用，贴了只会让 AI 去修不存在的问题）。
  const fileBlock = (): string => {
    const list = ctx.files?.list() ?? [];
    if (list.length === 0) return "【当前文件】还没有任何文件。至少要有一个 index.html。";
    return (
      "【当前文件】（要看内容用 read_file 取，不要凭印象改）\n" +
      list.map((f) => `- ${f.path}（${f.size} 字符）`).join("\n")
    );
  };
  // 切轨之后的「进度」：换了轨道不等于前面白干。
  //
  // 一部作品从快速模式切过来，卡片/变量/结局还原样躺在配置里；反过来切回去，
  // 页面文件也还在。但上下文原来只发当前轨道那一半，AI 看不见另一半，
  // 只能凭空重编——「切换等于推倒重来」就是这么来的，不是数据丢了，是它瞎了。
  // 两边都把另一半的目录摆出来，AI 就能照着翻译（全文按需 read_config / read_file 取）。
  const carriedFromEngine =
    config.cards.length > 0 || config.vars.length > 0 || config.endings.length > 0;
  const legacyEngineBlock = carriedFromEngine
    ? `\n\n【快速模式攒下的素材·目录】（这部作品在快速模式里已经做出这些东西，没有丢。\n` +
      `**照着翻译，不要重编**：卡片文案 → 页面上的正文，变量 → 存档里的字段，\n` +
      `结局 → 结局判定，实体/联赛 → 数据与赛程。要看某条的全文用 read_config 按 id 取。\n` +
      `它们不再由通用引擎执行，最终得由你的代码把它们呈现出来。）\n${summarizeConfig(config)}`
    : "";
  const hasFiles = (ctx.files?.list() ?? []).length > 0;
  const legacyFilesBlock = hasFiles
    ? `\n\n${fileBlock().replace("【当前文件】", "【自由模式留下的文件】（这部作品写过页面，文件都还在。\n" +
        "要把里面的内容搬回配置，用 read_file 读原文，别凭印象编。这些文件在快速模式下不再执行。）\n")}`
    : "";
  const contextMsg =
    mode === "code"
      ? `【当前设计卡】\n${designCard}\n\n` +
        `【游戏信息】${JSON.stringify(config.meta)}\n\n` +
        fileBlock() +
        legacyEngineBlock
      : `【当前设计卡】\n${designCard}\n\n` +
        `${configBlock}\n\n` +
        `【当前校验结果】\n${issuesToText(validateGameConfig(config).issues)}` +
        legacyFilesBlock;

  const messages: ChatMessage[] = [
    // 预算要如实告诉模型：提示里写「40 秒」而实际有 12 分钟，它会自己把活切碎
    { role: "system", content: buildSystemPrompt(config, mode, ctx.budgetMs ?? roundBudgetMs(mode)) },
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

  /**
   * 每次写完文件都做一次接线体检。
   *
   * 第一级校验只查**单个文件**的语法——实测里撞见过 9 个文件 145,137 字符、
   * 11 个主界面全在的作品，玩家打开却是一片空白，因为 index.html 少了一行
   * `<script src="screens-setup.js">`。每个文件单独看都对，拼起来跑不动。
   * 这一层就是补那个缺口：只报告，不拦截（先写文件、下一步再接进去是正常节奏）。
   */
  const wiringNote = (): string => {
    if (!ctx.files) return "";
    const bag: Record<string, string> = {};
    for (const f of ctx.files.list()) bag[f.path] = "";
    const idx = Object.keys(bag).find((p) => /(^|\/)index\.html$/i.test(p));
    if (idx) bag[idx] = ctx.files.read(idx) ?? "";
    const note = describeWiring(checkWiring(bag));
    return note ? `\n${note}` : "";
  };

  const startedAt = Date.now();
  let outOfTime = false;
  const roundCap = maxToolRounds(mode);
  for (let round = 0; round < roundCap; round++) {
    if (blockedTimes >= 2) break;
    // 时间到了就别再开新一轮：宁可把这一轮做完的东西交出去，
    // 也不要让整个请求死在网关上（那样创作者什么都看不到）
    if (round > 0 && Date.now() - startedAt > (ctx.budgetMs ?? roundBudgetMs(mode))) {
      outOfTime = true;
      break;
    }
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

    /**
     * 回切闸门（自由 → 快速），对称于 write_file 那道 switchToCode 闸门。
     *
     * 自由模式的作品，界面就是它的全部。往配置里写卡片等于宣布「以后由通用引擎渲染」，
     * 那些页面立刻不再执行——这是创作者才能做的决定，不能由 AI 顺手完成。
     * 只拦「写真游戏内容」；改 meta（标题、题材、封面）在自由模式下本来就是正常操作。
     */
    function switchBackGuard(candidate: unknown, agreed: boolean, what: string): string | null {
      if (mode !== "code" || agreed) return null;
      const c = candidate as { cards?: unknown[]; endings?: unknown[]; vars?: unknown[] } | null;
      const substantial =
        (c?.cards?.length ?? 0) > 0 || (c?.endings?.length ?? 0) > 0 || (c?.vars?.length ?? 0) > 0;
      if (!substantial) return null;
      const files = ctx.files?.list() ?? [];
      return (
        `已拒绝（${what}）：这部作品现在是自由模式，界面由它自己的 ${files.length} 个文件决定。` +
        "往配置里写卡片会把它切回快速模式——页面从此不再执行（文件仍然保留），" +
        "游戏改由通用引擎渲染，界面会变成所有作品通用的那一套。" +
        "先把这个代价告诉创作者，得到他明确同意后，再带 switchToEngine: true 调用。" +
        "如果他只是想改标题/题材/封面，那只动 meta 就行，不必回切。"
      );
    }

    /**
     * 自由模式下改配置，别把从快速模式带过来的内容顺手抹了。
     * 只有创作者点头回切（switchToEngine）时，才让新配置整份说了算。
     */
    function keepCarriedContent(candidate: unknown, agreed: boolean): unknown {
      if (mode !== "code" || agreed || !carriedFromEngine) return candidate;
      const next = (candidate ?? {}) as Record<string, unknown>;
      const cur = config as unknown as Record<string, unknown>;
      const incomingHasContent =
        ((next.cards as unknown[])?.length ?? 0) > 0 ||
        ((next.vars as unknown[])?.length ?? 0) > 0 ||
        ((next.endings as unknown[])?.length ?? 0) > 0;
      if (incomingHasContent) return candidate; // 真在写内容（且已过闸门），按它说的来
      return { ...cur, ...next, cards: cur.cards, vars: cur.vars, endings: cur.endings };
    }

    /** 创作者点头之后真正切回快速模式；文件一个都不删，只是不再执行 */
    function switchBackApply(agreed: boolean): string {
      if (mode !== "code" || !agreed || switchedToEngine) return "";
      switchedToEngine = true;
      ctx.setMode?.("engine");
      return "\n（已切回快速模式：现在由通用引擎按配置渲染，原来的页面文件仍然保留但不再执行。）";
    }

    function runTool(name: string, args: Record<string, unknown>): string {
      switch (name) {
        case "update_design_card": {
          if (typeof args.content !== "string") return "参数错误：content 必须是字符串";
          designCard = args.content.slice(0, 20000);
          designChanged = true;
          ctx.persist?.({ designCard });
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
          const back = switchBackGuard(raw, args.switchToEngine === true, "update_config");
          if (back) return back;
          // 自由模式下守则叫 AI「配置只维护 meta」，于是改个标题它就整份重发一个
          // 只有 meta 的配置——那会把从快速模式带过来的卡片一次抹掉，
          // 「切换不丢进度」当场变成空话。所以这里只收 meta/theme，其余原样留着。
          const payload = keepCarriedContent(raw, args.switchToEngine === true);
          const check = validateGameConfig(payload);
          const errors = check.issues.filter((i) => i.severity === "error");
          if (errors.length > 0) {
            return `配置未通过校验（未落盘），请修正后重新提交完整配置：\n${issuesToText(errors)}`;
          }
          config = check.config!;
          configChanged = true;
          ctx.persist?.({ config });
          const switched = switchBackApply(args.switchToEngine === true);
          const warnings = check.issues.filter((i) => i.severity === "warning");
          return (
            (warnings.length > 0
              ? `配置已更新。有 ${warnings.length} 个警告可酌情处理：\n${issuesToText(warnings)}`
              : "配置已更新，校验全部通过。") + switched
          );
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
          // 分批写也可能是在回切：拿这一批往对应分节上一比，同样要过闸门
          const back = switchBackGuard(
            { [section]: raw } as Record<string, unknown>,
            args.switchToEngine === true,
            "分批写入配置"
          );
          if (back) return back;
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
          ctx.persist?.({ config });
          const semantic = validateGameConfig(config).issues.filter((i) => i.severity === "error");
          const switchedBack = switchBackApply(args.switchToEngine === true);
          return (
            (semantic.length > 0
              ? `已写入 ${section}：本批 ${raw.length} 条，该分节现在共 ${merged.length} 条。` +
                `当前还有 ${semantic.length} 处语义错误（分批途中正常，全部写完后用 validate 收尾修掉）。`
              : `已写入 ${section}：本批 ${raw.length} 条，该分节现在共 ${merged.length} 条，校验通过。`) +
            switchedBack
          );
        }
        case "read_errors": {
          if (!ctx.errors) return "这部作品是快速模式，运行时报错走的是三级校验，不在这里。";
          const list = ctx.errors.list();
          if (args.clear === true) {
            ctx.errors.clear();
            return list.length === 0
              ? "本来就没有报错记录，已清空。"
              : `已清空 ${list.length} 条报错记录。下次预览如果还抛，会重新记上。`;
          }
          if (list.length === 0) {
            return "没有报错记录。（注意：这不等于没问题——没人打开过预览就不会有记录。）";
          }
          return (
            `这部作品最近抛过 ${list.length} 条异常，最新的在最前面：\n` +
            list
              .slice(0, 10)
              .map((e, i) => {
                const where = e.source ? `（${e.source}）` : "";
                const stack = e.stack ? `\n    ${e.stack.split("\n").slice(0, 3).join("\n    ")}` : "";
                return `${i + 1}. ${e.message}${where}${stack}`;
              })
              .join("\n")
          );
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
          // 大文件不再粗暴截断——截断等于「三万字之后的代码永远改不动」，
          // 那样作品长到一半就卡死了。改成给目录 / 给某一段 / 给搜索结果。
          return viewFile(path, content, {
            from: typeof args.from === "number" ? args.from : undefined,
            lines: typeof args.lines === "number" ? args.lines : undefined,
            find: typeof args.find === "string" && args.find ? args.find : undefined,
          });
        }
        case "write_file": {
          if (!ctx.files) return "这部作品是快速模式，不能写文件。";
          // 切轨闸门：快速模式的作品已经有内容了，写文件等于推倒重来，
          // 必须是创作者点头之后的动作，不能由 AI 自己决定。
          if (mode !== "code" && config.cards.length > 1 && args.switchToCode !== true) {
            return (
              "拒绝：这部作品现在是快速模式，已经有 " +
              `${config.cards.length} 张卡片。写文件会切到自由模式，配置里的卡片与数值全部不再生效，` +
              "等于这部作品重做一遍。先把这个代价告诉创作者，得到他明确同意后，再带 switchToCode: true 调用。"
            );
          }
          const path = String(args.path ?? "");
          const content = typeof args.content === "string" ? args.content : "";
          if (!path || path.includes("..") || path.startsWith("/") || !/^[A-Za-z0-9/._-]+$/.test(path)) {
            return `路径不合法：${path}（只许相对路径，字母数字点横线斜杠）`;
          }
          if (content.length > 400000) return "单个文件太大了（上限 40 万字符），按模块拆开写。";
          // 第一级校验：语法不过就不许落盘。带着语法错误上线，玩家看到的是黑屏，
          // 而错误信息到了浏览器里已经被跨域遮蔽成一句 Script error.，回头谁也查不出来。
          const bad = checkFileSyntax(path, content);
          if (bad) return describeProblem(bad);
          ctx.files.write(path, content);
          filesChanged = true;
          return `已写入 ${path}（${content.length} 字符）。${wiringNote()}`;
        }
        case "patch_file": {
          if (!ctx.files) return "这部作品是快速模式，不能改文件。";
          const path = String(args.path ?? "");
          const original = ctx.files.read(path);
          if (original === null) {
            return `文件不存在：${path}。新文件用 write_file 创建，patch_file 只改已有的。`;
          }
          const edits = Array.isArray(args.edits) ? args.edits : [];
          if (edits.length === 0) return "edits 是空的，没有要改的东西。";

          let next = original;
          const done: string[] = [];
          for (const [i, raw] of edits.entries()) {
            const e = raw as { find?: unknown; replace?: unknown; all?: unknown };
            const find = typeof e.find === "string" ? e.find : "";
            const replace = typeof e.replace === "string" ? e.replace : "";
            if (!find) return `第 ${i + 1} 处改动的 find 是空的——要新增内容请把它锚在一段已有的原文上。`;

            // 数一数出现几次：不唯一就退回去让模型带更多上下文重来，
            // 别猜它想改哪一个（猜错会悄悄改坏代码，比报错糟得多）
            let count = 0;
            let from = 0;
            for (;;) {
              const at = next.indexOf(find, from);
              if (at === -1) break;
              count += 1;
              from = at + find.length;
              if (count > 50) break;
            }
            if (count === 0) {
              return (
                `第 ${i + 1} 处改动没找到原文（前 ${i} 处未生效，文件没动）。\n` +
                `find 必须与文件里的内容逐字一致（含缩进与换行）。先 read_file 看一眼当前原文再改。\n` +
                `没找到的是：${find.slice(0, 120)}${find.length > 120 ? "…" : ""}`
              );
            }
            if (count > 1 && e.all !== true) {
              return (
                `第 ${i + 1} 处改动的 find 在文件里出现了 ${count} 次，不知道该改哪一个（文件没动）。\n` +
                `要么把 find 写长一点、带上前后几行让它唯一，要么确认这几处都要改、加上 all: true。`
              );
            }
            next = e.all === true ? next.split(find).join(replace) : next.replace(find, replace);
            done.push(`第 ${i + 1} 处${count > 1 ? `（${count} 处）` : ""}`);
          }

          if (next === original) return "改完之后内容和原来一样，没有实际变化。";
          if (next.length > 400000) return "改完超过单文件上限（40 万字符），把这个文件拆开。";
          // 同一道第一级校验：patch 之后的成品也得能解析，别让一次局部替换把文件改瘫
          const badPatch = checkFileSyntax(path, next);
          if (badPatch) return describeProblem(badPatch);
          ctx.files.write(path, next);
          filesChanged = true;
          const delta = next.length - original.length;
          return (
            `已改 ${path}：${done.join("、")}生效。` +
            `文件 ${original.length} → ${next.length} 字符（${delta >= 0 ? "+" : ""}${delta}）。` +
            wiringNote()
          );
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
          // 上限压到 150 局：模拟是同步的纯 CPU 活，600 局能把事件循环占死半分钟，
          // 那段时间整个服务对外没反应（线上 502 的直接原因之一）。
          // 150 局够看出结局分布与死局，正式验收的 600 局在离线门槛里跑。
          const runs = Math.min(Math.max(Number(args.runs) || 120, 20), 150);
          const report = simulate(check.config!, runs, Date.now() % 100000);
          return (
            summarizeReport(report) +
            (runs < 300 ? `\n（这里跑的是 ${runs} 局快检；发布前平台会用 600 局的完整门槛再验一次。）` : "")
          );
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
  // 超时的这一支不再多打一次模型调用——那又要几十秒，正是要避开的东西。
  // 直接用确定的文字交代现状，快而且不会失败。
  if (outOfTime) {
    return {
      reply:
        `这一轮做到这里先交个底（单轮有时间上限，超了我就先把手上的东西交出去，免得整个请求卡死）。\n\n` +
        (configChanged || filesChanged
          ? `**已经落盘生效**：${configChanged ? "配置改动" : ""}${configChanged && filesChanged ? " + " : ""}${filesChanged ? "文件改动" : ""}。刷新预览就能看到。\n\n`
          : `这一轮还没来得及动配置。\n\n`) +
        `跟我说一声「接着做」，我从这儿往下搭。大作品本来就该分几轮搭——` +
        `每一轮的成果都已经存好了，不会白做。`,
      config: configChanged ? config : undefined,
      designCard: designChanged ? designCard : undefined,
      filesChanged,
      totalTokens,
    };
  }

  messages.push({
    role: "system",
    content:
      (blockedTimes >= 2
        ? `你连续被流程门禁拒绝。${blockedReason}\n`
        : `工具调用轮次已用尽（上限 ${roundCap} 轮）。\n`) +
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
        : `这一轮工具用满了 ${roundCap} 轮还没收尾。` +
          (configChanged ? "已经写入的改动都生效了，" : "配置没有产生改动，") +
          "再说一次你想要的效果，我接着做。",
    config: configChanged ? config : undefined,
    designCard: designChanged ? designCard : undefined,
    filesChanged,
    totalTokens,
  };
}
