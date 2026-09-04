import type {
  EvidenceRecord,
  PhenomenonInput,
  ScientificCorrection,
  ScientificHypothesis,
  ValidationTask,
} from '@open-scientist/schema'
import { contextPolicyFor, type ScientificContextStage } from './context-policy.ts'
import type { EvidenceAgentCapability } from './evidence-workgroup.ts'
import type { ScientificGraphState } from './graph-state.ts'

export type ScientificContextSource = Pick<
  ScientificGraphState,
  'phenomenon' | 'hypotheses' | 'evidence' | 'validationTasks' | 'round' | 'corrections'
>

export interface ScientificWorkingContext {
  phenomenon: PhenomenonInput
  hypotheses: ScientificHypothesis[]
  evidence: EvidenceRecord[]
  validationTasks: ValidationTask[]
  dataSnapshotIds: string[]
  artifactIds: string[]
  processingRunIds: string[]
  round: number
  /**
   * Compact self-correction findings from earlier rounds, newest first.
   * Closes the feedback loop: reviewers and planners can see what problems
   * were already found instead of re-reporting them verbatim.
   */
  recentLessons: string[]
}

export interface BuildScientificContextInput {
  stage: ScientificContextStage
  state: ScientificContextSource
  taskId?: string
  capabilities?: readonly EvidenceAgentCapability[]
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function targetHypothesisIds(
  state: ScientificContextSource,
  tasks: readonly ValidationTask[],
): Set<string> {
  const ids = new Set<string>()
  for (const task of tasks) {
    for (const hypothesisId of task.hypothesisIds ?? []) ids.add(hypothesisId)
    if (state.hypotheses.some((item) => item.id === task.triggeredBy)) {
      ids.add(task.triggeredBy)
    }
    const triggeringEvidence = state.evidence.find((item) => item.evidenceId === task.triggeredBy)
    if (triggeringEvidence?.hypothesisId) {
      ids.add(triggeringEvidence.hypothesisId)
    }
    for (const evidenceId of task.resultEvidenceIds) {
      const result = state.evidence.find((item) => item.evidenceId === evidenceId)
      if (result?.hypothesisId) ids.add(result.hypothesisId)
    }
  }
  // A model-update task points at the parent that triggered revision. Carry
  // that target forward to active children so the next B stage validates the
  // revised hypothesis instead of projecting an empty context.
  let changed = true
  while (changed) {
    changed = false
    for (const hypothesis of state.hypotheses) {
      if (hypothesis.parentId && ids.has(hypothesis.parentId) && !ids.has(hypothesis.id)) {
        ids.add(hypothesis.id)
        changed = true
      }
    }
  }
  return ids
}

export function buildScientificContext(
  input: BuildScientificContextInput,
): ScientificWorkingContext {
  const policy = contextPolicyFor(input.stage, input.capabilities ?? [])
  const eligibleTasks = input.state.validationTasks.filter((task) =>
    policy.taskStatuses.includes(task.status),
  )
  const validationTasks = (
    input.taskId ? eligibleTasks.filter((task) => task.taskId === input.taskId) : eligibleTasks
  ).slice(0, policy.maxTasks)

  const targets = targetHypothesisIds(input.state, validationTasks)
  const restrictToTask = input.stage === 'explorer' && validationTasks.length > 0
  const hypotheses = input.state.hypotheses
    .filter((item) => item.status !== 'revised' && item.status !== 'eliminated')
    .filter((item) => !restrictToTask || targets.has(item.id))
    .slice(0, policy.maxHypotheses)
  const hypothesisIds = new Set(hypotheses.map((item) => item.id))
  const eligibleEvidence = input.state.evidence
    .filter((item) => policy.evidenceStatuses.includes(item.status))
    .filter((item) => {
      if (!restrictToTask) return true
      return item.hypothesisId ? hypothesisIds.has(item.hypothesisId) : false
    })
  // A B-stage projection may itself be projected again by the evidence
  // subgraph. Keep task triggers ahead of the general evidence window so a
  // maxEvidence slice cannot erase the link from task -> evidence -> target
  // hypothesis on the second projection.
  const taskEvidenceIds = new Set(
    validationTasks.flatMap((task) => [task.triggeredBy, ...task.resultEvidenceIds]),
  )
  const evidence = restrictToTask
    ? [
        ...eligibleEvidence.filter((item) => taskEvidenceIds.has(item.evidenceId)),
        ...eligibleEvidence.filter((item) => !taskEvidenceIds.has(item.evidenceId)),
      ].slice(0, policy.maxEvidence)
    : eligibleEvidence.slice(0, policy.maxEvidence)

  return {
    phenomenon: input.state.phenomenon,
    hypotheses,
    evidence,
    validationTasks,
    dataSnapshotIds: unique(evidence.flatMap((item) => item.provenance?.dataSnapshotIds ?? [])),
    artifactIds: unique(evidence.flatMap((item) => item.provenance?.artifactIds ?? [])),
    processingRunIds: unique(
      evidence.flatMap((item) => (item.provenance ? [item.provenance.processingRunId] : [])),
    ),
    round: input.state.round,
    recentLessons: recentLessonRows(input.state.corrections),
  }
}

const RECENT_LESSON_LIMIT = 6

/**
 * Compact, deduplicated self-correction findings from earlier rounds (newest
 * first). These close the feedback loop: without them a round-2 reviewer
 * re-reports the round-1 finding verbatim because the finding text never
 * reached its context, even when the underlying work item was already
 * registered. Info-level notes are noise, not lessons.
 */
function recentLessonRows(corrections: readonly ScientificCorrection[] | undefined): string[] {
  if (!Array.isArray(corrections)) return []
  const seen = new Set<string>()
  const rows: string[] = []
  for (const item of [...corrections].reverse()) {
    if (item.severity === 'info') continue
    const key = item.message.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(`R${item.round}/${item.stage}: ${item.message.replace(/\s+/g, ' ').slice(0, 120)}`)
    if (rows.length >= RECENT_LESSON_LIMIT) break
  }
  return rows
}
