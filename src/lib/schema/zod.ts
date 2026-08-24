import { z } from "zod";

// 结构校验层（对应 types.ts）。AI 生成与用户保存都必须先过这一层，
// 再过 validate.ts 的语义校验。

const ID_RE = /^(?!__)[A-Za-z_一-鿿][A-Za-z0-9_一-鿿]*$/;

const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(ID_RE, "id 只能由字母、数字、下划线或汉字组成，不能以数字或双下划线开头");

const NameSchema = z.string().min(1).max(80);
const ExprSchema = z.string().min(1).max(1000);
const TextSchema = z.string().min(1).max(4000);

export const EffectSchema = z.object({
  ref: IdSchema,
  op: z.enum(["add", "set"]),
  value: ExprSchema,
});

export const GameMetaSchema = z.object({
  title: z.string().min(1).max(60),
  description: z.string().max(500).optional(),
  author: z.string().max(40).optional(),
  intro: z.string().max(4000).optional(),
});

export const GameThemeSchema = z.object({
  preset: z.enum(["paper", "dark", "terminal"]).optional(),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "accent 应为 #rrggbb 格式")
    .optional(),
});

export const TimeModelSchema = z.object({
  label: z.string().min(1).max(10),
  start: z.number(),
  step: z.number().positive(),
  max: z.number(),
});

export const DriverSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("story"), startCard: IdSchema }),
  z.object({
    kind: z.literal("life"),
    time: TimeModelSchema,
    drawsPerTurn: z.number().int().min(1).max(3).optional(),
  }),
]);

export const VariableDefSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  initial: z.number(),
  min: z.number().optional(),
  max: z.number().optional(),
  visible: z.boolean().optional(),
});

export const ChoiceDefSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  condition: ExprSchema.optional(),
  effects: z.array(EffectSchema).max(20).optional(),
  text: z.string().max(4000).optional(),
  goto: IdSchema.optional(),
  ending: IdSchema.optional(),
});

export const CardDefSchema = z.object({
  id: IdSchema,
  title: z.string().max(60).optional(),
  condition: ExprSchema.optional(),
  weight: z.number().positive().optional(),
  priority: z.number().optional(),
  once: z.boolean().optional(),
  text: TextSchema,
  effects: z.array(EffectSchema).max(20).optional(),
  choices: z.array(ChoiceDefSchema).max(8).optional(),
  goto: IdSchema.optional(),
  ending: IdSchema.optional(),
});

export const EndingDefSchema = z.object({
  id: IdSchema,
  title: NameSchema,
  kind: z.enum(["victory", "defeat", "neutral"]),
  condition: ExprSchema.optional(),
  text: z.string().max(4000).optional(),
  priority: z.number().int().min(-100).max(100).optional(),
});

export const GameTextSchema = z.object({
  turnHeader: z.string().max(200).optional(),
  timeoutEnding: z.object({ title: NameSchema, text: z.string().max(4000).optional() }).optional(),
});

export const GameConfigSchema = z.object({
  schemaVersion: z.literal(1),
  meta: GameMetaSchema,
  theme: GameThemeSchema.optional(),
  driver: DriverSchema,
  vars: z.array(VariableDefSchema).max(30),
  cards: z.array(CardDefSchema).min(1).max(500),
  endings: EndingDefSchema.array().min(1).max(50),
  text: GameTextSchema.optional(),
});

export type GameConfigInput = z.input<typeof GameConfigSchema>;

/** 导出 JSON Schema（供外部工具/调试；AI system prompt 用手写精简版说明） */
export function gameConfigJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(GameConfigSchema) as Record<string, unknown>;
}
