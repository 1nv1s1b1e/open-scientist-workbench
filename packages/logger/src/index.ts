import { type ConsolaInstance, consola } from 'consola'

export type { ConsolaInstance }
export { consola }

export type LoggerTag =
  | 'app'
  | 'api'
  | 'storage'
  | 'config'
  | 'agents'
  | 'tools'
  | 'skills'
  | 'mcp'
  | 'helix'
  | 'logger'
  | 'workflow'

const TAGS: LoggerTag[] = [
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

const loggers = new Map<LoggerTag, ConsolaInstance>()

export function createLogger(tag: LoggerTag): ConsolaInstance {
  let logger = loggers.get(tag)
  if (logger) return logger
  logger = consola.withTag(tag)
  loggers.set(tag, logger)
  return logger
}

export const loggersByTag: Readonly<Record<LoggerTag, ConsolaInstance>> = TAGS.reduce(
  (acc, tag) => {
    acc[tag] = createLogger(tag)
    return acc
  },
  {} as Record<LoggerTag, ConsolaInstance>,
)

export function setLogLevel(level: 0 | 1 | 2 | 3 | 4 | 5 = 3): void {
  consola.level = level
}
