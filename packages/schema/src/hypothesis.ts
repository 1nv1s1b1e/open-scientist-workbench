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

/**
 * Optional structured mechanism mix for the natural-language scientific path.
 * The legacy `mechanism` string remains required so tournament callers keep
 * their original contract.
 */
export const HypothesisMechanismComponentSchema = z.object({
  mechanism: z.string().min(1),
  role: z.enum(['dominant', 'secondary', 'coupled', 'unknown']),
  contribution: z.number().min(0).max(1).optional(),
})


export const HypothesisSchema = z.object({
  id: z.string(),
  statement: z.string(),
  mechanism: z.string().min(1),
  mechanismComposition: z.array(HypothesisMechanismComponentSchema).min(1).max(4).optional(),
  predictions: z.array(z.string().min(1)).min(1),
  falsificationConditions: z.array(z.string().min(1)).min(1),
  sourceIds: z.array(z.string().min(1)),
  pythonCode: z.string(),
  parentId: z.string().nullable(),
  round: z.number(),
  f1: z.number().nullable(),
  status: HypothesisStatus.default('candidate'),
  createdAt: z.string(),
})
export type Hypothesis = z.infer<typeof HypothesisSchema>

export const HypothesisPoolSchema = z.object({
  hypotheses: z.array(HypothesisSchema).min(1),
  rationale: z.string(),
})
export type HypothesisPool = z.infer<typeof HypothesisPoolSchema>

/**
 * Scientific phenomenon analysis has its own contract.  In particular it
 * must not manufacture the legacy tournament `pythonCode`/`f1` fields merely
 * to satisfy a schema: those fields are not executed by the scientific loop
 * and made a real model result look like placeholder content.
 *
 * The scientific path may return an empty pool when retrieval cannot ground a
 * candidate.  A-stage will then stop with an explicit correction instead of
 * inventing a mechanism.
 */
export const ScientificHypothesisCandidateSchema = HypothesisSchema.omit({
  pythonCode: true,
  f1: true,
}).extend({
  status: z.literal('candidate').default('candidate'),
})

export const ScientificHypothesisPoolSchema = z.object({
  hypotheses: z.array(ScientificHypothesisCandidateSchema),
  rationale: z.string().min(1),
})
export type ScientificHypothesisPool = z.infer<typeof ScientificHypothesisPoolSchema>
