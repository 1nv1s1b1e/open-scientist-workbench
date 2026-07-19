import { z } from 'zod'

export const HypothesisStatus = z.enum([
  'candidate',
  'evaluated',
  'critiqued',
  'mutated',
  'winner',
  'eliminated',
])
export type HypothesisStatus = z.infer<typeof HypothesisStatus>

export const HypothesisSchema = z.object({
  id: z.string(),
  statement: z.string(),
  pythonCode: z.string(),
  parentId: z.string().nullable(),
  round: z.number(),
  f1: z.number().nullable(),
  status: HypothesisStatus.default('candidate'),
  createdAt: z.string(),
})
export type Hypothesis = z.infer<typeof HypothesisSchema>

export const HypothesisPoolSchema = z.object({
  hypotheses: z.array(HypothesisSchema),
  rationale: z.string(),
})
export type HypothesisPool = z.infer<typeof HypothesisPoolSchema>
