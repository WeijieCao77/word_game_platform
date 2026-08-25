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
  coverPreset: z.string().max(40).optional(),
  genre: z.string().max(12).optional(),
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

export const SimTimeModelSchema = z.object({
  turnLabel: z.string().min(1).max(10),
  cycleLabel: z.string().min(1).max(10).optional(),
  turnsPerCycle: z.number().int().min(1).max(365).optional(),
  maxCycles: z.number().int().min(1).max(200),
});

export const DriverSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("story"), startCard: IdSchema }),
  z.object({
    kind: z.literal("life"),
    time: TimeModelSchema,
    drawsPerTurn: z.number().int().min(1).max(3).optional(),
  }),
  z.object({
    kind: z.literal("sim"),
    time: SimTimeModelSchema,
    drawsPerTurn: z.number().int().min(0).max(3).optional(),
    actionPoints: z.number().int().min(1).max(20).optional(),
  }),
]);

export const VariableDefSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  initial: z.number(),
  min: z.number().optional(),
  max: z.number().optional(),
  visible: z.boolean().optional(),
  resetEachCycle: z.boolean().optional(),
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
  // 名单分组：按标签把表拆成几段（自家阵容 / 转会市场…），不配就是一张大表
  groups: z.array(z.object({ tag: NameSchema, label: NameSchema })).max(8).optional(),
  restLabel: NameSchema.optional(),
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
  target: z.object({ entityType: IdSchema, condition: ExprSchema.optional() }).optional(),
  condition: ExprSchema.optional(),
  usesPerTurn: z.number().int().min(0).max(99).optional(),
  cost: z.number().int().min(0).max(10).optional(),
  effects: z.array(EffectSchema).max(20),
  text: z.string().max(2000).optional(),
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
        text: z.string().max(2000).optional(),
        leagueResult: z.enum(["win", "loss"]).optional(),
      })
    )
    .min(1)
    .max(20),
});

export const LeagueDefSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  teams: z
    .array(z.object({ name: z.string().min(1).max(40), strength: z.number().min(0).max(1000) }))
    .min(4)
    .max(40),
  playerTeam: z.string().min(1).max(40),
  settlement: IdSchema,
  opponentKey: IdSchema.optional(),
  playoffs: z.number().int().min(1).max(40).optional(),
  resetEachCycle: z.boolean().optional(),
});

export const CurveDefSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  entityType: IdSchema,
  phase: z.enum(["turn", "cycle"]),
  condition: ExprSchema.optional(),
  effects: z.array(EffectSchema).max(20),
  text: z.string().max(2000).optional(),
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

export const InputAnswerDefSchema = z.object({
  id: IdSchema,
  keywords: z.array(z.string().min(1).max(40)).min(1).max(20),
  condition: ExprSchema.optional(),
  effects: z.array(EffectSchema).max(20).optional(),
  text: z.string().max(4000).optional(),
  goto: IdSchema.optional(),
  ending: IdSchema.optional(),
});

export const CardInputDefSchema = z.object({
  prompt: z.string().max(200).optional(),
  answers: z.array(InputAnswerDefSchema).min(1).max(40),
  fallbackText: z.string().max(2000).optional(),
});

export const CardDefSchema = z.object({
  id: IdSchema,
  title: z.string().max(60).optional(),
  condition: ExprSchema.optional(),
  weight: z.number().positive().optional(),
  priority: z.number().optional(),
  once: z.boolean().optional(),
  cooldown: z.number().min(0).max(200).optional(),
  text: TextSchema,
  image: z.string().max(300).optional(),
  textVariants: z.array(TextSchema).max(8).optional(),
  effects: z.array(EffectSchema).max(20).optional(),
  choices: z.array(ChoiceDefSchema).max(8).optional(),
  input: CardInputDefSchema.optional(),
  goto: IdSchema.optional(),
  ending: IdSchema.optional(),
  scope: z.object({ entityType: IdSchema, condition: ExprSchema.optional() }).optional(),
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
  tabLabels: z
    .object({
      overview: z.string().min(1).max(12).optional(),
      actions: z.string().min(1).max(12).optional(),
      roster: z.string().min(1).max(12).optional(),
      schedule: z.string().min(1).max(12).optional(),
      log: z.string().min(1).max(12).optional(),
    })
    .optional(),
  cycleEnd: z.string().max(2000).optional(),
  timeoutEnding: z.object({ title: NameSchema, text: z.string().max(4000).optional() }).optional(),
});

export const SearchEntryDefSchema = z.object({
  id: IdSchema,
  keywords: z.array(z.string().min(1).max(40)).min(1).max(20),
  condition: ExprSchema.optional(),
  text: z.string().min(1).max(4000),
  image: z.string().max(300).optional(),
  effects: z.array(EffectSchema).max(20).optional(),
});

export const SearchDefSchema = z.object({
  label: z.string().min(1).max(12).optional(),
  prompt: z.string().max(200).optional(),
  fallbackText: z.string().max(2000).optional(),
  side: z.enum(["left", "right"]).optional(),
  entries: z.array(SearchEntryDefSchema).min(1).max(200),
});

export const NotebookItemDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(40),
  category: z.string().min(1).max(12).optional(),
  condition: ExprSchema.optional(),
  text: z.string().min(1).max(4000),
  image: z.string().max(300).optional(),
});

export const NotebookDefSchema = z.object({
  label: z.string().min(1).max(12).optional(),
  side: z.enum(["left", "right"]).optional(),
  items: z.array(NotebookItemDefSchema).min(1).max(120),
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
  search: SearchDefSchema.optional(),
  notebook: NotebookDefSchema.optional(),
  leagues: z.array(LeagueDefSchema).max(6).optional(),
  entityTypes: z.array(EntityTypeDefSchema).max(10).optional(),
  entities: z.array(EntityInstanceSchema).max(200).optional(),
  derived: z.array(DerivedDefSchema).max(50).optional(),
  actions: z.array(ActionDefSchema).max(30).optional(),
  settlements: z.array(SettlementDefSchema).max(20).optional(),
  curves: z.array(CurveDefSchema).max(30).optional(),
});

export type GameConfigInput = z.input<typeof GameConfigSchema>;

/** 导出 JSON Schema（供外部工具/调试；AI system prompt 用手写精简版说明） */
export function gameConfigJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(GameConfigSchema) as Record<string, unknown>;
}
