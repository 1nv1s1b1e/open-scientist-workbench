'use workflow'

import type { OracleOutput } from '@open-scientist/schema'

export async function oracleWorkflow(_input: {
  projectId: string
  hypotheses: Array<{ id: string; statement: string; pythonCode: string; f1: number | null }>
  evals: Array<{ hypoId: string; f1: number; counterexamples: unknown[] }>
  round: number
}): Promise<OracleOutput> {
  throw new Error('oracleWorkflow not implemented — Phase 3')
}
