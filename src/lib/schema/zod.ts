import { z } from "zod";

// 结构校验层（对应 types.ts）。AI 生成与用户保存都必须先过这一层，
// 再过 validate.ts 的语义校验。

const ID_RE = /^[A-Za-z_一-鿿][A-Za-z0-9_一-鿿]*$/;

const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(ID_RE, "id 只能由字母、数字、下划线或汉字组成，且不能以数字开头");

const NameSchema = z.string().min(1).max(80);
const ExprSchema = z.string().min(1).max(1000);
const TextSchema = z.string().max(2000);

export const EffectSchema = z
  .object({
    ref: z.string().min(1).max(128),
    op: z.enum(["add", "set", "add_tag", "remove_tag"]),
    value: ExprSchema.optional(),
    tag: IdSchema.optional(),
  })
  .refine((e) => (e.op === "add" || e.op === "set" ? e.value !== undefined : e.tag !== undefined), {
    message: "数值效果需要 value，标签效果需要 tag",
  });

export const GameMetaSchema = z.object({
  title: z.string().min(1).max(60),
  description: z.string().max(500).optional(),
  author: z.string().max(40).optional(),
  intro: z.string().max(4000).optional(),
});

export const TimeModelSchema = z.object({
  turnLabel: z.string().min(1).max(10),
  cycleLabel: z.string().min(1).max(10).optional(),
  turnsPerCycle: z.number().int().min(1).max(365).optional(),
  maxCycles: z.number().int().min(1).max(200).optional(),
});

export const VariableDefSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  initial: z.number(),
  min: z.number().optional(),
  max: z.number().optional(),
  resetEachCycle: z.boolean().optional(),
  visible: z.boolean().optional(),
});

export const AttributeDefSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  min: z.number().optional(),
  max: z.number().optional(),
  visible: z.boolean().optional(),
});

export const EntityTypeDefSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  attributes: z.array(AttributeDefSchema).min(1).max(30),
});

export const EntityInstanceSchema = z.object({
  id: IdSchema,
  type: IdSchema,
  name: NameSchema,
  attrs: z.record(IdSchema, z.number()),
  tags: z.array(IdSchema).max(20).optional(),
});

export const DerivedDefSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  expr: ExprSchema,
  visible: z.boolean().optional(),
});

export const ActionDefSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  description: z.string().max(300).optional(),
  target: z
    .object({ entityType: IdSchema, condition: ExprSchema.optional() })
    .optional(),
  condition: ExprSchema.optional(),
  usesPerTurn: z.number().int().min(0).max(99).optional(),
  effects: z.array(EffectSchema).max(20),
  text: TextSchema.optional(),
});

export const SettlementDefSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  every: z.number().int().min(1).max(365).optional(),
  condition: ExprSchema.optional(),
  data: z.array(z.record(IdSchema, z.union([z.number(), z.string().max(120)]))).max(400).optional(),
  compute: z.array(z.object({ id: IdSchema, expr: ExprSchema })).max(30).optional(),
  outcomes: z
    .array(
      z.object({
        id: IdSchema,
        condition: ExprSchema,
        effects: z.array(EffectSchema).max(20),
        text: TextSchema.optional(),
      })
    )
    .min(1)
    .max(20),
});

export const EventDefSchema = z.object({
  id: IdSchema,
  weight: z.number().positive(),
  condition: ExprSchema.optional(),
  scope: z.object({ entityType: IdSchema, condition: ExprSchema.optional() }).optional(),
  effects: z.array(EffectSchema).max(20).optional(),
  text: TextSchema,
});

export const EventPoolDefSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  drawsPerTurn: z.number().int().min(0).max(10),
  condition: ExprSchema.optional(),
  events: z.array(EventDefSchema).min(1).max(200),
});

export const CurveDefSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  entityType: IdSchema,
  phase: z.enum(["turn", "cycle"]),
  condition: ExprSchema.optional(),
  effects: z.array(EffectSchema).max(20),
  text: TextSchema.optional(),
});

export const EndingDefSchema = z.object({
  id: IdSchema,
  title: NameSchema,
  kind: z.enum(["victory", "defeat", "neutral"]),
  condition: ExprSchema,
  text: TextSchema.optional(),
  priority: z.number().int().min(-100).max(100).optional(),
});

export const GameTextSchema = z.object({
  turnHeader: TextSchema.optional(),
  cycleEnd: TextSchema.optional(),
  timeoutEnding: z.object({ title: NameSchema, text: TextSchema.optional() }).optional(),
});

export const GameConfigSchema = z.object({
  schemaVersion: z.literal(1),
  meta: GameMetaSchema,
  time: TimeModelSchema,
  variables: z.array(VariableDefSchema).max(50),
  entityTypes: z.array(EntityTypeDefSchema).max(10),
  entities: z.array(EntityInstanceSchema).max(200),
  derived: z.array(DerivedDefSchema).max(50).optional(),
  actions: z.array(ActionDefSchema).min(1).max(30),
  settlements: z.array(SettlementDefSchema).max(20).optional(),
  eventPools: z.array(EventPoolDefSchema).max(10).optional(),
  curves: z.array(CurveDefSchema).max(30).optional(),
  endings: z.array(EndingDefSchema).min(1).max(30),
  text: GameTextSchema.optional(),
});

export type GameConfigInput = z.input<typeof GameConfigSchema>;

/** 导出 JSON Schema，喂给 AI 的 system prompt 与外部工具 */
export function gameConfigJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(GameConfigSchema) as Record<string, unknown>;
}
