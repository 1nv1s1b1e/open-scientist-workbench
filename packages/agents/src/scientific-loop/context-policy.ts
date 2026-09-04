import type { EvidenceStatus, ValidationTask } from '@open-scientist/schema'
import type { EvidenceAgentCapability } from './evidence-workgroup.ts'

export type ScientificContextStage =
  | 'librarian'
  | 'self-correction-i'
  | 'surveyor'
  | 'explorer'
  | 'self-correction-ii'
  | 'oracle'
  | 'prometheus'

export interface ScientificContextPolicy {
  maxHypotheses: number
  maxEvidence: number
  maxTasks: number
  evidenceStatuses: readonly EvidenceStatus[]
  taskStatuses: readonly ValidationTask['status'][]
}

const STAGE_CONTEXT_POLICIES: Record<ScientificContextStage, ScientificContextPolicy> = {
  'self-correction-i': {
    maxHypotheses: 24,
    maxEvidence: 8,
    maxTasks: 0,
    evidenceStatuses: ['unknown'],
    taskStatuses: ['planned'],
  },
  surveyor: {
    maxHypotheses: 24,
    maxEvidence: 12,
    maxTasks: 64,
    evidenceStatuses: ['support', 'contradict', 'unknown'],
    taskStatuses: ['planned', 'completed', 'failed'],
  },
  'self-correction-ii': {
    maxHypotheses: 24,
    maxEvidence: 24,
    maxTasks: 0,
    evidenceStatuses: ['support', 'contradict', 'unknown'],
    taskStatuses: ['completed'],
  },
  librarian: {
    maxHypotheses: 24,
    maxEvidence: 12,
    maxTasks: 4,
    evidenceStatuses: ['support', 'contradict', 'unknown'],
    taskStatuses: ['planned', 'completed', 'failed'],
  },
  explorer: {
    maxHypotheses: 24,
    maxEvidence: 12,
    // D can legitimately schedule several diagnostics per hypothesis. Keep
    // the whole bounded round batch so an arbitrary context slice cannot
    // leave an `executable_now` task stranded.
    maxTasks: 256,
    evidenceStatuses: ['support', 'contradict', 'unknown'],
    taskStatuses: ['planned', 'running'],
  },
  oracle: {
    maxHypotheses: 24,
    maxEvidence: 32,
    maxTasks: 256,
    evidenceStatuses: ['support', 'contradict', 'unknown'],
    taskStatuses: ['planned', 'running', 'completed', 'failed', 'rejected'],
  },
  prometheus: {
    maxHypotheses: 24,
    maxEvidence: 32,
    maxTasks: 256,
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
    stage === 'explorer' &&
    capabilities.some((item) => item === 'counterexample-search' || item === 'fact-check')
  ) {
    return {
      ...base,
      maxEvidence: 20,
    }
  }
  return base
}
