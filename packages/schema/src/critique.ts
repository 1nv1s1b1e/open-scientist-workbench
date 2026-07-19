import { z } from 'zod'
import { HypothesisSchema } from './hypothesis.ts'

export const CritiqueSchema = z.object({
  hypoId: z.string(),
  critiqueText: z.string(),
  rationale: z.string(),
  severity: z.enum(['fatal', 'major', 'minor']),
  round: z.number(),
})
export type Critique = z.infer<typeof CritiqueSchema>

export const MutationSchema = z.object({
  parentHypoId: z.string(),
  mutatedHypothesis: HypothesisSchema,
  mutationRationale: z.string(),
  round: z.number(),
})
export type Mutation = z.infer<typeof MutationSchema>

export const OracleOutputSchema = z.object({
  critiques: z.array(CritiqueSchema),
  mutations: z.array(MutationSchema),
  eliminatedIds: z.array(z.string()),
  winningHypoId: z.string().nullable(),
})
export type OracleOutput = z.infer<typeof OracleOutputSchema>
