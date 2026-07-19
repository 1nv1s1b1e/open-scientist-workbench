import { describe, expect, it } from 'vitest'
import {
  ConcurrencySettingsSchema,
  GlobalSettingsSchema,
  ModelConfigSchema,
  SteeringSettingsSchema,
  TournamentSettingsSchema,
} from '../src/settings.js'

describe('ModelConfigSchema', () => {
  it('parses minimal config with defaults for provider + thinkingLevel', () => {
    const m = ModelConfigSchema.parse({ model: 'gpt-4o' })
    expect(m.provider).toBe('openai')
    expect(m.thinkingLevel).toBe('medium')
  })

  it('accepts anthropic provider', () => {
    const m = ModelConfigSchema.parse({ provider: 'anthropic', model: 'claude-3' })
    expect(m.provider).toBe('anthropic')
  })

  it('accepts all thinkingLevel enum values', () => {
    for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
      expect(ModelConfigSchema.parse({ model: 'm', thinkingLevel: level }).thinkingLevel).toBe(
        level,
      )
    }
  })

  it('accepts an optional baseURL', () => {
    const m = ModelConfigSchema.parse({ model: 'm', baseURL: 'http://gw.example.com/v1' })
    expect(m.baseURL).toBe('http://gw.example.com/v1')
  })

  it('throws when model is missing', () => {
    expect(() => ModelConfigSchema.parse({})).toThrow()
  })

  it('throws when provider is an illegal enum', () => {
    expect(() => ModelConfigSchema.parse({ provider: 'gemini', model: 'm' })).toThrow()
  })

  it('throws when thinkingLevel is an illegal enum', () => {
    expect(() => ModelConfigSchema.parse({ model: 'm', thinkingLevel: 'verbose' })).toThrow()
  })

  it('throws when baseURL is not a valid URL', () => {
    expect(() => ModelConfigSchema.parse({ model: 'm', baseURL: 'not-a-url' })).toThrow()
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
      models: { default: { provider: 'openai', model: 'gpt-4o' } },
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
    expect(s.tournament.maxRounds).toBe(10)
  })

  it('accepts an empty models record', () => {
    const s = GlobalSettingsSchema.parse({
      models: {},
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

  it('throws when a model entry is invalid', () => {
    expect(() =>
      GlobalSettingsSchema.parse({
        models: { default: { provider: 'bogus', model: 'm' } },
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
