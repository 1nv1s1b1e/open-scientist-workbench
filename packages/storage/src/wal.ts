import type Database from 'better-sqlite3'

export function enableWal(db: Database.Database) {
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA synchronous = NORMAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
}
