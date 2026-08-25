"use client";

// 设计卡页签：一块纯文本编辑区，作者和 AI 策划共同维护的设计共识。
// AI 每轮对话会读它、也会改写它（含自动维护的素材清单），作者可以直接手改。
// 改提示文案 → 只看这里；设计卡的模板与状态解析在 src/lib/ai/designcard.ts。

export default function DesignTab({
  designCard,
  onChange,
}: {
  designCard: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <textarea
      className="config-editor"
      value={designCard}
      placeholder={
        "《游戏设计卡》——你和 AI 策划共同维护的设计共识。\n" +
        "建议包含：题材与基调 / 核心变量 / 调度方式 / 卡池规划 / 结局设计。\n" +
        "跟 AI 对话时它会读取并更新这里。"
      }
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
