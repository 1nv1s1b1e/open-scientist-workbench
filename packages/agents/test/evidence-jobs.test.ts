import type { EvalResult } from '@open-scientist/schema'
import { describe, expect, it } from 'vite-plus/test'
import { buildEvidenceAlignmentJobs } from '../src/sisyphus/evidence.ts'

function result(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    hypoId: 'h1',
    f1: 0.7,
    truePositives: 7,
    falsePositives: 2,
    falseNegatives: 1,
    counterexamples: [],
    candidateSnapshots: [
      {
        snapshotId: 's1',
        activeRegion: '1142',
        timestamp: '2026-01-01T00:00:00Z',
        wavelength: '193',
      },
      {
        snapshotId: 's2',
        activeRegion: '1142',
        timestamp: '2026-01-01T00:12:00Z',
        wavelength: '171',
      },
    ],
    logs: '',
    executionMs: 1,
    ...overrides,
  }
}

describe('evidence alignment jobs', () => {
  it('creates bounded Looker jobs from deterministic candidate metadata', () => {
    expect(buildEvidenceAlignmentJobs([result()], 1)).toEqual([
      {
        hypoId: 'h1',
        snapshotId: 's1',
        candidateCase: {
          activeRegion: '1142',
          timestamp: '2026-01-01T00:00:00Z',
          wavelength: '193',
        },
      },
    ])
  })

  it('does not create an alignment job when the evaluator has no manifest-backed candidates', () => {
    expect(buildEvidenceAlignmentJobs([result({ candidateSnapshots: [] })])).toEqual([])
  })
})
