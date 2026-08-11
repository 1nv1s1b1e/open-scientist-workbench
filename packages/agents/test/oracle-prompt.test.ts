import type { EvalResult, Hypothesis } from '@open-scientist/schema'
import { describe, expect, it } from 'vite-plus/test'
import { buildEvalSummaryBlock, buildHypothesesBlock } from '../src/oracle/workflow.ts'

function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: 'h1',
    statement: 'AC wave heating dissipates Alfvén waves in the corona',
    mechanism: 'alfven-wave-dissipation',
    predictions: ['coherent propagating EUV disturbances'],
    falsificationConditions: ['no propagating signal in a quality-controlled time series'],
    sourceIds: ['paper:alfven-1'],
    pythonCode: 'def filter(snapshot):\n    return snapshot["temperature"] > 1e6',
    parentId: null,
    round: 1,
    f1: null,
    status: 'candidate',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeEval(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    hypoId: 'h1',
    f1: 0.5,
    truePositives: 10,
    falsePositives: 5,
    falseNegatives: 8,
    counterexamples: [],
    candidateSnapshots: [],
    logs: '',
    executionMs: 1234,
    ...overrides,
  }
}

describe('buildHypothesesBlock', () => {
  it('renders hypoId, statement, pythonCode, f1, parentId, round, status', () => {
    const h = makeHypothesis({ id: 'h-42', round: 3, status: 'evaluated', f1: null })
    const e = makeEval({ hypoId: 'h-42', f1: 0.72 })
    const block = buildHypothesesBlock([h], [e])

    expect(block).toContain('Hypothesis h-42')
    expect(block).toContain('round 3')
    expect(block).toContain('status=evaluated')
    expect(block).toContain('f1=0.72')
    expect(block).toContain('parentId=null')
    expect(block).toContain('AC wave heating dissipates Alfvén waves in the corona')
    expect(block).toContain('def filter(snapshot):')
    expect(block).toContain('```python')
  })

  it('renders scientific hypothesis context', () => {
    const block = buildHypothesesBlock([makeHypothesis()], [])
    expect(block).toContain('mechanism: alfven-wave-dissipation')
    expect(block).toContain('predictions: coherent propagating EUV disturbances')
    expect(block).toContain('falsificationConditions: no propagating signal in a quality-controlled time series')
    expect(block).toContain('sourceIds: paper:alfven-1')
  })

  it('renders counterexamples from the matching EvalResult', () => {
    const h = makeHypothesis({ id: 'h1' })
    const e = makeEval({
      hypoId: 'h1',
      counterexamples: [
        {
          snapshotId: 'snap-9',
          expected: 'hot',
          actual: 'cool',
          reason: 'low temperature floor',
        },
      ],
    })
    const block = buildHypothesesBlock([h], [e])

    expect(block).toContain('counterexamples (1)')
    expect(block).toContain('snapshotId=snap-9')
    expect(block).toContain('expected=hot')
    expect(block).toContain('actual=cool')
    expect(block).toContain('reason=low temperature floor')
  })

  it('shows "(no counterexamples reported)" when eval has none', () => {
    const h = makeHypothesis({ id: 'h1' })
    const e = makeEval({ hypoId: 'h1', counterexamples: [] })
    const block = buildHypothesesBlock([h], [e])
    expect(block).toContain('counterexamples (0)')
    expect(block).toContain('(no counterexamples reported)')
  })

  it('falls back to hypothesis.f1 when no matching eval exists', () => {
    const h = makeHypothesis({ id: 'h1', f1: 0.33 })
    const block = buildHypothesesBlock([h], [])
    expect(block).toContain('f1=0.33')
  })

  it('returns empty string for empty hypotheses', () => {
    expect(buildHypothesesBlock([], [])).toBe('')
  })
})

describe('buildEvalSummaryBlock', () => {
  it('renders hypoId, f1, TP, FP, FN, executionMs per eval', () => {
    const e = makeEval({
      hypoId: 'h-7',
      f1: 0.66,
      truePositives: 20,
      falsePositives: 4,
      falseNegatives: 6,
      executionMs: 987,
    })
    const block = buildEvalSummaryBlock([e])
    expect(block).toContain('h-7')
    expect(block).toContain('F1=0.66')
    expect(block).toContain('TP=20')
    expect(block).toContain('FP=4')
    expect(block).toContain('FN=6')
    expect(block).toContain('987ms')
  })

  it('joins multiple evals with newlines', () => {
    const e1 = makeEval({ hypoId: 'h1' })
    const e2 = makeEval({ hypoId: 'h2', f1: 0.9 })
    const block = buildEvalSummaryBlock([e1, e2])
    const lines = block.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('h1')
    expect(lines[1]).toContain('h2')
  })

  it('returns empty string for empty evalResults', () => {
    expect(buildEvalSummaryBlock([])).toBe('')
  })
})
