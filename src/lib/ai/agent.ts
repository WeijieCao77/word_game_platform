import { GameConfig, validateGameConfig, ValidationIssue } from "@/lib/schema";
import { simulate, summarizeReport } from "@/lib/simulate";
import { ChatMessage, ToolDef, callChat } from "./provider";
import { SYSTEM_PROMPT } from "./prompt";

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
      name: "validate",
      description: "对当前配置跑结构+语义校验，返回问题清单",
      parameters: { type: "object", properties: {} },
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
  let designCard = ctx.designCard;
  let configChanged = false;
  let designChanged = false;
  let totalTokens = 0;

  const contextMsg =
    `【当前设计卡】\n${designCard || "（还没有设计卡）"}\n\n` +
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
