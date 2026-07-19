import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getBaseDir, getProjectDbPath } from '@open-scientist/config'
import { createLogger } from '@open-scientist/logger'
import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateDb } from './migrations.ts'
import * as projectSchema from './schema/project.ts'
import { enableWal } from './wal.ts'

export type ProjectDb = {
  db: BetterSQLite3Database<typeof projectSchema>
  sqlite: Database.Database
  schema: typeof projectSchema
}

const logger = createLogger('storage')

// Cache key combines the current BASE_DIR with projectName, so tests that
// point BASE_DIR at a fresh temp dir get a fresh ProjectDb without needing
// vi.resetModules() to clear the module-level Map.
const cache = new Map<string, ProjectDb>()

function cacheKey(projectName: string): string {
  return `${getBaseDir()}:${projectName}`
}

export function createProjectDb(projectName: string): ProjectDb {
  const key = cacheKey(projectName)
  const existing = cache.get(key)
  if (existing) return existing

  const path = getProjectDbPath(projectName)
  mkdirSync(dirname(path), { recursive: true })

  logger.info('initializing project db', { project: projectName, path })

  const sqlite = new Database(path)
  enableWal(sqlite)

  const db = drizzle(sqlite, { schema: projectSchema })
  migrateDb(db, 'project')
  logger.info('project db migrated OK', { project: projectName })

  const result: ProjectDb = { db, sqlite, schema: projectSchema }
  cache.set(key, result)
  return result
}

export async function ensureProjectDb(projectName: string) {
  return createProjectDb(projectName)
}

export function closeProjectDb(projectName: string) {
  const key = cacheKey(projectName)
  const entry = cache.get(key)
  if (!entry) return
  entry.sqlite.close()
  cache.delete(key)
}
