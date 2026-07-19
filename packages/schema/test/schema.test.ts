import { describe, expect, it } from 'vitest'
import {
  AddCredentialRequestSchema,
  ApproveRequestSchema,
  ConvergenceEntrySchema,
  CreateProjectRequestSchema,
  CredentialResponseSchema,
  CritiqueSchema,
  EvalResultSchema,
  EvidenceAlignmentSchema,
  GlobalSettingsSchema,
  HypothesisPoolSchema,
  HypothesisSchema,
  MhdConfigSchema,
  MutationSchema,
  OracleOutputSchema,
  PlanSchema,
  PrometheusOutputSchema,
  RuntimeContextSchema,
  StartRunRequestSchema,
  SteerRequestSchema,
  TestLlmRequestSchema,
  TestLlmResponseSchema,
  TournamentResultSchema,
} from '../src/index.ts'

// Shared valid hypothesis fixture.
function validHypothesis(overrides: Record<string, unknown> = {}) {
  return {
    id: 'h1',
    statement: 'nanoflare heating triggered by neutral-line bending',
    pythonCode: 'def filter(s): return True',
    parentId: null,
    round: 1,
    f1: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function validEvalResult(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  }
}

function validCritique(overrides: Record<string, unknown> = {}) {
  return {
    hypoId: 'h1',
    critiqueText: 'insufficient constraints',
    rationale: 'missing time derivative of magnetic gradient',
    severity: 'major',
    round: 2,
    ...overrides,
  }
}

function validPlan(overrides: Record<string, unknown> = {}) {
  return {
    round: 3,
    searchParams: {
      paramRange: { threshold: [0, 1] },
      populationSize: 10,
      mutationRate: 0.2,
    },
    computeBudget: { maxEvals: 1000, parallelWorkers: 4 },
    rationale: 'focus on time derivative features',
    ...overrides,
  }
}

describe('schema', () => {
  // ------------------------------------------------------------
  // HypothesisSchema
  // ------------------------------------------------------------
  it('parses valid hypothesis with default status', () => {
    const h = HypothesisSchema.parse(validHypothesis())
    expect(h.status).toBe('candidate')
  })

  it('parses hypothesis with explicit status', () => {
    const h = HypothesisSchema.parse(validHypothesis({ status: 'evaluated' }))
    expect(h.status).toBe('evaluated')
  })

  it('throws when id is missing', () => {
    const { id: _id, ...rest } = validHypothesis()
    expect(() => HypothesisSchema.parse(rest)).toThrow()
  })

  it('throws when statement is missing', () => {
    const { statement: _s, ...rest } = validHypothesis()
    expect(() => HypothesisSchema.parse(rest)).toThrow()
  })

  it('throws when pythonCode is missing', () => {
    const { pythonCode: _p, ...rest } = validHypothesis()
    expect(() => HypothesisSchema.parse(rest)).toThrow()
  })

  it('throws when parentId is a number instead of string|null', () => {
    expect(() => HypothesisSchema.parse(validHypothesis({ parentId: 5 }))).toThrow()
  })

  it('accepts parentId as a string', () => {
    const h = HypothesisSchema.parse(validHypothesis({ parentId: 'h0' }))
    expect(h.parentId).toBe('h0')
  })

  it('throws when f1 is a string instead of number|null', () => {
    expect(() => HypothesisSchema.parse(validHypothesis({ f1: '0.9' }))).toThrow()
  })

  it('throws when status is an illegal enum value', () => {
    expect(() => HypothesisSchema.parse(validHypothesis({ status: 'bogus' }))).toThrow()
  })

  // ------------------------------------------------------------
  // HypothesisPoolSchema
  // ------------------------------------------------------------
  it('parses hypothesis pool', () => {
    const p = HypothesisPoolSchema.parse({
      hypotheses: [validHypothesis()],
      rationale: 'cover AC/DC/turbulent mechanisms',
    })
    expect(p.hypotheses).toHaveLength(1)
  })

  it('throws when HypothesisPool rationale is missing', () => {
    expect(() => HypothesisPoolSchema.parse({ hypotheses: [] })).toThrow()
  })

  // ------------------------------------------------------------
  // EvalResultSchema
  // ------------------------------------------------------------
  it('parses eval result with counterexamples', () => {
    const e = EvalResultSchema.parse(validEvalResult())
    expect(e.f1).toBeGreaterThan(0.9)
  })

  it('throws when EvalResult is missing a field', () => {
    const { executionMs: _m, ...rest } = validEvalResult()
    expect(() => EvalResultSchema.parse(rest)).toThrow()
  })

  it('throws when counterexamples item is missing a field', () => {
    expect(() =>
      EvalResultSchema.parse(
        validEvalResult({ counterexamples: [{ snapshotId: 's1', reason: 'x' }] }),
      ),
    ).toThrow()
  })

  // ------------------------------------------------------------
  // CritiqueSchema + MutationSchema + OracleOutputSchema
  // ------------------------------------------------------------
  it('parses critique', () => {
    const c = CritiqueSchema.parse(validCritique())
    expect(c.severity).toBe('major')
  })

  it('throws when severity is an illegal enum value', () => {
    expect(() => CritiqueSchema.parse(validCritique({ severity: 'catastrophic' }))).toThrow()
  })

  it('parses mutation with nested hypothesis', () => {
    const m = MutationSchema.parse({
      parentHypoId: 'h1',
      mutatedHypothesis: validHypothesis({ id: 'h2', parentId: 'h1' }),
      mutationRationale: 'lower threshold',
      round: 3,
    })
    expect(m.mutatedHypothesis.id).toBe('h2')
  })

  it('parses OracleOutput', () => {
    const o = OracleOutputSchema.parse({
      critiques: [validCritique()],
      mutations: [],
      eliminatedIds: ['h2'],
      winningHypoId: null,
    })
    expect(o.eliminatedIds).toEqual(['h2'])
  })

  it('accepts winningHypoId as null', () => {
    const o = OracleOutputSchema.parse({
      critiques: [],
      mutations: [],
      eliminatedIds: [],
      winningHypoId: null,
    })
    expect(o.winningHypoId).toBeNull()
  })

  // ------------------------------------------------------------
  // PlanSchema + MhdConfigSchema + PrometheusOutputSchema
  // ------------------------------------------------------------
  it('parses plan with paramRange record', () => {
    const p = PlanSchema.parse(validPlan())
    expect(p.searchParams.mutationRate).toBe(0.2)
    expect(p.searchParams.paramRange.threshold).toEqual([0, 1])
  })

  it('throws when plan paramRange value is not a [number, number] tuple', () => {
    expect(() =>
      PlanSchema.parse(
        validPlan({
          searchParams: { paramRange: { t: [0] }, populationSize: 1, mutationRate: 0.1 },
        }),
      ),
    ).toThrow()
  })

  it('parses mhd config', () => {
    const m = MhdConfigSchema.parse({
      runId: 'r1',
      cfgPath: '/tmp/r1.cfg',
      observationProposal: 'observe AR1140',
      summary: 'MHD config for nanoflare hypothesis',
    })
    expect(m.cfgPath).toContain('r1')
  })

  it('throws when mhd config is missing a field', () => {
    expect(() => MhdConfigSchema.parse({ runId: 'r1', cfgPath: '/tmp/r1.cfg' })).toThrow()
  })

  it('parses PrometheusOutput with nullable mhdConfig', () => {
    const o = PrometheusOutputSchema.parse({
      plan: validPlan(),
      mhdConfig: null,
      shouldContinue: true,
    })
    expect(o.shouldContinue).toBe(true)
    expect(o.mhdConfig).toBeNull()
  })

  // ------------------------------------------------------------
  // TournamentResultSchema
  // ------------------------------------------------------------
  it('parses tournament result', () => {
    const t = TournamentResultSchema.parse({
      runId: 'r1',
      winningHypoId: 'h3',
      bestF1: 0.92,
      totalRounds: 5,
      mhdConfigPath: '/tmp/r1.cfg',
      observationProposal: 'observe AR1140',
    })
    expect(t.bestF1).toBe(0.92)
  })

  it('throws when tournament result bestF1 is a string', () => {
    expect(() =>
      TournamentResultSchema.parse({
        runId: 'r1',
        winningHypoId: 'h3',
        bestF1: '0.92',
        totalRounds: 5,
        mhdConfigPath: null,
        observationProposal: null,
      }),
    ).toThrow()
  })

  it('throws when tournament result is missing a field', () => {
    expect(() => TournamentResultSchema.parse({ runId: 'r1', winningHypoId: 'h3' })).toThrow()
  })

  // ------------------------------------------------------------
  // EvidenceAlignmentSchema
  // ------------------------------------------------------------
  it('parses evidence alignment with nullable videoClipPath', () => {
    const e = EvidenceAlignmentSchema.parse({
      hypoId: 'h1',
      fitsPaths: ['/a.fits', '/b.fits'],
      videoClipPath: null,
      metadata: {
        activeRegion: 'AR1140',
        timestamp: '2026-01-01T00:00:00Z',
        wavelength: '171Å',
        spatialIndex: 'hgrid-0-0',
      },
    })
    expect(e.fitsPaths).toHaveLength(2)
  })

  it('throws when evidence metadata is missing a field', () => {
    expect(() =>
      EvidenceAlignmentSchema.parse({
        hypoId: 'h1',
        fitsPaths: [],
        videoClipPath: null,
        metadata: { activeRegion: 'AR1140', timestamp: '2026-01-01T00:00:00Z' },
      }),
    ).toThrow()
  })

  // ------------------------------------------------------------
  // RuntimeContextSchema + ConvergenceEntrySchema
  // ------------------------------------------------------------
  it('parses runtime context with convergence history', () => {
    const r = RuntimeContextSchema.parse({
      projectId: 'p1',
      runId: 'r1',
      round: 3,
      hypotheses: [validHypothesis()],
      leadingHypoId: 'h1',
      bestF1: 0.85,
      convergenceHistory: [
        { round: 2, bestF1: 0.8, count: 3 },
        { round: 3, bestF1: 0.85, count: 2 },
      ],
      userFeedback: null,
    })
    expect(r.convergenceHistory).toHaveLength(2)
  })

  it('throws when runtime context is missing a field', () => {
    expect(() => RuntimeContextSchema.parse({ projectId: 'p1', runId: 'r1', round: 3 })).toThrow()
  })

  it('throws when convergence history entry is missing count', () => {
    expect(() =>
      RuntimeContextSchema.parse({
        projectId: 'p1',
        runId: 'r1',
        round: 3,
        hypotheses: [],
        leadingHypoId: null,
        bestF1: 0,
        convergenceHistory: [{ round: 2, bestF1: 0.8 }],
        userFeedback: null,
      }),
    ).toThrow()
  })

  it('parses a standalone convergence entry', () => {
    const e = ConvergenceEntrySchema.parse({ round: 4, bestF1: 0.9, count: 5 })
    expect(e.round).toBe(4)
  })

  it('throws when convergence entry is missing a field', () => {
    expect(() => ConvergenceEntrySchema.parse({ round: 4, bestF1: 0.9 })).toThrow()
  })

  // ------------------------------------------------------------
  // TestLlmRequestSchema
  // ------------------------------------------------------------
  it('parses TestLlmRequest with defaults', () => {
    const r = TestLlmRequestSchema.parse({
      provider: 'anthropic',
      model: 'claude-3',
      apiKey: 'sk-x',
    })
    expect(r.maxTokens).toBe(50)
    expect(r.prompt).toBe('Say hi in 3 words.')
    expect(r.provider).toBe('anthropic')
  })

  it('throws when apiKey is missing', () => {
    expect(() => TestLlmRequestSchema.parse({ provider: 'openai', model: 'gpt-4' })).toThrow()
  })

  it('throws when provider is an illegal enum', () => {
    expect(() =>
      TestLlmRequestSchema.parse({ provider: 'gemini', model: 'gpt-4', apiKey: 'sk-x' }),
    ).toThrow()
  })

  it('throws when maxTokens exceeds 4096', () => {
    expect(() =>
      TestLlmRequestSchema.parse({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'sk-x',
        maxTokens: 5000,
      }),
    ).toThrow()
  })

  it('throws when maxTokens is not an integer', () => {
    expect(() =>
      TestLlmRequestSchema.parse({
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'sk-x',
        maxTokens: 1.5,
      }),
    ).toThrow()
  })

  it('parses TestLlmResponse', () => {
    const r = TestLlmResponseSchema.parse({
      ok: true,
      text: 'hi there',
      durationMs: 123,
    })
    expect(r.ok).toBe(true)
  })

  // ------------------------------------------------------------
  // AddCredentialRequestSchema + CredentialResponseSchema
  // ------------------------------------------------------------
  it('parses AddCredentialRequest with default type', () => {
    const r = AddCredentialRequestSchema.parse({
      provider: 'openai',
      key: 'sk-x',
    })
    expect(r.type).toBe('api-key')
    expect(r.id).toBeUndefined()
    expect(r.baseURL).toBeUndefined()
  })

  it('parses AddCredentialRequest with id + baseURL', () => {
    const r = AddCredentialRequestSchema.parse({
      id: 'qwen-gateway',
      provider: 'openai',
      key: 'sk-x',
      baseURL: 'http://gw.test/v1',
    })
    expect(r.id).toBe('qwen-gateway')
    expect(r.baseURL).toBe('http://gw.test/v1')
  })

  it('accepts oauth-token type', () => {
    const r = AddCredentialRequestSchema.parse({
      provider: 'google',
      type: 'oauth-token',
      key: 'ya29.x',
    })
    expect(r.type).toBe('oauth-token')
  })

  it('throws when credential type is an illegal enum', () => {
    expect(() =>
      AddCredentialRequestSchema.parse({ provider: 'openai', type: 'bogus', key: 'sk-x' }),
    ).toThrow()
  })

  it('parses CredentialResponse with baseURL', () => {
    const r = CredentialResponseSchema.parse({
      id: 'qwen-gateway',
      provider: 'openai',
      type: 'api-key',
      hasKey: true,
      baseURL: 'http://gw.test/v1',
    })
    expect(r.hasKey).toBe(true)
    expect(r.baseURL).toBe('http://gw.test/v1')
  })

  // ------------------------------------------------------------
  // Other API schemas
  // ------------------------------------------------------------
  it('parses CreateProjectRequest with minimal fields', () => {
    const r = CreateProjectRequestSchema.parse({ name: 'corona' })
    expect(r.name).toBe('corona')
  })

  it('throws when CreateProjectRequest name is empty', () => {
    expect(() => CreateProjectRequestSchema.parse({ name: '' })).toThrow()
  })

  it('throws when CreateProjectRequest name exceeds 64 chars', () => {
    expect(() => CreateProjectRequestSchema.parse({ name: 'x'.repeat(65) })).toThrow()
  })

  it('parses StartRunRequest', () => {
    const r = StartRunRequestSchema.parse({ seed: 'nanoflare' })
    expect(r.seed).toBe('nanoflare')
  })

  it('throws when StartRunRequest seed is empty', () => {
    expect(() => StartRunRequestSchema.parse({ seed: '' })).toThrow()
  })

  it('parses ApproveRequest', () => {
    const r = ApproveRequestSchema.parse({ approved: true, reason: 'looks good' })
    expect(r.approved).toBe(true)
  })

  it('parses SteerRequest with default mode', () => {
    const r = SteerRequestSchema.parse({ content: 'focus on DC heating' })
    expect(r.mode).toBe('steering')
  })

  it('throws when SteerRequest mode is illegal', () => {
    expect(() => SteerRequestSchema.parse({ content: 'x', mode: 'bogus' })).toThrow()
  })

  // ------------------------------------------------------------
  // GlobalSettingsSchema
  // ------------------------------------------------------------
  it('parses GlobalSettings with full structure', () => {
    const s = GlobalSettingsSchema.parse({
      models: {
        default: { model: 'gpt-4o', credentialId: 'openai-prod' },
      },
      tournament: {
        maxRounds: 5,
        targetF1: 0.95,
        convergenceWindow: 2,
        convergenceThreshold: 0.01,
      },
      concurrency: { maxConcurrentRuns: 2 },
      steering: { mode: 'all' },
    })
    expect(s.tournament.targetF1).toBe(0.95)
  })
})
