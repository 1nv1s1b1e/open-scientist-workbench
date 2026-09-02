import type { Hypothesis } from '@open-scientist/schema'
import { describe, expect, it } from 'vite-plus/test'
import { selectLeadingHypothesis } from '../src/legacy/sisyphus/leader.ts'

function hypothesis(id: string, f1: number | null, status: Hypothesis['status'] = 'evaluated'): Hypothesis {
  return {
    id,
    statement: id,
    mechanism: 'test-mechanism',
    predictions: ['test prediction'],
    falsificationConditions: ['test falsification condition'],
    sourceIds: [],
    pythonCode: 'def filter(snapshot): return True',
    parentId: null,
    round: 1,
    f1,
    status,
    createdAt: '2026-01-01T00:00:00Z',
  }
}

describe('selectLeadingHypothesis', () => {
  it('recomputes the leader from the surviving pool after Oracle mutations', () => {
    const result = selectLeadingHypothesis([
      hypothesis('eliminated', 0.95, 'eliminated'),
      hypothesis('survivor', 0.72),
      hypothesis('mutated', null, 'mutated'),
    ])

    expect(result).toEqual({ hypoId: 'survivor', bestF1: 0.72 })
  })

  it('returns no leader for an empty or unevaluated pool', () => {
    expect(selectLeadingHypothesis([])).toEqual({ hypoId: null, bestF1: 0 })
    expect(selectLeadingHypothesis([hypothesis('candidate', null, 'candidate')])).toEqual({
      hypoId: null,
      bestF1: 0,
    })
  })
})
