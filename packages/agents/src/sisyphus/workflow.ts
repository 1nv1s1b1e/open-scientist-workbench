'use workflow'

export type { TournamentInput, TournamentResult } from '@open-scientist/schema'

// 实际 workflow 入口（placeholder — Phase 3 实现）
export async function tournamentWorkflow(_input: {
  seed: string
  projectId: string
  runId: string
}): Promise<{
  runId: string
  winningHypoId: string
  bestF1: number
  totalRounds: number
  mhdConfigPath: string | null
  observationProposal: string | null
}> {
  // 'use workflow' 体内调子 workflow + step
  // Round 1: await librarianWorkflow(input)
  // Round 2: await lookerWorkflow(input)
  // Loop: start(exploreWorkflow, ...) + await oracleWorkflow + review_leading_hypothesis (needsApproval) + await prometheusWorkflow
  // 收敛检测
  throw new Error('tournamentWorkflow not implemented — Phase 3')
}
