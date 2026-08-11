import { describe, expect, it } from 'vite-plus/test'
import {
  summarizeScientificTrace,
  validationTaskTraceStatus,
} from '../src/lib/workbench/scientific-trace-data.ts'

describe('scientific trace data', () => {
  it('counts only recorded provider calls and deterministic processing runs', () => {
    const metrics = summarizeScientificTrace([
      {
        type: 'custom',
        kind: 'scientific.model-run',
        usage: { reasoningTokens: 321 },
      },
      {
        type: 'custom',
        kind: 'scientific.processing-result',
        processingRunId: 'processing-1',
      },
      {
        type: 'custom',
        kind: 'scientific.reasoning-summary',
        summary: 'Public model summary, not another model invocation.',
      },
    ] as never[])

    expect(metrics).toEqual({ modelCalls: 1, reasoningTokens: 321, processingRuns: 1 })
  })

  it('does not present planned validation tasks as completed', () => {
    expect(validationTaskTraceStatus('planned')).toBe('queued')
    expect(validationTaskTraceStatus('running')).toBe('running')
    expect(validationTaskTraceStatus('completed')).toBe('completed')
    expect(validationTaskTraceStatus('failed')).toBe('failed')
    expect(validationTaskTraceStatus('rejected')).toBe('skipped')
  })
})
