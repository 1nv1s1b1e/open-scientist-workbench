'use workflow'

import type { HypothesisPool } from '@open-scientist/schema'

export async function librarianWorkflow(_input: {
  seed: string
  projectId: string
}): Promise<HypothesisPool> {
  // 'use workflow' 体内调 agent.stream + steps (helix-query, bash write Python)
  throw new Error('librarianWorkflow not implemented — Phase 3')
}
