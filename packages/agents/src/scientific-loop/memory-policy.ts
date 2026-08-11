import type {
  MemoryEntry,
  MemoryKind,
  MemoryLayer,
} from '@open-scientist/schema'

export type ScientificLoopStage = 'A' | 'B' | 'C' | 'D'

export interface ScientificMemoryPolicy {
  readLayers: readonly MemoryLayer[]
  readKinds: readonly MemoryKind[]
  writeLayers: readonly MemoryLayer[]
  writeKinds: readonly MemoryKind[]
  requireVerified: boolean
  maxItems: number
}

export interface RejectedMemoryWrite {
  memoryId: string
  reason: string
}

const STAGE_POLICIES: Record<ScientificLoopStage, ScientificMemoryPolicy> = {
  A: {
    readLayers: ['working', 'semantic'],
    readKinds: [
      'phenomenon',
      'hypothesis',
      'evidence',
      'counterexample',
      'revision',
      'lesson',
    ],
    writeLayers: ['semantic', 'episodic'],
    writeKinds: ['hypothesis', 'revision', 'failure', 'lesson'],
    requireVerified: true,
    maxItems: 16,
  },
  B: {
    readLayers: ['working', 'episodic', 'semantic', 'procedural-data'],
    readKinds: [
      'phenomenon',
      'hypothesis',
      'evidence',
      'counterexample',
      'validation-task',
      'failure',
      'data-snapshot',
      'processing-run',
      'artifact',
    ],
    writeLayers: ['episodic', 'semantic', 'procedural-data'],
    writeKinds: [
      'evidence',
      'counterexample',
      'validation-task',
      'failure',
      'lesson',
      'data-snapshot',
      'processing-run',
      'artifact',
    ],
    requireVerified: false,
    maxItems: 24,
  },
  C: {
    readLayers: ['semantic'],
    readKinds: ['evidence', 'counterexample', 'revision'],
    writeLayers: ['semantic', 'episodic'],
    writeKinds: ['revision', 'decision', 'failure', 'lesson'],
    requireVerified: true,
    maxItems: 12,
  },
  D: {
    readLayers: ['episodic', 'semantic', 'procedural-data'],
    readKinds: [
      'hypothesis',
      'evidence',
      'counterexample',
      'revision',
      'decision',
      'failure',
      'processing-run',
      'artifact',
    ],
    writeLayers: ['working', 'episodic'],
    writeKinds: ['validation-task', 'decision', 'failure', 'lesson'],
    requireVerified: true,
    maxItems: 16,
  },
}

const AGENT_POLICIES: Record<string, ScientificMemoryPolicy> = {
  'history-search': {
    ...STAGE_POLICIES.B,
    readLayers: ['working', 'semantic'],
    readKinds: [
      'phenomenon',
      'hypothesis',
      'evidence',
      'counterexample',
      'validation-task',
    ],
    writeLayers: ['semantic', 'episodic'],
    writeKinds: ['evidence', 'counterexample', 'validation-task', 'failure'],
    maxItems: 16,
  },
  'literature-retrieval': {
    ...STAGE_POLICIES.B,
    readLayers: ['working', 'semantic'],
    readKinds: ['phenomenon', 'hypothesis', 'evidence', 'counterexample'],
    writeLayers: ['semantic', 'episodic'],
    writeKinds: ['evidence', 'counterexample', 'failure', 'lesson'],
    maxItems: 16,
  },
  'source-audit': {
    ...STAGE_POLICIES.B,
    readLayers: ['working', 'procedural-data'],
    readKinds: ['phenomenon', 'data-snapshot', 'artifact', 'validation-task'],
    writeLayers: ['procedural-data', 'episodic'],
    writeKinds: ['data-snapshot', 'artifact', 'failure', 'lesson'],
    maxItems: 12,
  },
  'timeseries-analysis': {
    ...STAGE_POLICIES.B,
    readLayers: ['working', 'semantic', 'procedural-data'],
    readKinds: [
      'phenomenon',
      'hypothesis',
      'evidence',
      'validation-task',
      'data-snapshot',
      'processing-run',
      'artifact',
    ],
    writeLayers: ['semantic', 'procedural-data', 'episodic'],
    writeKinds: [
      'evidence',
      'counterexample',
      'processing-run',
      'artifact',
      'failure',
    ],
    maxItems: 20,
  },
  'counterexample-search': {
    ...STAGE_POLICIES.B,
    readLayers: ['working', 'semantic', 'procedural-data'],
    writeLayers: ['semantic', 'episodic'],
    writeKinds: ['evidence', 'counterexample', 'validation-task', 'failure'],
    maxItems: 20,
  },
  'fact-check': {
    ...STAGE_POLICIES.C,
    readLayers: ['episodic', 'semantic', 'procedural-data'],
    readKinds: [
      'hypothesis',
      'evidence',
      'counterexample',
      'revision',
      'failure',
      'data-snapshot',
      'processing-run',
      'artifact',
    ],
    writeLayers: ['episodic', 'semantic'],
    writeKinds: ['revision', 'failure', 'lesson'],
    maxItems: 24,
  },
}

function sortMemory(entries: readonly MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((left, right) => {
    if (right.utility !== left.utility) return right.utility - left.utility
    if (right.round !== left.round) return right.round - left.round
    return right.createdAt.localeCompare(left.createdAt)
  })
}

export function memoryPolicyForStage(
  stage: ScientificLoopStage,
): ScientificMemoryPolicy {
  return STAGE_POLICIES[stage]
}

export function memoryPolicyForAgent(agentId: string): ScientificMemoryPolicy {
  return AGENT_POLICIES[agentId] ?? STAGE_POLICIES.B
}

export function selectMemoryForAgent(
  entries: readonly MemoryEntry[],
  policy: ScientificMemoryPolicy,
  limit = policy.maxItems,
): MemoryEntry[] {
  return sortMemory(entries)
    .filter((entry) => policy.readLayers.includes(entry.layer))
    .filter((entry) => policy.readKinds.includes(entry.kind))
    .filter((entry) => {
      if (entry.verificationStatus === 'rejected') return false
      return !policy.requireVerified || entry.verificationStatus === 'verified'
    })
    .slice(0, Math.max(0, Math.min(limit, policy.maxItems)))
}

export function selectMemoryForStage(
  entries: readonly MemoryEntry[],
  stage: ScientificLoopStage,
  limit?: number,
): MemoryEntry[] {
  const policy = memoryPolicyForStage(stage)
  return selectMemoryForAgent(entries, policy, limit ?? policy.maxItems)
}

export function enforceMemoryWritePolicy(
  entries: readonly MemoryEntry[],
  policy: ScientificMemoryPolicy,
): {
  accepted: MemoryEntry[]
  rejected: RejectedMemoryWrite[]
} {
  const accepted: MemoryEntry[] = []
  const rejected: RejectedMemoryWrite[] = []

  for (const entry of entries) {
    if (!policy.writeKinds.includes(entry.kind)) {
      rejected.push({
        memoryId: entry.memoryId,
        reason: `memory kind ${entry.kind} is not writable by this agent`,
      })
      continue
    }
    if (!policy.writeLayers.includes(entry.layer)) {
      rejected.push({
        memoryId: entry.memoryId,
        reason: `memory layer ${entry.layer} is not writable by this agent`,
      })
      continue
    }
    accepted.push(entry)
  }

  return { accepted, rejected }
}
