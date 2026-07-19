import { z } from 'zod'

export const CreateProjectRequestSchema = z.object({
  name: z.string().min(1).max(64),
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
  seed: z.string().min(1),
  context: z.string().optional(),
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
  observationProposal: z.string().nullable(),
})
export type TournamentResult = z.infer<typeof TournamentResultSchema>
