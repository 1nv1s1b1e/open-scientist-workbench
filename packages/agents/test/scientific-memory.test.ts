import { describe, expect, it } from 'vite-plus/test'
import type { MemoryEntry } from '@open-scientist/schema'

import {
  enforceMemoryWritePolicy,
  memoryPolicyForAgent,
  selectMemoryForAgent,
  selectMemoryForStage,
} from '../src/scientific-loop/memory-policy.ts'

function memory(memoryId: string, overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    memoryId,
    layer: 'semantic',
    kind: 'evidence',
    summary: memoryId,
    namespace: ['project-1', 'semantic'],
    tags: [],
    sourceIds: [],
    hypothesisIds: [],
    evidenceIds: [],
    taskIds: [],
    artifactIds: [],
    processingRunIds: [],
    triggeredBy: [],
    verificationStatus: 'verified',
    projectId: 'project-1',
    runId: 'run-1',
    round: 1,
    fingerprint: `fingerprint-${memoryId}`,
    utility: 0.5,
    createdAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  }
}

describe('four-layer scientific memory policy', () => {
  it('gives C only verified semantic evidence, counterexamples, and revisions', () => {
    const selected = selectMemoryForStage(
      [
        memory('low', { utility: 0.1 }),
        memory('counterexample', { kind: 'counterexample', utility: 0.9 }),
        memory('revision', { kind: 'revision', utility: 0.8 }),
        memory('unverified', { verificationStatus: 'unverified', utility: 1 }),
        memory('procedure', {
          layer: 'procedural-data',
          kind: 'processing-run',
          utility: 1,
        }),
        memory('decision', {
          layer: 'episodic',
          kind: 'decision',
          utility: 1,
        }),
      ],
      'oracle',
      2,
    )

    expect(selected.map((entry) => entry.memoryId)).toEqual(['counterexample', 'revision'])
  })

  it('scopes an agent read to declared layers and kinds', () => {
    const policy = memoryPolicyForAgent('timeseries-analysis')
    const selected = selectMemoryForAgent(
      [
        memory('snapshot', {
          layer: 'procedural-data',
          kind: 'data-snapshot',
          utility: 0.9,
        }),
        memory('processing', {
          layer: 'procedural-data',
          kind: 'processing-run',
          utility: 0.8,
        }),
        memory('literature', {
          layer: 'semantic',
          kind: 'lesson',
          utility: 1,
        }),
      ],
      policy,
    )

    expect(selected.map((entry) => entry.memoryId)).toEqual(['snapshot', 'processing'])
  })

  it('rejects writes outside the agent policy instead of persisting them', () => {
    const policy = memoryPolicyForAgent('history-search')
    const result = enforceMemoryWritePolicy(
      [
        memory('historical-evidence', { kind: 'evidence' }),
        memory('unauthorized-hypothesis', { kind: 'hypothesis' }),
      ],
      policy,
    )

    expect(result.accepted.map((entry) => entry.memoryId)).toEqual(['historical-evidence'])
    expect(result.rejected).toEqual([
      expect.objectContaining({
        memoryId: 'unauthorized-hypothesis',
        reason: 'memory kind hypothesis is not writable by this agent',
      }),
    ])
  })
})
