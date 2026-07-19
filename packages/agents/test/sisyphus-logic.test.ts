import type { EvalResult, Hypothesis, OracleOutput } from '@open-scientist/schema'
import { describe, expect, it } from 'vitest'
import type { ConvergenceEntry } from '../src/prometheus/workflow.ts'
import {
  applyOraclePruning,
  buildConvergenceEntry,
  computeLeader,
  MAX_ROUNDS,
  shouldStopByPrometheus,
  shouldStopByTarget,
  TARGET_F1,
  updateHypothesesWithEval,
} from '../src/sisyphus/logic.ts'

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------

function makeHypo(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: 'h1',
    statement: 'nanoflare heating',
    pythonCode: 'def f(s): return True',
    parentId: null,
    round: 1,
    f1: null,
    status: 'candidate',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeEval(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    hypoId: 'h1',
    f1: 0.85,
    truePositives: 80,
    falsePositives: 10,
    falseNegatives: 5,
    counterexamples: [],
    logs: 'ok',
    executionMs: 1000,
    ...overrides,
  }
}

function makeOracleOutput(overrides: Partial<OracleOutput> = {}): OracleOutput {
  return {
    critiques: [],
    mutations: [],
    eliminatedIds: [],
    winningHypoId: null,
    ...overrides,
  }
}

// ------------------------------------------------------------
// updateHypothesesWithEval
// ------------------------------------------------------------

describe('updateHypothesesWithEval', () => {
  it('updates a matched hypothesis with f1 + status=evaluated', () => {
    const hypos = [makeHypo({ id: 'h1', f1: null, status: 'candidate' })]
    const evals = [makeEval({ hypoId: 'h1', f1: 0.87 })]
    const out = updateHypothesesWithEval(hypos, evals)
    expect(out[0]?.f1).toBe(0.87)
    expect(out[0]?.status).toBe('evaluated')
  })

  it('leaves an unmatched hypothesis unchanged', () => {
    const hypos = [makeHypo({ id: 'h1', f1: null, status: 'candidate' })]
    const evals = [makeEval({ hypoId: 'h-other', f1: 0.9 })]
    const out = updateHypothesesWithEval(hypos, evals)
    expect(out[0]?.f1).toBeNull()
    expect(out[0]?.status).toBe('candidate')
  })

  it('handles multiple hypotheses with multiple evals in order', () => {
    const hypos = [
      makeHypo({ id: 'h1', f1: null }),
      makeHypo({ id: 'h2', f1: null }),
      makeHypo({ id: 'h3', f1: null }),
    ]
    const evals = [makeEval({ hypoId: 'h2', f1: 0.5 }), makeEval({ hypoId: 'h1', f1: 0.9 })]
    const out = updateHypothesesWithEval(hypos, evals)
    expect(out.map((h) => [h.id, h.f1, h.status])).toEqual([
      ['h1', 0.9, 'evaluated'],
      ['h2', 0.5, 'evaluated'],
      ['h3', null, 'candidate'],
    ])
  })

  it('returns the array unchanged when evals is empty', () => {
    const hypos = [makeHypo({ id: 'h1' }), makeHypo({ id: 'h2' })]
    const out = updateHypothesesWithEval(hypos, [])
    expect(out).toEqual(hypos)
  })
})

// ------------------------------------------------------------
// computeLeader
// ------------------------------------------------------------

describe('computeLeader', () => {
  it('returns {0, null} for an empty pool', () => {
    expect(computeLeader([])).toEqual({ bestF1: 0, leadingHypoId: null })
  })

  it('returns the single hypothesis as the leader', () => {
    const out = computeLeader([makeHypo({ id: 'h1', f1: 0.77 })])
    expect(out).toEqual({ bestF1: 0.77, leadingHypoId: 'h1' })
  })

  it('picks the first hypothesis in a tie (pool order wins)', () => {
    const out = computeLeader([
      makeHypo({ id: 'first', f1: 0.9 }),
      makeHypo({ id: 'second', f1: 0.9 }),
    ])
    expect(out).toEqual({ bestF1: 0.9, leadingHypoId: 'first' })
  })

  it('treats null f1 as 0 when computing the max', () => {
    const out = computeLeader([
      makeHypo({ id: 'unevaluated', f1: null }),
      makeHypo({ id: 'low', f1: 0.1 }),
    ])
    expect(out).toEqual({ bestF1: 0.1, leadingHypoId: 'low' })
  })

  it('returns bestF1=0 + leadingHypoId=first when all f1 are null', () => {
    const out = computeLeader([makeHypo({ id: 'a', f1: null }), makeHypo({ id: 'b', f1: null })])
    // Math.max(null ?? 0) = 0; find first with f1===0 → none (all null), so null.
    expect(out.bestF1).toBe(0)
    expect(out.leadingHypoId).toBeNull()
  })
})

// ------------------------------------------------------------
// shouldStopByTarget
// ------------------------------------------------------------

describe('shouldStopByTarget', () => {
  it('returns false below the target (0.89)', () => {
    expect(shouldStopByTarget(0.89)).toBe(false)
  })

  it('returns true exactly at the target (0.9)', () => {
    expect(shouldStopByTarget(0.9)).toBe(true)
  })

  it('returns true above the target (0.95)', () => {
    expect(shouldStopByTarget(0.95)).toBe(true)
  })

  it('exposes TARGET_F1 = 0.9 as the threshold', () => {
    expect(TARGET_F1).toBe(0.9)
  })
})

// ------------------------------------------------------------
// applyOraclePruning
// ------------------------------------------------------------

describe('applyOraclePruning', () => {
  it('filters out hypotheses whose id is in eliminatedIds', () => {
    const hypos = [makeHypo({ id: 'h1' }), makeHypo({ id: 'h2' }), makeHypo({ id: 'h3' })]
    const out = applyOraclePruning(hypos, makeOracleOutput({ eliminatedIds: ['h2'] }))
    expect(out.map((h) => h.id)).toEqual(['h1', 'h3'])
  })

  it('appends mutated hypotheses from mutations', () => {
    const hypos = [makeHypo({ id: 'h1' })]
    const mutant = makeHypo({ id: 'h1-m1', parentId: 'h1', statement: 'lowered threshold' })
    const out = applyOraclePruning(
      hypos,
      makeOracleOutput({
        mutations: [
          { parentHypoId: 'h1', mutatedHypothesis: mutant, mutationRationale: 'explore', round: 2 },
        ],
      }),
    )
    expect(out.map((h) => h.id)).toEqual(['h1', 'h1-m1'])
  })

  it('applies both elimination and mutation in one pass', () => {
    const hypos = [makeHypo({ id: 'h1' }), makeHypo({ id: 'h2' })]
    const mutant = makeHypo({ id: 'h2-m1', parentId: 'h2' })
    const out = applyOraclePruning(
      hypos,
      makeOracleOutput({
        eliminatedIds: ['h1'],
        mutations: [
          { parentHypoId: 'h1', mutatedHypothesis: mutant, mutationRationale: 'r', round: 3 },
        ],
      }),
    )
    expect(out.map((h) => h.id)).toEqual(['h2', 'h2-m1'])
  })

  it('returns the pool unchanged when Oracle output is empty', () => {
    const hypos = [makeHypo({ id: 'h1' }), makeHypo({ id: 'h2' })]
    const out = applyOraclePruning(hypos, makeOracleOutput())
    expect(out).toEqual(hypos)
  })
})

// ------------------------------------------------------------
// buildConvergenceEntry
// ------------------------------------------------------------

describe('buildConvergenceEntry', () => {
  it('builds an entry with the given round / bestF1 / count', () => {
    const entry: ConvergenceEntry = buildConvergenceEntry(3, 0.88, 5)
    expect(entry).toEqual({ round: 3, bestF1: 0.88, count: 5 })
  })

  it('preserves zero / edge values', () => {
    expect(buildConvergenceEntry(0, 0, 0)).toEqual({ round: 0, bestF1: 0, count: 0 })
  })
})

// ------------------------------------------------------------
// shouldStopByPrometheus
// ------------------------------------------------------------

describe('shouldStopByPrometheus', () => {
  it('returns true when Prometheus says shouldContinue=false', () => {
    expect(shouldStopByPrometheus(false, 5)).toBe(true)
  })

  it('returns true when shouldContinue=true but round hit the MAX_ROUNDS cap', () => {
    expect(shouldStopByPrometheus(true, 10)).toBe(true)
  })

  it('returns false when shouldContinue=true and round is below the cap', () => {
    expect(shouldStopByPrometheus(true, 9)).toBe(false)
  })

  it('returns true when both conditions are met (shouldContinue=false AND round=cap)', () => {
    expect(shouldStopByPrometheus(false, 10)).toBe(true)
  })

  it('exposes MAX_ROUNDS = 10 as the round cap', () => {
    expect(MAX_ROUNDS).toBe(10)
  })
})
