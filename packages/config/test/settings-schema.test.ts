import { describe, expect, it } from 'vitest'
import {
  ConcurrencySettingsSchema,
  GlobalSettingsSchema,
  ModelConfigSchema,
  SteeringSettingsSchema,
  TournamentSettingsSchema,
} from '../src/settings.ts'

describe('ModelConfigSchema', () => {
  it('parses minimal config with default thinkingLevel', () => {
    const m = ModelConfigSchema.parse({ model: 'gpt-4o', credentialId: 'openai-default' })
    expect(m.thinkingLevel).toBe('medium')
    expect(m.credentialId).toBe('openai-default')
  })

  it('accepts all thinkingLevel enum values', () => {
    for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
      expect(
        ModelConfigSchema.parse({ model: 'm', thinkingLevel: level, credentialId: 'c' })
          .thinkingLevel,
      ).toBe(level)
    }
  })

  it('throws when model is missing', () => {
    expect(() => ModelConfigSchema.parse({ credentialId: 'c' })).toThrow()
  })

  it('throws when credentialId is missing', () => {
    expect(() => ModelConfigSchema.parse({ model: 'm' })).toThrow()
  })

  it('throws when thinkingLevel is an illegal enum', () => {
    expect(() =>
      ModelConfigSchema.parse({ model: 'm', thinkingLevel: 'verbose', credentialId: 'c' }),
    ).toThrow()
  })

  it('throws when credentialId is empty', () => {
    expect(() => ModelConfigSchema.parse({ model: 'm', credentialId: '' })).toThrow()
  })
})

describe('TournamentSettingsSchema', () => {
  it('parses a full tournament config', () => {
    const t = TournamentSettingsSchema.parse({
      maxRounds: 8,
      targetF1: 0.95,
      convergenceWindow: 2,
      convergenceThreshold: 0.01,
    })
    expect(t.maxRounds).toBe(8)
    expect(t.targetF1).toBe(0.95)
  })

  it('applies defaults when all fields are missing', () => {
    const t = TournamentSettingsSchema.parse({})
    expect(t).toEqual({
      maxRounds: 10,
      targetF1: 0.9,
      convergenceWindow: 3,
      convergenceThreshold: 0.005,
    })
  })

  it('throws when maxRounds is a non-number', () => {
    expect(() => TournamentSettingsSchema.parse({ maxRounds: 'ten' })).toThrow()
  })

  it('throws when targetF1 is a boolean', () => {
    expect(() => TournamentSettingsSchema.parse({ targetF1: true })).toThrow()
  })

  it('throws when convergenceWindow is a non-number', () => {
    expect(() => TournamentSettingsSchema.parse({ convergenceWindow: '3' })).toThrow()
  })

  it('throws when convergenceThreshold is a string', () => {
    expect(() => TournamentSettingsSchema.parse({ convergenceThreshold: '0.005' })).toThrow()
  })
})

describe('ConcurrencySettingsSchema', () => {
  it('parses maxConcurrentRuns', () => {
    const c = ConcurrencySettingsSchema.parse({ maxConcurrentRuns: 8 })
    expect(c.maxConcurrentRuns).toBe(8)
  })

  it('applies default maxConcurrentRuns=4 when missing', () => {
    expect(ConcurrencySettingsSchema.parse({}).maxConcurrentRuns).toBe(4)
  })

  it('throws when maxConcurrentRuns is a string', () => {
    expect(() => ConcurrencySettingsSchema.parse({ maxConcurrentRuns: '4' })).toThrow()
  })
})

describe('SteeringSettingsSchema', () => {
  it('parses one-at-a-time mode', () => {
    const s = SteeringSettingsSchema.parse({ mode: 'one-at-a-time' })
    expect(s.mode).toBe('one-at-a-time')
  })

  it('parses all mode', () => {
    const s = SteeringSettingsSchema.parse({ mode: 'all' })
    expect(s.mode).toBe('all')
  })

  it('applies default mode=one-at-a-time when missing', () => {
    expect(SteeringSettingsSchema.parse({}).mode).toBe('one-at-a-time')
  })

  it('throws when mode is an illegal enum', () => {
    expect(() => SteeringSettingsSchema.parse({ mode: 'bogus' })).toThrow()
  })
})

describe('GlobalSettingsSchema', () => {
  it('parses a full global settings object', () => {
    const s = GlobalSettingsSchema.parse({
      models: { default: { model: 'gpt-4o', credentialId: 'openai-default' } },
      tournament: {
        maxRounds: 10,
        targetF1: 0.9,
        convergenceWindow: 3,
        convergenceThreshold: 0.005,
      },
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
    })
    expect(s.models.default?.model).toBe('gpt-4o')
    expect(s.models.default?.credentialId).toBe('openai-default')
    expect(s.tournament.maxRounds).toBe(10)
  })

  it('accepts an empty models record (default)', () => {
    const s = GlobalSettingsSchema.parse({
      tournament: {
        maxRounds: 10,
        targetF1: 0.9,
        convergenceWindow: 3,
        convergenceThreshold: 0.005,
      },
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
    })
    expect(s.models).toEqual({})
  })

  it('throws when tournament is missing', () => {
    expect(() =>
      GlobalSettingsSchema.parse({
        models: {},
        concurrency: { maxConcurrentRuns: 4 },
        steering: { mode: 'one-at-a-time' },
      }),
    ).toThrow()
  })

  it('throws when a model entry is missing credentialId', () => {
    expect(() =>
      GlobalSettingsSchema.parse({
        models: { default: { model: 'm' } },
        tournament: {
          maxRounds: 10,
          targetF1: 0.9,
          convergenceWindow: 3,
          convergenceThreshold: 0.005,
        },
        concurrency: { maxConcurrentRuns: 4 },
        steering: { mode: 'one-at-a-time' },
      }),
    ).toThrow()
  })
})
