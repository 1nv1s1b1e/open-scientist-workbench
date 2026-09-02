import type { Hypothesis, OracleOutput } from '@open-scientist/schema'
import { describe, expect, it } from 'vite-plus/test'
import {
  applyEvaluationResults,
  applyOracleRevision,
  getActiveHypotheses,
  getRevisionTriggers,
} from '../src/legacy/sisyphus/loop-logic.ts'

function hypothesis(
  id: string,
  overrides: Partial<Hypothesis> = {},
): Hypothesis {
  return {
    id,
    statement: `${id} statement`,
    mechanism: 'magnetic-reconnection-nanoflare',
    predictions: ['impulsive hot emission'],
    falsificationConditions: ['no impulsive hot emission'],
    sourceIds: ['paper:example'],
    pythonCode: 'def filter(snapshot): return True',
    parentId: null,
    round: 1,
    f1: null,
    status: 'candidate',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('sisyphus loop logic', () => {
  it('keeps eliminated hypotheses in the lineage but excludes them from the active pool', () => {
    const parent = hypothesis('h-parent', { f1: 0.8, status: 'evaluated' })
    const survivor = hypothesis('h-survivor', { f1: 0.4, status: 'evaluated' })
    const child = hypothesis('h-child', {
      parentId: 'h-parent',
      round: 2,
      status: 'mutated',
    })
    const output: OracleOutput = {
      critiques: [],
      mutations: [
        {
          parentHypoId: 'h-parent',
          mutatedHypothesis: child,
          mutationRationale: 'counterexample shows the threshold is too broad',
          round: 2,
        },
      ],
      eliminatedIds: ['h-parent'],
      winningHypoId: null,
    }

    const revised = applyOracleRevision([parent, survivor], output)

    expect(revised).toHaveLength(3)
    expect(revised.find((h) => h.id === 'h-parent')?.status).toBe('eliminated')
    expect(getActiveHypotheses(revised).map((h) => h.id)).toEqual(['h-survivor', 'h-child'])
  })

  it('does not let a stale evaluation update an eliminated hypothesis', () => {
    const eliminated = hypothesis('h-old', { status: 'eliminated', f1: 0.9 })
    const active = hypothesis('h-active')
    const updated = applyEvaluationResults(
      [eliminated, active],
      [
        {
          hypoId: 'h-old',
          f1: 1,
          truePositives: 1,
          falsePositives: 0,
          falseNegatives: 0,
          counterexamples: [],
          logs: 'stale result',
          executionMs: 1,
          candidateSnapshots: [],
        },
        {
          hypoId: 'h-active',
          f1: 0.6,
          truePositives: 3,
          falsePositives: 1,
          falseNegatives: 1,
          counterexamples: [],
          logs: 'current result',
          executionMs: 1,
          candidateSnapshots: [],
        },
      ],
    )

    expect(updated[0]).toMatchObject({ status: 'eliminated', f1: 0.9 })
    expect(updated[1]).toMatchObject({ status: 'evaluated', f1: 0.6 })
  })

  it('requires every revision to have a concrete trigger', () => {
    expect(
      getRevisionTriggers(
        [
          {
            hypoId: 'h1',
            f1: 0.2,
            truePositives: 0,
            falsePositives: 2,
            falseNegatives: 1,
            counterexamples: [],
            logs: '',
            executionMs: 1,
            candidateSnapshots: [],
          },
        ],
        { mutations: [], eliminatedIds: ['h1'] },
      ),
    ).toEqual(['oracle:elimination-or-mutation'])
  })

  it('rejects a mutation with a missing parent instead of silently breaking lineage', () => {
    const output: OracleOutput = {
      critiques: [],
      mutations: [
        {
          parentHypoId: 'missing',
          mutatedHypothesis: hypothesis('h-child', { parentId: 'missing', status: 'mutated' }),
          mutationRationale: 'unbound mutation',
          round: 2,
        },
      ],
      eliminatedIds: [],
      winningHypoId: null,
    }

    expect(() => applyOracleRevision([hypothesis('h1')], output)).toThrow(/parent/i)
  })
})
