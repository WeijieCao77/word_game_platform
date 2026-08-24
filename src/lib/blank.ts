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

export function blankSim(title: string): GameConfig {
  return {
    schemaVersion: 1,
    meta: {
      title,
      description: "",
      intro: "（这里是开场白。跟右边的 AI 策划聊聊你的经营想法，或者直接改配置。）",
    },
    driver: {
      kind: "sim",
      time: { turnLabel: "回合", cycleLabel: "年", turnsPerCycle: 10, maxCycles: 3 },
    },
    vars: [{ id: "资金", name: "资金", initial: 50, min: 0 }],
    entityTypes: [
      {
        id: "成员",
        name: "成员",
        attributes: [{ id: "能力", name: "能力", min: 1, max: 99 }],
      },
    ],
    entities: [
      { id: "示例成员", type: "成员", name: "示例成员", attrs: { 能力: 50 }, tags: ["主力"] },
    ],
    derived: [{ id: "实力", name: "实力", expr: 'avg("成员", "能力", "主力")' }],
    actions: [
      {
        id: "培训",
        name: "培训",
        description: "花 3 资金训练一名成员",
        target: { entityType: "成员" },
        condition: "资金 >= 3",
        effects: [
          { ref: "资金", op: "add", value: "-3" },
          { ref: "target.能力", op: "add", value: "randint(1, 3)" },
        ],
        text: "培训了 {target.name}，能力 → {target.能力}",
      },
    ],
    settlements: [
      {
        id: "经营结算",
        name: "经营结算",
        compute: [{ id: "收成", expr: "round(实力 / 10) + randint(-2, 4)" }],
        outcomes: [
          {
            id: "结算",
            condition: "1",
            effects: [{ ref: "资金", op: "add", value: "收成" }],
            text: "本回合经营收入 {收成}。（把我改成你的比赛/营业结算）",
          },
        ],
      },
    ],
    cards: [
      {
        id: "示例事件",
        weight: 1,
        text: "平静的一回合。（把我改成你的随机事件卡）",
      },
    ],
    endings: [
      { id: "破产", title: "资金枯竭", kind: "defeat", condition: "资金 <= 0", text: "（示例失败结局）" },
    ],
    text: { timeoutEnding: { title: "经营落幕", text: "时间到了。（示例兜底结局）" } },
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
