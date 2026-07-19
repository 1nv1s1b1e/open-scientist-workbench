import { describe, expect, it } from 'vitest'
import {
  CritiqueSchema,
  EvalResultSchema,
  HypothesisSchema,
  MhdConfigSchema,
  PlanSchema,
} from '../src/index.js'

describe('schema', () => {
  it('parses valid hypothesis', () => {
    const h = HypothesisSchema.parse({
      id: 'h1',
      statement: 'nanoflare heating triggered by neutral-line bending',
      pythonCode: 'def filter(s): return True',
      parentId: null,
      round: 1,
      f1: null,
      createdAt: new Date().toISOString(),
    })
    expect(h.status).toBe('candidate')
  })

  it('parses eval result with counterexamples', () => {
    const e = EvalResultSchema.parse({
      hypoId: 'h1',
      f1: 0.91,
      truePositives: 100,
      falsePositives: 10,
      falseNegatives: 5,
      counterexamples: [
        { snapshotId: 's1', reason: 'no superhot flow', expected: 'heat', actual: 'none' },
      ],
      logs: 'ran 1000 snapshots',
      executionMs: 5000,
    })
    expect(e.f1).toBeGreaterThan(0.9)
  })

  it('parses critique + mutation', () => {
    const c = CritiqueSchema.parse({
      hypoId: 'h1',
      critiqueText: 'insufficient constraints',
      rationale: 'missing time derivative of magnetic gradient',
      severity: 'major',
      round: 2,
    })
    expect(c.severity).toBe('major')
  })

  it('parses plan + mhd config', () => {
    const p = PlanSchema.parse({
      round: 3,
      searchParams: {
        paramRange: { threshold: [0, 1] },
        populationSize: 10,
        mutationRate: 0.2,
      },
      computeBudget: { maxEvals: 1000, parallelWorkers: 4 },
      rationale: 'focus on time derivative features',
    })
    expect(p.searchParams.mutationRate).toBe(0.2)

    const m = MhdConfigSchema.parse({
      runId: 'r1',
      cfgPath: '/tmp/r1.cfg',
      observationProposal: 'observe AR1140',
      summary: 'MHD config for nanoflare hypothesis',
    })
    expect(m.cfgPath).toContain('r1')
  })
})
