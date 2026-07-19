import { z } from 'zod'
import { HypothesisSchema } from './hypothesis.js'

export const ConvergenceEntrySchema = z.object({
  round: z.number(),
  bestF1: z.number(),
  count: z.number(),
})
export type ConvergenceEntry = z.infer<typeof ConvergenceEntrySchema>

export const RuntimeContextSchema = z.object({
  projectId: z.string(),
  runId: z.string(),
  round: z.number(),
  hypotheses: z.array(HypothesisSchema),
  leadingHypoId: z.string().nullable(),
  bestF1: z.number(),
  convergenceHistory: z.array(ConvergenceEntrySchema),
  userFeedback: z.string().nullable(),
  sessionId: z.string().optional(),
})
export type RuntimeContext = z.infer<typeof RuntimeContextSchema>

export const TournamentInputSchema = z.object({
  seed: z.string(),
  projectId: z.string(),
  runId: z.string(),
})
export type TournamentInput = z.infer<typeof TournamentInputSchema>
