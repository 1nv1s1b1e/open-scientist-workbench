// Pure tournament-orchestration logic, extracted from workflow.ts so it can be
// unit-tested without spinning up the Workflow DevKit runtime. These functions
// are deterministic and side-effect free — they operate on plain Hypothesis /
// EvalResult / OracleOutput / ConvergenceEntry data structures.
//
// The tournament constants (MAX_ROUNDS / TARGET_F1) are inlined here rather
// than imported from `@open-scientist/config` because that package is a barrel
// that re-exports paths.ts (node:path) + settings.ts (node:fs), which would
// drag Node modules into the esbuild workflow bundle. The values mirror
// `@open-scientist/config/constants.ts` exactly — if you change one, change
// both. (A future cleanup could move these constants to the zero-dependency
// `@open-scientist/schema` package so both sites can import them cleanly.)

import type { EvalResult, Hypothesis, OracleOutput } from '@open-scientist/schema'
import type { ConvergenceEntry } from '../prometheus/workflow.ts'

/** Max tournament rounds — mirrors `@open-scientist/config` MAX_ROUNDS. */
const MAX_ROUNDS = 10
/** F1 convergence target — mirrors `@open-scientist/config` TARGET_F1. */
const TARGET_F1 = 0.9

/**
 * Fold this round's EvalResults into the hypothesis pool: each hypothesis whose
 * id matches an EvalResult gets its f1 + status='evaluated' updated; unmatched
 * hypotheses are returned unchanged. Order is preserved.
 */
export function updateHypothesesWithEval(
  hypotheses: Hypothesis[],
  evalResults: EvalResult[],
): Hypothesis[] {
  return hypotheses.map((h) => {
    const evalMatch = evalResults.find((e) => e.hypoId === h.id)
    if (!evalMatch) return h
    return {
      ...h,
      f1: evalMatch.f1,
      status: 'evaluated' as const,
    }
  })
}

/**
 * Compute the leading hypothesis across the pool.
 *
 * - bestF1 = max(h.f1 ?? 0) across all hypotheses (null f1 counts as 0).
 * - leadingHypoId = the id of the FIRST hypothesis achieving bestF1 (ties
 *   broken by pool order, matching `Array.prototype.find` semantics in the
 *   original workflow).
 * - Empty pool → { bestF1: 0, leadingHypoId: null }.
 */
export function computeLeader(hypotheses: Hypothesis[]): {
  bestF1: number
  leadingHypoId: string | null
} {
  const bestF1 = hypotheses.reduce((max, h) => Math.max(max, h.f1 ?? 0), 0)
  const leader = hypotheses.find((h) => h.f1 === bestF1)
  return { bestF1, leadingHypoId: leader?.id ?? null }
}

/** Convergence check #1: best F1 has reached the target. */
export function shouldStopByTarget(bestF1: number): boolean {
  return bestF1 >= TARGET_F1
}

/**
 * Apply Oracle's pruning + mutations to the hypothesis pool.
 *
 * - Filter out hypotheses whose id appears in `oracleOutput.eliminatedIds`.
 * - Append every mutated hypothesis from `oracleOutput.mutations`.
 * - Empty Oracle output → pool unchanged.
 */
export function applyOraclePruning(
  hypotheses: Hypothesis[],
  oracleOutput: OracleOutput,
): Hypothesis[] {
  return hypotheses
    .filter((h) => !oracleOutput.eliminatedIds.includes(h.id))
    .concat(oracleOutput.mutations.map((m) => m.mutatedHypothesis))
}

/** Build one convergence-history entry for the given round. */
export function buildConvergenceEntry(
  round: number,
  bestF1: number,
  count: number,
): ConvergenceEntry {
  return { round, bestF1, count }
}

/**
 * Convergence check #2: Prometheus says stop OR the round cap was hit.
 *
 * Mirrors the workflow's `if (!prometheusOutput.shouldContinue || round >= MAX_ROUNDS) break`.
 */
export function shouldStopByPrometheus(shouldContinue: boolean, round: number): boolean {
  return !shouldContinue || round >= MAX_ROUNDS
}

/** Re-export the round cap so callers can introspect the same constant. */
export { MAX_ROUNDS, TARGET_F1 }
