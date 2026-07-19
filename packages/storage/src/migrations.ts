import { createHash } from 'node:crypto'
import { readFileSync, type Stats, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLogger } from '@open-scientist/logger'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { MigrationMeta } from 'drizzle-orm/migrator'

const logger = createLogger('storage')

export type MigrationScope = 'global' | 'project'

/**
 * Resolve the `@open-scientist/storage` package root directory.
 *
 * Under `nitro dev` (rolldown bundle in `apps/api/node_modules/.nitro/dev/index.mjs`)
 * `import.meta.url` points at the bundled file, not the source — so it cannot
 * locate the sibling `drizzle/` directory. Instead we rely on Node's module
 * resolution: pnpm hoists workspace packages into `node_modules` as symlinks,
 * so `require.resolve('@open-scientist/storage')` resolves to the real
 * `packages/storage/src/index.ts` from any location inside the app.
 *
 * `STORAGE_MIGRATIONS_DIR` env var overrides for deployments where the
 * package is not resolvable (e.g. a stripped production image).
 */
function resolveStorageRoot(): string {
  const override = process.env.STORAGE_MIGRATIONS_DIR
  if (override) {
    logger.debug('using STORAGE_MIGRATIONS_DIR override', { dir: override })
    return override
  }

  // createResolve needs a URL context. Under nitro dev the storage source is
  // inlined into the bundle so import.meta.url points at the bundle, not the
  // source — but that's fine: Node walks up node_modules from the bundle's
  // directory and finds the @open-scientist/storage symlink (pnpm hoisted).
  const here = import.meta.url ?? pathToFileURL(`${process.cwd()}/`)
  const require = createRequire(here)
  const entry = require.resolve('@open-scientist/storage')
  // entry = packages/storage/src/index.ts → package root = dirname twice
  return resolve(dirname(entry), '..')
}

/**
 * Read drizzle migration files for a scope and return MigrationMeta[].
 *
 * Re-implements drizzle-orm's `readMigrationFiles` (which only accepts a
 * folder path and fails silently when the folder is missing under bundlers)
 * so the folder can be resolved reliably (see {@link resolveStorageRoot}).
 */
function readMigrations(migrationsFolder: string): MigrationMeta[] {
  const journalPath = join(migrationsFolder, 'meta', '_journal.json')
  const journalRaw = readFileSync(journalPath, 'utf8')
  const journal = JSON.parse(journalRaw) as {
    entries: Array<{ tag: string; when: number; breakpoints: boolean }>
  }

  return journal.entries.map((entry) => {
    const sqlPath = join(migrationsFolder, `${entry.tag}.sql`)
    const query = readFileSync(sqlPath, 'utf8')
    return {
      sql: query.split('--> statement-breakpoint').map((s) => s.trim()),
      bps: entry.breakpoints,
      folderMillis: entry.when,
      hash: createHash('sha256').update(query).digest('hex'),
    }
  })
}

/**
 * Run drizzle migrations for the given scope against a better-sqlite3 drizzle db.
 *
 * Uses `db.dialect.migrate(migrations, db.session)` directly (the same path
 * `drizzle-orm/better-sqlite3`'s `migrate()` takes), bypassing the folder-based
 * `readMigrationFiles` so the migrations folder can be resolved robustly.
 *
 * Idempotency: drizzle creates a `__drizzle_migrations` table and records each
 * migration's hash + folderMillis; already-applied migrations are skipped.
 */
export function migrateDb<TSchema extends Record<string, unknown>>(
  db: BetterSQLite3Database<TSchema>,
  scope: MigrationScope,
): void {
  const storageRoot = resolveStorageRoot()
  const migrationsFolder = join(storageRoot, 'drizzle', scope)

  logger.info('running drizzle migrations', { scope, migrationsFolder })

  // Fail loudly if the folder is missing — drizzle's own migrate() swallows
  // this case silently, which is exactly the bug we're working around.
  let stat: Stats
  try {
    stat = statSync(migrationsFolder)
  } catch (e) {
    throw new Error(
      `[storage] drizzle migrations folder not found: ${migrationsFolder}. ` +
        `Set STORAGE_MIGRATIONS_DIR or check the @open-scientist/storage symlink. ` +
        `Underlying error: ${(e as Error).message}`,
    )
  }
  if (!stat.isDirectory()) {
    throw new Error(`[storage] drizzle migrations path is not a directory: ${migrationsFolder}`)
  }

  const migrations = readMigrations(migrationsFolder)
  logger.info('migrations loaded', { scope, count: migrations.length })

  // `db.dialect` and `db.session` are @internal on BaseSQLiteDatabase's type
  // but exist at runtime (drizzle's own migrate() uses them the same way).
  // SQLiteSyncDialect.migrate(migrations, session, config?) creates the
  // __drizzle_migrations table and applies each migration once (idempotent).
  // biome-ignore lint/suspicious/noExplicitAny: drizzle marks dialect/session @internal; accessing at runtime matches drizzle's own migrate() implementation
  const internal = db as any
  internal.dialect.migrate(migrations, internal.session)
  logger.info('migrations applied OK', { scope })
}
