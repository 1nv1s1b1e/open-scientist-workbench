import type { Hypothesis } from '@open-scientist/schema'
import { describe, expect, it } from 'vite-plus/test'
import { formatWinningHypothesis } from '../src/legacy/prometheus/workflow.ts'

const hypothesis: Hypothesis = {
  id: 'h-1',
  statement: 'Alfven-wave dissipation heats the corona',
  mechanism: 'alfven-wave-dissipation',
  predictions: ['propagating EUV disturbances'],
  falsificationConditions: ['no propagating disturbance in quality-controlled data'],
  sourceIds: ['paper:alfven-1'],
  pythonCode: 'def filter(snapshot): return True',
  parentId: null,
  round: 1,
  f1: 0.7,
  status: 'evaluated',
  createdAt: '2026-01-01T00:00:00Z',
}

describe('formatWinningHypothesis', () => {
  it('passes mechanism, predictions, falsification, and sources to Prometheus', () => {
    const context = formatWinningHypothesis(hypothesis)
    expect(context).toContain('mechanism: alfven-wave-dissipation')
    expect(context).toContain('predictions: propagating EUV disturbances')
    expect(context).toContain(
      'falsificationConditions: no propagating disturbance in quality-controlled data',
    )
    expect(context).toContain('sourceIds: paper:alfven-1')
  })

  it('returns an explicit empty marker when there is no winner', () => {
    expect(formatWinningHypothesis(undefined)).toBe('(no winning hypothesis)')
  })
})
