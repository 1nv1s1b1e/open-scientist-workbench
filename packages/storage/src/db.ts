import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getProjectDbPath } from '@open-scientist/config'
import { createLogger } from '@open-scientist/logger'
import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateDb } from './migrations.js'
import * as projectSchema from './schema/project.js'
import { enableWal } from './wal.js'

export type ProjectDb = {
  db: BetterSQLite3Database<typeof projectSchema>
  sqlite: Database.Database
  schema: typeof projectSchema
}

const logger = createLogger('storage')
const cache = new Map<string, ProjectDb>()

export function createProjectDb(projectName: string): ProjectDb {
  const existing = cache.get(projectName)
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
  cache.set(projectName, result)
  return result
}

export async function ensureProjectDb(projectName: string) {
  return createProjectDb(projectName)
}

export function closeProjectDb(projectName: string) {
  const entry = cache.get(projectName)
  if (!entry) return
  entry.sqlite.close()
  cache.delete(projectName)
}
