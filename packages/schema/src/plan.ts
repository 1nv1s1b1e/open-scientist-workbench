import { z } from 'zod'

export const PlanSchema = z.object({
  round: z.number(),
  searchParams: z.object({
    paramRange: z.record(z.string(), z.tuple([z.number(), z.number()])),
    populationSize: z.number(),
    mutationRate: z.number(),
  }),
  computeBudget: z.object({
    maxEvals: z.number(),
    parallelWorkers: z.number(),
  }),
  rationale: z.string(),
})
export type Plan = z.infer<typeof PlanSchema>

export const MhdConfigSchema = z.object({
  runId: z.string(),
  cfgPath: z.string(),
  observationProposal: z.string(),
  summary: z.string(),
})
export type MhdConfig = z.infer<typeof MhdConfigSchema>

export const PrometheusOutputSchema = z.object({
  plan: PlanSchema,
  mhdConfig: MhdConfigSchema.nullable(),
  shouldContinue: z.boolean(),
})
export type PrometheusOutput = z.infer<typeof PrometheusOutputSchema>
