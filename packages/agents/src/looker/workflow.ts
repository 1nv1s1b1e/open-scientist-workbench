'use workflow'

import type { EvidenceAlignment } from '@open-scientist/schema'

export async function lookerWorkflow(_input: {
  projectId: string
  hypoId: string
  activeRegion: string
  timestamp: string
  wavelength: string
}): Promise<EvidenceAlignment> {
  throw new Error('lookerWorkflow not implemented — Phase 3')
}
