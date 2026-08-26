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

describe("随手落盘：网关断了也不丢活", () => {
  it("工具每写一次配置就调一次 persist，不必等这一轮跑完", async () => {
    // 线上实测撞过：生成量大的那一轮被网关 502 掐断，请求死在半路。
    // 那时候配置只在内存里，等到最后统一保存的话，这一轮就全白做。
    const saved: { config?: unknown; designCard?: string }[] = [];
    scripted = (round) =>
      round === 0
        ? toolCall("update_config", { config: { ...builtConfig, meta: { title: "改过的标题" } } })
        : textReply("标题改好了。");

    await runAssistant(
      {
        config: builtConfig,
        designCard: "# 游戏设计卡\n状态：调优中\n",
        persist: (patch) => saved.push(patch),
      },
      [{ role: "user", content: "把标题改一下" }]
    );

    // 关键：这一轮还没返回，配置就已经交给存储层了
    const withConfig = saved.find((p) => p.config);
    expect(withConfig, "写配置的那一刻就该落盘").toBeDefined();
    expect((withConfig!.config as typeof builtConfig).meta.title).toBe("改过的标题");
  });

  it("不传 persist 也照常跑——老调用方不受影响", async () => {
    scripted = (round) =>
      round === 0
        ? toolCall("update_config", { config: { ...builtConfig, meta: { title: "无回调" } } })
        : textReply("好了。");
    const r = await runAssistant(
      { config: builtConfig, designCard: "# 游戏设计卡\n状态：调优中\n" },
      [{ role: "user", content: "改标题" }]
    );
    expect(r.config?.meta.title).toBe("无回调");
  });
});

describe("单轮墙钟预算：别让一次请求死在网关上", () => {
  // 线上实测两次都卡在同一处：第 1 轮聊方案 32 秒稳过，第 2 轮「按这个开搭」
  // 连撞三次 502。一次请求里塞了多轮模型调用 + 校验 + 几百局模拟，
  // 而模拟是同步的纯 CPU 活（量过：600 局要 30 秒），事件循环被占死，
  // 网关看到的就是「应用没反应」。超预算就把手上的东西交出去，别硬撑。
  it("超出预算后不再开新一轮，并说清已经落盘的部分", async () => {
    // 测试里的模型调用是 mock 的、瞬间返回，elapsed 常常就是 0ms，
    // 所以预算设成 -1 表示「一进第二轮就算超时」
    process.env.AI_ROUND_BUDGET_MS = "-1";
    try {
      scripted = () => toolCall("update_config", { config: { ...builtConfig, meta: { title: "分批搭" } } });
      const r = await runAssistant(
        { config: builtConfig, designCard: "# 游戏设计卡\n状态：调优中\n" },
        [{ role: "user", content: "按这个开搭" }]
      );
      expect(r.reply).toContain("已经落盘生效");
      expect(r.reply).toContain("接着做");
      expect(r.config?.meta.title).toBe("分批搭");
      // 关键：没有为了收尾又多打一次模型调用（那又是几十秒，正是要避开的）
      expect(calls.length).toBeLessThanOrEqual(2);
    } finally {
      delete process.env.AI_ROUND_BUDGET_MS;
    }
  });

  it("没超预算时照旧走完六轮那套收尾", async () => {
    scripted = (round, tools) =>
      tools ? toolCall("validate", {}) : textReply("六轮用满了，我说说卡在哪。");
    const r = await runAssistant(
      { config: builtConfig, designCard: "# 游戏设计卡\n状态：调优中\n" },
      [{ role: "user", content: "查一下" }]
    );
    expect(r.reply).toContain("卡在哪");
  });
});

describe("工具轮次上限按形态分档", () => {
  // 复刻 VAL MANAGER（13,132 行）靠的是「一轮里多干几件事」：
  // 看目录 → 读那一段 → 改三处 → 再核一遍。快速模式改配置是一次写一整节，
  // 六次够用；自由模式六次刚够干一件事，所以这两档必须不一样。
  const files = {
    list: () => [{ path: "game.js", size: 10, updatedAt: "now" }],
    read: () => "var a = 1;",
    write: () => {},
    remove: () => {},
  };

  it("快速模式仍是 6 轮带工具 + 1 轮收尾", async () => {
    scripted = (_round, tools) => (tools ? toolCall("validate", {}) : textReply("交代一下现状"));
    await runAssistant({ config: builtConfig, designCard: "状态：调优中" }, [
      { role: "user", content: "继续" },
    ]);
    expect(calls.length).toBe(7);
  });

  it("自由模式给到 16 轮——不然一轮里连一件事都干不完", async () => {
    scripted = (_round, tools) =>
      tools ? toolCall("read_file", { path: "game.js" }) : textReply("交代一下现状");
    await runAssistant(
      { config: builtConfig, designCard: "状态：调优中", mode: "code", files },
      [{ role: "user", content: "接着做" }]
    );
    expect(calls.length).toBe(17);
  });
});
