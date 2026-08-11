import type {
  EvidenceStatus,
  ValidationTask,
} from '@open-scientist/schema'
import type { EvidenceAgentCapability } from './evidence-workgroup.ts'

export type ScientificContextStage = 'A' | 'B' | 'C' | 'D'

export interface ScientificContextPolicy {
  maxHypotheses: number
  maxEvidence: number
  maxTasks: number
  evidenceStatuses: readonly EvidenceStatus[]
  taskStatuses: readonly ValidationTask['status'][]
}

const STAGE_CONTEXT_POLICIES: Record<
  ScientificContextStage,
  ScientificContextPolicy
> = {
  A: {
    maxHypotheses: 12,
    maxEvidence: 12,
    maxTasks: 4,
    evidenceStatuses: ['support', 'contradict', 'unknown'],
    taskStatuses: ['planned', 'completed', 'failed'],
  },
  B: {
    maxHypotheses: 6,
    maxEvidence: 12,
    maxTasks: 6,
    evidenceStatuses: ['support', 'contradict', 'unknown'],
    taskStatuses: ['planned', 'running'],
  },
  C: {
    maxHypotheses: 16,
    maxEvidence: 32,
    maxTasks: 16,
    evidenceStatuses: ['support', 'contradict', 'unknown'],
    taskStatuses: ['planned', 'running', 'completed', 'failed', 'rejected'],
  },
  D: {
    maxHypotheses: 16,
    maxEvidence: 32,
    maxTasks: 24,
    evidenceStatuses: ['support', 'contradict', 'unknown'],
    taskStatuses: ['planned', 'running', 'completed', 'failed', 'rejected'],
  },
}

export function contextPolicyFor(
  stage: ScientificContextStage,
  capabilities: readonly EvidenceAgentCapability[] = [],
): ScientificContextPolicy {
  const base = STAGE_CONTEXT_POLICIES[stage]
  if (
    stage === 'B' &&
    capabilities.some((item) =>
      item === 'counterexample-search' || item === 'fact-check'
    )
  ) {
    return {
      ...base,
      maxEvidence: 20,
    }
  }
  return base
}
