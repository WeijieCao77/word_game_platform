import { GameConfig, GameConfigSchema, validateGameConfig, ValidationIssue } from "@/lib/schema";
import { simulate, summarizeReport } from "@/lib/simulate";
import { ChatMessage, ToolDef, callChat } from "./provider";
import { SYSTEM_PROMPT } from "./prompt";
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
}

export interface AgentResult {
  reply: string;
  config?: GameConfig;
  designCard?: string;
  totalTokens: number;
}

function issuesToText(issues: ValidationIssue[]): string {
  if (issues.length === 0) return "校验通过，没有发现问题。";
  return issues.map((i) => `[${i.severity === "error" ? "错误" : "警告"}] ${i.path}: ${i.message}`).join("\n");
}

export async function runAssistant(
  ctx: AgentContext,
  history: { role: "user" | "assistant"; content: string }[]
): Promise<AgentResult> {
  let config = ctx.config;
  let designCard = ctx.designCard || DESIGN_CARD_TEMPLATE;
  let configChanged = false;
  let designChanged = ctx.designCard !== designCard;
  let totalTokens = 0;

  const contextMsg =
    `【当前设计卡】\n${designCard}\n\n` +
    `【当前游戏配置】\n${JSON.stringify(config)}\n\n` +
    `【当前校验结果】\n${issuesToText(validateGameConfig(config).issues)}`;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: contextMsg },
    ...history.map((m): ChatMessage => ({ role: m.role, content: m.content })),
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { message, totalTokens: used } = await callChat(messages, TOOLS);
    totalTokens += used;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return {
        reply: message.content ?? "（无回复）",
        config: configChanged ? config : undefined,
        designCard: designChanged ? designCard : undefined,
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
          // 流程门禁：需求没对齐、方案没经创作者批准，禁止生成配置
          if (!configUnlocked(designCard)) {
            return `已拒绝：设计卡状态是「${parseCardStatus(designCard)}」。请先完成需求对齐并向创作者展示方案，获得其明确同意后把设计卡状态改为「已确认」，才能生成配置。`;
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
          if (!configUnlocked(designCard)) {
            return `已拒绝：设计卡状态是「${parseCardStatus(designCard)}」。请先完成需求对齐并取得创作者同意。`;
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

  return {
    reply: "（这轮修改步骤较多，我先停在这里。刚才的改动已生效，继续说下一步要做什么吧。）",
    config: configChanged ? config : undefined,
    designCard: designChanged ? designCard : undefined,
    totalTokens,
  };
}
