import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getGlobalDbPath } from '@open-scientist/config'
import { createLogger } from '@open-scientist/logger'
import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateDb } from './migrations.js'
import * as globalSchema from './schema/global.js'
import { enableWal } from './wal.js'

type GlobalDb = {
  db: BetterSQLite3Database<typeof globalSchema>
  sqlite: Database.Database
  schema: typeof globalSchema
}

const logger = createLogger('storage')
let global: GlobalDb | null = null

export async function getGlobalDb() {
  if (global) return global

  const path = getGlobalDbPath()
  await mkdir(dirname(path), { recursive: true })

  logger.info('initializing global db', { path })

  const sqlite = new Database(path)
  enableWal(sqlite)

  const db = drizzle(sqlite, { schema: globalSchema })
  migrateDb(db, 'global')
  logger.info('global db migrated OK')

  global = { db, sqlite, schema: globalSchema }
  return global
}
