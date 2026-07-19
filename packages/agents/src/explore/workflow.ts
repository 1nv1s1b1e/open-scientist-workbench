'use workflow'

import type { EvalResult } from '@open-scientist/schema'

export async function exploreWorkflow(_input: {
  projectId: string
  hypoId: string
  pythonCode: string
}): Promise<EvalResult> {
  throw new Error('exploreWorkflow not implemented — Phase 3')
}
