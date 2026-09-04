import type { EvidenceRecord, ValidationTask } from '@open-scientist/schema'

type ScientificTaskLike = Pick<
  ValidationTask,
  'route' | 'type' | 'objective' | 'fingerprint' | 'triggeredBy'
>

/** Decide whether prometheus can send the next task to evidence work (explorer) or must revisit librarian. */
export function decideNextRoute(task: ScientificTaskLike): 'librarian' | 'explorer' {
  if (task.type === 'model-update') return 'librarian'
  if (/新.*机制|无法解释|unexplained|missing mechanism/i.test(task.objective)) return 'librarian'
  return 'explorer'
}

export function deduplicateValidationTasks(tasks: ValidationTask[]): ValidationTask[] {
  const seen = new Set<string>()
  const result: ValidationTask[] = []
  for (const task of tasks) {
    if (seen.has(task.fingerprint)) continue
    seen.add(task.fingerprint)
    result.push(task)
  }
  return result
}

export function summarizeEvidence(records: ReadonlyArray<Pick<EvidenceRecord, 'status'>>) {
  return records.reduce(
    (summary, record) => {
      summary[record.status] += 1
      return summary
    },
    { support: 0, contradict: 0, unknown: 0 },
  )
}

export function shouldContinueScientificLoop({
  round,
  maxRounds,
  newEvidence,
  newTasks,
  hasExecutableTask = true,
  hasDeferredTask = false,
}: {
  round: number
  maxRounds: number
  newEvidence: number
  newTasks: number
  hasExecutableTask?: boolean
  hasDeferredTask?: boolean
}): {
  continue: boolean
  reason:
    | 'max_rounds_reached'
    | 'no_executable_validation_task'
    | 'no_new_evidence_or_tasks'
    | 'new_evidence'
    | 'new_task'
} {
  // A deferred task is a stronger scientific stop than the budget: it tells
  // the caller why another automatic round cannot produce information.
  if (!hasExecutableTask && hasDeferredTask) {
    return {
      continue: false,
      reason: 'no_executable_validation_task',
    }
  }
  if (round >= maxRounds) return { continue: false, reason: 'max_rounds_reached' }
  if (!hasExecutableTask) {
    return { continue: false, reason: 'no_new_evidence_or_tasks' }
  }
  if (newEvidence === 0 && newTasks === 0) {
    return { continue: false, reason: 'no_new_evidence_or_tasks' }
  }
  return newEvidence > 0
    ? { continue: true, reason: 'new_evidence' }
    : { continue: true, reason: 'new_task' }
}
