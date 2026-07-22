import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { consola, createLogger, type LoggerTag, loggersByTag, setLogLevel } from '../src/index.ts'

beforeEach(() => {
  // Reset consola level to the default between tests.
  setLogLevel(3)
})

describe('createLogger', () => {
  it('returns a consola instance tagged with the given tag', () => {
    const logger = createLogger('api')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
  })

  it('caches logger instances per tag (identity reuse)', () => {
    const a = createLogger('storage')
    const b = createLogger('storage')
    expect(a).toBe(b)
  })

  it('returns distinct instances for distinct tags', () => {
    const a = createLogger('agents')
    const b = createLogger('tools')
    expect(a).not.toBe(b)
  })
})

describe('loggersByTag', () => {
  const EXPECTED_TAGS: LoggerTag[] = [
    'app',
    'api',
    'storage',
    'config',
    'agents',
    'tools',
    'skills',
    'mcp',
    'helix',
    'logger',
    'workflow',
  ]

  it('exposes all 11 expected tags', () => {
    expect(EXPECTED_TAGS).toHaveLength(11)
    for (const tag of EXPECTED_TAGS) {
      expect(loggersByTag[tag]).toBeDefined()
    }
  })

  it('each tag value is a consola instance', () => {
    for (const tag of EXPECTED_TAGS) {
      const logger = loggersByTag[tag]
      expect(typeof logger?.info).toBe('function')
    }
  })

  it('loggersByTag entries are the same instances createLogger returns', () => {
    for (const tag of EXPECTED_TAGS) {
      expect(createLogger(tag)).toBe(loggersByTag[tag])
    }
  })
})

describe('setLogLevel', () => {
  it('sets consola.level to the provided value', () => {
    setLogLevel(0)
    expect(consola.level).toBe(0)
    setLogLevel(5)
    expect(consola.level).toBe(5)
  })

  it('defaults to level 3 when called with no argument', () => {
    setLogLevel(0)
    setLogLevel()
    expect(consola.level).toBe(3)
  })
})
