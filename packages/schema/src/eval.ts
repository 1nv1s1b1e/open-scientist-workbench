import { z } from 'zod'

export const CounterexampleSchema = z.object({
  snapshotId: z.string(),
  reason: z.string(),
  expected: z.string(),
  actual: z.string(),
})
export type Counterexample = z.infer<typeof CounterexampleSchema>

export const EvalResultSchema = z.object({
  hypoId: z.string(),
  f1: z.number(),
  truePositives: z.number(),
  falsePositives: z.number(),
  falseNegatives: z.number(),
  counterexamples: z.array(CounterexampleSchema),
  logs: z.string(),
  executionMs: z.number(),
})
export type EvalResult = z.infer<typeof EvalResultSchema>
