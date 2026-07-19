'use workflow'

import type { PrometheusOutput } from '@open-scientist/schema'

export async function prometheusWorkflow(_input: {
  projectId: string
  runId: string
  round: number
  evals: Array<{ hypoId: string; f1: number }>
  userFeedback: string | null
  isFinalRound: boolean
  winningHypoId?: string
}): Promise<PrometheusOutput> {
  throw new Error('prometheusWorkflow not implemented — Phase 3')
}
