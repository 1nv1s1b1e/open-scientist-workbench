import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getGlobalDbPath } from '@open-scientist/config'
import { createLogger } from '@open-scientist/logger'
import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateDb } from './migrations.ts'
import * as globalSchema from './schema/global.ts'
import { enableWal } from './wal.ts'

type GlobalDb = {
  db: BetterSQLite3Database<typeof globalSchema>
  sqlite: Database.Database
  schema: typeof globalSchema
}

const logger = createLogger('storage')

// Cache by db path (derived from BASE_DIR) instead of a single global
// singleton, so different BASE_DIR values get distinct instances — tests no
// longer need vi.resetModules() to swap BASE_DIR.
const cache = new Map<string, GlobalDb>()

export async function getGlobalDb() {
  const path = getGlobalDbPath()
  const existing = cache.get(path)
  if (existing) return existing

  await mkdir(dirname(path), { recursive: true })

  logger.info('initializing global db', { path })

  const sqlite = new Database(path)
  enableWal(sqlite)

  const db = drizzle(sqlite, { schema: globalSchema })
  migrateDb(db, 'global')
  logger.info('global db migrated OK')

  const result: GlobalDb = { db, sqlite, schema: globalSchema }
  cache.set(path, result)
  return result
}

// Close + evict a single cached instance by path, or all of them when no
// path is given. Tests call this in afterEach so sqlite handles release and
// temp dirs can be removed.
export function closeGlobalDb(path?: string) {
  if (path) {
    const entry = cache.get(path)
    if (entry) {
      entry.sqlite.close()
      cache.delete(path)
    }
    return
  }
  for (const entry of cache.values()) entry.sqlite.close()
  cache.clear()
}
