import type {
  ScientificWorkbenchState,
  WorkbenchEvidence,
  WorkbenchValidationTask,
} from './state'

export interface ScientificRoundView {
  round: number
  evidence: WorkbenchEvidence[]
  processingResults: ScientificWorkbenchState['processingResults']
  corrections: ScientificWorkbenchState['corrections']
  summary: ScientificWorkbenchState['roundSummaries'][number] | null
  tasksProposed: WorkbenchValidationTask[]
  tasksExecuted: WorkbenchValidationTask[]
}

export function scientificRounds(state: ScientificWorkbenchState): number[] {
  const rounds = new Set<number>()
  const add = (round: number | undefined) => {
    if (round != null && round > 0) rounds.add(round)
  }
  add(state.round)
  state.hypotheses.forEach((item) => add(item.round))
  state.evidence.forEach((item) => add(item.round))
  state.processingResults.forEach((item) => add(item.round))
  state.validationTasks.forEach((item) => add(item.round))
  state.corrections.forEach((item) => add(item.round))
  state.roundSummaries.forEach((item) => add(item.round))
  return [...rounds].sort((left, right) => left - right)
}

export function taskExecutionRound(
  task: WorkbenchValidationTask,
  evidence: WorkbenchEvidence[],
): number | null {
  const resultIds = new Set(task.resultEvidenceIds ?? [])
  const result = evidence.find(
    (item) => item.taskId === task.taskId || resultIds.has(item.evidenceId),
  )
  return result?.round ?? null
}

export function scientificRoundView(
  state: ScientificWorkbenchState,
  round: number,
): ScientificRoundView {
  const evidence = state.evidence.filter((item) => item.round === round)
  const evidenceIds = new Set(evidence.map((item) => item.evidenceId))
  return {
    round,
    evidence,
    processingResults: state.processingResults.filter((item) => item.round === round),
    corrections: state.corrections.filter((item) => item.round === round),
    summary: state.roundSummaries.find((item) => item.round === round) ?? null,
    tasksProposed: state.validationTasks.filter((item) => item.round === round),
    tasksExecuted: state.validationTasks.filter(
      (task) =>
        state.evidence.some((item) => item.round === round && item.taskId === task.taskId) ||
        (task.resultEvidenceIds ?? []).some((id) => evidenceIds.has(id)),
    ),
  }
}

export function evidenceCounts(evidence: WorkbenchEvidence[]) {
  return evidence.reduce(
    (counts, item) => {
      if (item.status === 'support') counts.support += 1
      else if (item.status === 'contradict') counts.contradict += 1
      else counts.unknown += 1
      if (item.provenance?.deterministic) counts.deterministic += 1
      return counts
    },
    { support: 0, contradict: 0, unknown: 0, deterministic: 0 },
  )
}
