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

/**
 * Human-in-the-loop gate mode for a run. `off` (default) keeps the loop fully
 * automatic — closure never waits for a human. `plan_review` arms an approval
 * gate at the D.route continuation decision: the loop pauses there until
 * POST /approve responds or the timeout auto-proceeds (fail-open), so the run
 * can never be stalled forever by an absent human.
 */
export const HumanGateModeSchema = z.enum(['off', 'plan_review'])
export type HumanGateMode = z.infer<typeof HumanGateModeSchema>

export const StartRunRequestSchema = z
  .object({
    // Scientific mode is driven by phenomenon; seed is legacy compatibility.
    seed: z.string().min(1).optional(),
    context: z.string().optional(),
    phenomenon: PhenomenonInputSchema.optional(),
    maxRounds: z.number().int().min(1).max(12).optional(),
    executionMode: z.enum(['model-assisted', 'local-grounded']).optional(),
    humanGate: HumanGateModeSchema.default('off'),
    humanGateTimeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
    // 可选：引用 settings.modelAliases 中的某个 alias 名（如 "qwen-80b"）。
    // 传了 alias 时忽略 settings.models.sisyphus/default，从 alias 解析完整 config。
    // 空值继续表示使用默认模型，兼容旧前端下拉框。
    modelAlias: z
      .string()
      .transform((value) => (value.length > 0 ? value : undefined))
      .optional(),
  })
  .superRefine((value, context) => {
    if (!value.seed && !value.phenomenon) {
      context.addIssue({
        code: 'custom',
        message: 'body.phenomenon is required for scientific mode',
        path: ['phenomenon'],
      })
    }
    if (value.executionMode === 'local-grounded' && !value.phenomenon) {
      context.addIssue({
        code: 'custom',
        message: 'local-grounded execution requires body.phenomenon',
        path: ['phenomenon'],
      })
    }
  })
export type StartRunRequest = z.infer<typeof StartRunRequestSchema>

export const ResumeRunRequestSchema = z.object({
  seed: z.string().optional(),
  scientific: z.boolean().optional(),
  modelAlias: z.string().min(1).optional(),
})
export type ResumeRunRequest = z.infer<typeof ResumeRunRequestSchema>

/**
 * Human-in-the-loop gate mode for a run. `off` (default) keeps the loop fully
 * automatic — closure never waits for a human. `plan_review` arms an approval
 * gate at the D.route continuation decision: the loop pauses there until
 * POST /approve responds or the timeout auto-proceeds (fail-open), so the run
 * can never be stalled forever by an absent human.
 */
export const ApproveRequestSchema = z.object({
  approved: z.boolean(),
  reason: z.string().optional(),
  feedback: z.string().optional(),
  gateId: z.string().min(1).optional(),
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
