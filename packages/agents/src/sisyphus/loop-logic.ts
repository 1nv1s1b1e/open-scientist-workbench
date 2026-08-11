import type { EvalResult, Hypothesis, OracleOutput } from '@open-scientist/schema'

/** Hypotheses retained for the next Explore pass. Eliminated lineage stays observable. */
export function getActiveHypotheses(hypotheses: readonly Hypothesis[]): Hypothesis[] {
  return hypotheses.filter((hypothesis) => hypothesis.status !== 'eliminated')
}

/** Apply only current-round results; a stale result must never revive an eliminated node. */
export function applyEvaluationResults(
  hypotheses: readonly Hypothesis[],
  evalResults: readonly EvalResult[],
): Hypothesis[] {
  const byId = new Map(evalResults.map((result) => [result.hypoId, result]))
  return hypotheses.map((hypothesis) => {
    if (hypothesis.status === 'eliminated') return hypothesis
    const result = byId.get(hypothesis.id)
    return result
      ? { ...hypothesis, f1: result.f1, status: 'evaluated' as const }
      : hypothesis
  })
}

/**
 * Apply Oracle's semantic revision contract while preserving the complete
 * lineage. Structural Zod validation happens at submit_result; these checks
 * protect referential integrity between parent, child, and eliminated nodes.
 */
export function applyOracleRevision(
  hypotheses: readonly Hypothesis[],
  oracleOutput: OracleOutput,
): Hypothesis[] {
  const existingIds = new Set(hypotheses.map((hypothesis) => hypothesis.id))
  const eliminatedIds = new Set(oracleOutput.eliminatedIds)

  for (const eliminatedId of eliminatedIds) {
    if (!existingIds.has(eliminatedId)) {
      throw new Error(`Oracle elimination references unknown hypothesis: ${eliminatedId}`)
    }
  }

  const childIds = new Set<string>()
  for (const mutation of oracleOutput.mutations) {
    const child = mutation.mutatedHypothesis
    if (!existingIds.has(mutation.parentHypoId)) {
      throw new Error(
        `Oracle mutation parent is unknown: ${mutation.parentHypoId} -> ${child.id}`,
      )
    }
    if (existingIds.has(child.id) || childIds.has(child.id)) {
      throw new Error(`Oracle mutation reuses hypothesis id: ${child.id}`)
    }
    if (child.parentId !== mutation.parentHypoId) {
      throw new Error(`Oracle mutation parentId mismatch for child: ${child.id}`)
    }
    if (child.status !== 'mutated') {
      throw new Error(`Oracle mutation must have status=mutated: ${child.id}`)
    }
    childIds.add(child.id)
  }

  return hypotheses
    .map((hypothesis) =>
      eliminatedIds.has(hypothesis.id)
        ? { ...hypothesis, status: 'eliminated' as const }
        : hypothesis,
    )
    .concat(oracleOutput.mutations.map((mutation) => mutation.mutatedHypothesis))
}

/** Bind every revision to a sample-level counterexample or an explicit Oracle event. */
export function getRevisionTriggers(
  evalResults: readonly EvalResult[],
  oracleOutput: Pick<OracleOutput, 'eliminatedIds' | 'mutations'>,
): string[] {
  const snapshotIds = evalResults.flatMap((result) =>
    result.counterexamples.map((counterexample) => counterexample.snapshotId),
  )
  const uniqueSnapshotIds = [...new Set(snapshotIds)]
  if (uniqueSnapshotIds.length > 0) return uniqueSnapshotIds
  if (oracleOutput.eliminatedIds.length > 0 || oracleOutput.mutations.length > 0) {
    return ['oracle:elimination-or-mutation']
  }
  return ['oracle:no-counterexample-recorded']
}
