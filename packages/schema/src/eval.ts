import { z } from 'zod'

export const CounterexampleSchema = z.object({
  snapshotId: z.string(),
  reason: z.string(),
  expected: z.string(),
  actual: z.string(),
})
export type Counterexample = z.infer<typeof CounterexampleSchema>

/** Optional metadata for a predicted-positive sample that can be aligned to raw observations. */
export const CandidateSnapshotSchema = z.object({
  snapshotId: z.string(),
  activeRegion: z.string(),
  timestamp: z.string(),
  wavelength: z.string(),
})
export type CandidateSnapshot = z.infer<typeof CandidateSnapshotSchema>

export const EvalResultSchema = z.object({
  hypoId: z.string(),
  f1: z.number(),
  truePositives: z.number(),
  falsePositives: z.number(),
  falseNegatives: z.number(),
  counterexamples: z.array(CounterexampleSchema),
  candidateSnapshots: z.array(CandidateSnapshotSchema).default([]),
  logs: z.string(),
  executionMs: z.number(),
})
export type EvalResult = z.infer<typeof EvalResultSchema>
