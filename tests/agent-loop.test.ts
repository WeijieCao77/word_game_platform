import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessage, ChatResult, ToolDef } from "@/lib/ai/provider";

// agent 循环的收尾行为。
// 起因：创作者连着发几条消息，AI 每次都回同一句「这轮修改步骤较多，我先停在这里」——
// 那是轮次烧光后的兜底文案，等于什么都没说，创作者只会以为 AI 坏了。

const calls: { messages: ChatMessage[]; tools?: ToolDef[] }[] = [];
let scripted: (round: number, tools?: ToolDef[]) => ChatResult;

vi.mock("@/lib/ai/provider", () => ({
  aiConfigured: () => true,
  aiRuntimeInfo: () => ({ provider: "test", model: "test" }),
  callChat: async (messages: ChatMessage[], tools?: ToolDef[]): Promise<ChatResult> => {
    calls.push({ messages, tools });
    return scripted(calls.length - 1, tools);
  },
}));

const { runAssistant } = await import("@/lib/ai/agent");

const toolCall = (name: string, args: unknown): ChatResult => ({
  message: {
    role: "assistant",
    content: null,
    tool_calls: [{ id: `c${calls.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  },
  totalTokens: 10,
});
const textReply = (text: string): ChatResult => ({
  message: { role: "assistant", content: text },
  totalTokens: 10,
});

const emptyConfig = {
  schemaVersion: 1 as const,
  meta: { title: "空作品" },
  driver: { kind: "story" as const, startCard: "a" },
  vars: [],
  cards: [],
  endings: [],
};
const builtConfig = {
  ...emptyConfig,
  meta: { title: "已建成的作品" },
  cards: [{ id: "a", text: "开场", choices: [{ id: "go", label: "走", ending: "完" }] }],
  endings: [{ id: "完", title: "完", kind: "neutral" as const }],
};

beforeEach(() => {
  calls.length = 0;
});

describe("轮次用尽时不能只回一句套话", () => {
  it("工具轮次烧光后，会再问一次（不带工具）逼模型交代现状", async () => {
    // 模型每轮都调 validate，永远不给文字回复；最后一次调用没有 tools，才吐文字
    scripted = (_round, tools) =>
      tools ? toolCall("validate", {}) : textReply("我在反复校验，卡在结局条件上，需要你定一下失败线。");

    const r = await runAssistant({ config: builtConfig, designCard: "状态：调优中" }, [
      { role: "user", content: "ui 改得怎么样了" },
    ]);

    expect(r.reply).toContain("卡在结局条件上");
    expect(r.reply).not.toContain("这轮修改步骤较多");
    // 6 轮带工具 + 1 轮收尾不带工具
    expect(calls).toHaveLength(7);
    expect(calls[6].tools).toBeUndefined();
  });

  it("收尾那次调用也失败时，兜底文案要说清楚有没有改动", async () => {
    scripted = (_round, tools) => {
      if (!tools) throw new Error("网络炸了");
      return toolCall("validate", {});
    };
    const r = await runAssistant({ config: builtConfig, designCard: "状态：调优中" }, [
      { role: "user", content: "继续" },
    ]);
    expect(r.reply).toContain("配置没有产生改动");
  });
});

describe("设计卡门禁：只拦从零开搭，不拦改成品", () => {
  it("作品已经有卡片时，即使设计卡还在「需求对齐中」也能改配置", async () => {
    const patched = { ...builtConfig, cards: [...builtConfig.cards, { id: "b", text: "新卡", ending: "完" }] };
    scripted = (round) =>
      round === 0
        ? toolCall("update_config", { config: JSON.stringify(patched) })
        : textReply("加好了一张新卡。");

    const r = await runAssistant({ config: builtConfig, designCard: "状态：需求对齐中" }, [
      { role: "user", content: "加一张卡" },
    ]);

    expect(r.reply).toContain("加好了");
    expect(r.config?.cards).toHaveLength(2);
  });

  it("空作品 + 未确认：连撞两次门禁就停下来把话说给创作者听，不再空烧轮次", async () => {
    scripted = (_round, tools) =>
      tools ? toolCall("update_config", { config: JSON.stringify(builtConfig) }) : textReply("");

    const r = await runAssistant({ config: emptyConfig, designCard: "状态：需求对齐中" }, [
      { role: "user", content: "直接给我做一个" },
    ]);

    expect(r.reply).toContain("需求对齐中");
    expect(r.reply).toContain("按这个方案开搭");
    // 撞两次就 break，加上收尾那一次，远少于 6 轮
    expect(calls.length).toBeLessThan(6);
  });
});
