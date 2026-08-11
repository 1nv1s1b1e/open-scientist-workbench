import { z } from 'zod'
import { PhenomenonInputSchema } from './phenomenon.ts'

export const PROJECT_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/

export const ProjectNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    PROJECT_NAME_REGEX,
    'Project name may only contain letters, digits, hyphens, and underscores',
  )

export const CreateProjectRequestSchema = z.object({
  name: ProjectNameSchema,
  config: z
    .object({
      mcp: z.record(z.string(), z.unknown()).optional(),
      skills: z.array(z.string()).optional(),
      prompts: z.string().optional(),
    })
    .optional(),
})
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>

export const StartRunRequestSchema = z.object({
  // Scientific mode is driven by phenomenon; seed is legacy compatibility.
  seed: z.string().min(1).optional(),
  context: z.string().optional(),
  phenomenon: PhenomenonInputSchema.optional(),
  maxRounds: z.number().int().min(1).max(12).optional(),
  executionMode: z.enum(['model-assisted', 'local-grounded']).optional(),
  // 可选：引用 settings.modelAliases 中的某个 alias 名（如 "qwen-80b"）。
  // 传了 alias 时忽略 settings.models.sisyphus/default，从 alias 解析完整 config。
  // 空值继续表示使用默认模型，兼容旧前端下拉框。
  modelAlias: z
    .string()
    .transform((value) => (value.length > 0 ? value : undefined))
    .optional(),
}).refine((value) => Boolean(value.seed || value.phenomenon), {
  message: 'body.phenomenon is required for scientific mode',
  path: ['phenomenon'],
})
export type StartRunRequest = z.infer<typeof StartRunRequestSchema>

export const ApproveRequestSchema = z.object({
  approved: z.boolean(),
  reason: z.string().optional(),
  feedback: z.string().optional(),
})
export type ApproveRequest = z.infer<typeof ApproveRequestSchema>

export const SteerRequestSchema = z.object({
  content: z.string().min(1),
  mode: z.enum(['steering', 'follow-up']).default('steering'),
})
export type SteerRequest = z.infer<typeof SteerRequestSchema>

export const TournamentResultSchema = z.object({
  runId: z.string(),
  winningHypoId: z.string(),
  bestF1: z.number(),
  totalRounds: z.number(),
  mhdConfigPath: z.string().nullable(),
  proposalPath: z.string().nullable(),
})
export type TournamentResult = z.infer<typeof TournamentResultSchema>
