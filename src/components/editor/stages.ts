// 创作流程的展示常量：设计卡状态 → 阶段条怎么画、哪个职能在服务、徽章什么颜色。
// 想改流程文案、增删阶段、调整职能配色 → 只看这里；
// 状态值本身由 lib/ai/designcard.ts 的设计卡解析产出，两边要对得上。

/** 职能 → 徽章样式类（样式定义在 src/styles/editor.css） */
export const ROLE_CLASS: Record<string, string> = { 主策: "lead", 剧情: "story", 人设: "chara", 数值: "num" };

/** 流程状态 → 阶段条展示（当前步 + 活跃职能 + 一句话说明） */
export const STAGE_VIEW: Record<string, { step: number; roles: string[]; hint: string }> = {
  需求对齐中: { step: 0, roles: ["主策", "剧情", "人设"], hint: "创意策划阶段：聊清题材、角色与玩法方向" },
  方案待确认: { step: 1, roles: ["主策"], hint: "方案已就绪，等你拍板——同意后团队开始搭建" },
  已确认: { step: 2, roles: ["数值", "主策"], hint: "搭建阶段：生成配置、校验、模拟配平" },
  调优中: { step: 3, roles: ["数值", "剧情"], hint: "调优阶段：直接提修改意见，团队改完用模拟验证" },
};

export const STAGE_STEPS = ["创意对齐", "方案确认", "搭建", "调优"];
