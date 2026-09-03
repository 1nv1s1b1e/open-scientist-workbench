import { describe, expect, it } from 'vite-plus/test'
import { createScienceLoopState, transitionScienceLoop } from '../src/science-loop.ts'

describe('science loop harness', () => {
  it('allows the complete question-to-validation lifecycle', () => {
    let state = createScienceLoopState({
      runId: 'run-1',
      question: 'Which observations distinguish coronal-heating mechanisms?',
      datasetId: 'jwfd-png-demo',
      datasetManifestSha256: 'a'.repeat(64),
    })

    for (const phase of [
      'hypothesis',
      'evidence',
      'evaluation',
      'counterexample',
      'revision',
      'validation_plan',
      'completed',
    ] as const) {
      state = transitionScienceLoop(state, phase, { note: phase })
    }

    expect(state.phase).toBe('completed')
    expect(state.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(state.events[3]?.phase).toBe('counterexample')
  })

  it('rejects a transition that skips evidence and evaluation', () => {
    const state = createScienceLoopState({
      runId: 'run-2',
      question: 'How can nanoflare heating be falsified?',
      datasetId: 'jwfd-png-demo',
      datasetManifestSha256: 'a'.repeat(64),
    })

    expect(() => transitionScienceLoop(state, 'counterexample', {})).toThrow(
      /Invalid science-loop transition/,
    )
  })
})
