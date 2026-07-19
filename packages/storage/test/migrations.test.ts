import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `migrateDb` is NOT re-exported from src/index.ts (which only re-exports db,
// global-db, and the repo modules). Import it directly from its module.
type MigrateDb = (db: ReturnType<typeof drizzle>, scope: 'global' | 'project') => void

/**
 * Migration integration tests.
 *
 * `migrateDb` resolves the migrations folder via `resolveStorageRoot()`, which
 * honors the `STORAGE_MIGRATIONS_DIR` env var at *call time*. For the "happy
 * path" tests we leave it unset so the real `drizzle/{global,project}` folder
 * (resolved through the `@open-scientist/storage` package symlink) is used.
 *
 * Each test builds a fresh `Database` on a temp file path and closes it in
 * `afterEach`. `vi.resetModules()` is used so the `env` module reloads
 * `BASE_DIR` per test.
 */

interface StorageModule {
  migrateDb: MigrateDb
}

async function loadStorage(baseDir: string): Promise<StorageModule> {
  vi.resetModules()
  process.env.BASE_DIR = baseDir
  // Direct import from migrations.js — migrateDb is not in the barrel export.
  const mod = (await import('../src/migrations.js')) as { migrateDb: MigrateDb }
  return { migrateDb: mod.migrateDb }
}

function makeBaseDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `os-storage-mig-${label}-`))
}

function tableNames(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
      name: string
    }>
  ).map((r) => r.name)
}

function migrationCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as { c: number }).c
}

describe('migrations: global scope', () => {
  let baseDir: string
  let sqlite: Database.Database
  let storage: StorageModule

  beforeEach(async () => {
    baseDir = makeBaseDir('global')
    storage = await loadStorage(baseDir)
    sqlite = new Database(join(baseDir, 'g.sqlite'))
  })

  afterEach(() => {
    sqlite.close()
    rmSync(baseDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('creates all 4 business tables + __drizzle_migrations', () => {
    const db = drizzle(sqlite)
    storage.migrateDb(db, 'global')

    const tables = tableNames(sqlite)
    expect(tables).toContain('credentials')
    expect(tables).toContain('settings')
    expect(tables).toContain('mcp_trust')
    expect(tables).toContain('mcp_tool_baselines')
    expect(tables).toContain('__drizzle_migrations')
  })

  it('is idempotent: running twice does not throw or duplicate migrations', () => {
    const db = drizzle(sqlite)
    storage.migrateDb(db, 'global')
    expect(() => storage.migrateDb(db, 'global')).not.toThrow()

    // The `credentials` table must still appear exactly once.
    const creds = tableNames(sqlite).filter((n) => n === 'credentials')
    expect(creds).toHaveLength(1)

    // __drizzle_migrations should record exactly one applied migration.
    expect(migrationCount(sqlite)).toBe(1)
  })
})

describe('migrations: project scope', () => {
  let baseDir: string
  let sqlite: Database.Database
  let storage: StorageModule

  beforeEach(async () => {
    baseDir = makeBaseDir('project')
    storage = await loadStorage(baseDir)
    sqlite = new Database(join(baseDir, 'p.sqlite'))
  })

  afterEach(() => {
    sqlite.close()
    rmSync(baseDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('creates all 10 business tables + __drizzle_migrations', () => {
    const db = drizzle(sqlite)
    storage.migrateDb(db, 'project')

    const tables = tableNames(sqlite)
    const expected = [
      'projects',
      'runs',
      'messages',
      'steering_messages',
      'hypotheses',
      'evidence',
      'critiques',
      'mutations',
      'plans',
      'logs',
    ]
    for (const name of expected) {
      expect(tables).toContain(name)
    }
    expect(tables).toContain('__drizzle_migrations')
  })

  it('is idempotent: running twice does not throw', () => {
    const db = drizzle(sqlite)
    storage.migrateDb(db, 'project')
    expect(() => storage.migrateDb(db, 'project')).not.toThrow()
    expect(migrationCount(sqlite)).toBe(1)
  })
})

describe('migrations: error handling', () => {
  let baseDir: string
  let sqlite: Database.Database
  let storage: StorageModule
  let saved: string | undefined

  beforeEach(async () => {
    baseDir = makeBaseDir('err')
    storage = await loadStorage(baseDir)
    sqlite = new Database(join(baseDir, 'e.sqlite'))
    saved = process.env.STORAGE_MIGRATIONS_DIR
  })

  afterEach(() => {
    sqlite.close()
    rmSync(baseDir, { recursive: true, force: true })
    if (saved === undefined) delete process.env.STORAGE_MIGRATIONS_DIR
    else process.env.STORAGE_MIGRATIONS_DIR = saved
    vi.resetModules()
  })

  it('throws a clear error when the migrations folder does not exist', () => {
    process.env.STORAGE_MIGRATIONS_DIR = '/nonexistent-migrations-dir-12345'
    const db = drizzle(sqlite)
    expect(() => storage.migrateDb(db, 'global')).toThrow(/migrations folder not found/)
  })
})
