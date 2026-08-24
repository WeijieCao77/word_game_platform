import { GameConfig } from "@/lib/schema";

// 新建游戏的最小可跑配置（创建后交给 AI 策划或作者改）

export function blankLife(title: string): GameConfig {
  return {
    schemaVersion: 1,
    meta: {
      title,
      description: "",
      intro: "（这里是开场白。跟右边的 AI 策划聊聊你的想法，或者直接改配置。）",
    },
    driver: { kind: "life", time: { label: "岁", start: 0, step: 1, max: 60 } },
    vars: [{ id: "心情", name: "心情", initial: 50, min: 0, max: 100 }],
    cards: [
      {
        id: "示例事件",
        title: "示例：普通的一年",
        weight: 1,
        text: "平平无奇的一年过去了。（把我改成你的第一张事件卡吧）",
        effects: [{ ref: "心情", op: "add", value: "randint(-5, 5)" }],
      },
    ],
    endings: [
      {
        id: "示例结局",
        title: "心灰意冷",
        kind: "defeat",
        condition: "心情 <= 0",
        text: "（示例结局：心情归零时触发）",
      },
    ],
    text: { timeoutEnding: { title: "岁月尽头", text: "时间到了，故事自然结束。" } },
  };
}

export function blankStory(title: string): GameConfig {
  return {
    schemaVersion: 1,
    meta: {
      title,
      description: "",
      intro: "（这里是开场白。跟右边的 AI 策划聊聊你的想法，或者直接改配置。）",
    },
    driver: { kind: "story", startCard: "开始" },
    vars: [],
    cards: [
      {
        id: "开始",
        title: "第一幕",
        text: "故事从这里开始。（把我改成你的第一段剧情）",
        choices: [
          { id: "a", label: "选项 A", ending: "结束" },
          { id: "b", label: "选项 B", ending: "结束" },
        ],
      },
    ],
    endings: [{ id: "结束", title: "完", kind: "neutral", text: "（示例结局）" }],
  };
}
