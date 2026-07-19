import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Env, EnvSchema, loadEnv } from '../src/env.ts'

// Snapshot of process.env keys we mutate so we can restore them.
const KEYS = ['BASE_DIR', 'PORT', 'HELIX_URL', 'LOG_LEVEL'] as const

beforeEach(() => {
  for (const k of KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of KEYS) delete process.env[k]
})

describe('EnvSchema', () => {
  it('applies defaults when all env vars are undefined', () => {
    const env = EnvSchema.parse({
      BASE_DIR: undefined,
      PORT: undefined,
      HELIX_URL: undefined,
      LOG_LEVEL: undefined,
    })
    expect(env.BASE_DIR).toBe('./data')
    expect(env.PORT).toBe(3000)
    expect(env.HELIX_URL).toBe('http://localhost:6969')
    expect(env.LOG_LEVEL).toBe('info')
  })

  it('coerces PORT from a string to a number', () => {
    const env = EnvSchema.parse({ PORT: '4242' })
    expect(env.PORT).toBe(4242)
    expect(typeof env.PORT).toBe('number')
  })

  it('accepts all valid LOG_LEVEL enum values', () => {
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      expect(EnvSchema.parse({ LOG_LEVEL: level }).LOG_LEVEL).toBe(level)
    }
  })

  it('throws when LOG_LEVEL is an illegal enum value', () => {
    expect(() => EnvSchema.parse({ LOG_LEVEL: 'trace' })).toThrow()
  })

  it('throws when PORT coerces to NaN', () => {
    expect(() => EnvSchema.parse({ PORT: 'not-a-number' })).toThrow()
  })

  it('accepts a custom BASE_DIR string', () => {
    const env = EnvSchema.parse({ BASE_DIR: '/var/open-scientist' })
    expect(env.BASE_DIR).toBe('/var/open-scientist')
  })
})

describe('loadEnv', () => {
  it('returns defaults when process.env is empty', () => {
    const env: Env = loadEnv()
    expect(env).toEqual({
      BASE_DIR: './data',
      PORT: 3000,
      HELIX_URL: 'http://localhost:6969',
      LOG_LEVEL: 'info',
    })
  })

  it('reads values from process.env', () => {
    process.env.BASE_DIR = '/tmp/os'
    process.env.PORT = '9999'
    process.env.HELIX_URL = 'http://helix:7000'
    process.env.LOG_LEVEL = 'debug'
    const env = loadEnv()
    expect(env.BASE_DIR).toBe('/tmp/os')
    expect(env.PORT).toBe(9999)
    expect(env.HELIX_URL).toBe('http://helix:7000')
    expect(env.LOG_LEVEL).toBe('debug')
  })

  it('coerces PORT read from process.env', () => {
    process.env.PORT = '8080'
    expect(loadEnv().PORT).toBe(8080)
  })

  it('throws when process.env.LOG_LEVEL is illegal', () => {
    process.env.LOG_LEVEL = 'verbose'
    expect(() => loadEnv()).toThrow()
  })
})
