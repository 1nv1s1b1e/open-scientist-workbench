import { and, eq } from 'drizzle-orm'
import { getGlobalDb } from '../global-db.js'
import { settings } from '../schema/global.js'

export async function getSetting(scope: string, name: string): Promise<unknown | null> {
  const { db } = await getGlobalDb()
  const rows = db
    .select()
    .from(settings)
    .where(and(eq(settings.scope, scope), eq(settings.name, name)))
    .all()
  if (rows.length === 0) return null
  return JSON.parse(rows[0]!.valueJson)
}

export async function setSetting(scope: string, name: string, value: unknown): Promise<void> {
  const { db } = await getGlobalDb()
  const now = new Date().toISOString()
  db.insert(settings)
    .values({ scope, name, valueJson: JSON.stringify(value), updatedAt: now })
    .onConflictDoUpdate({
      target: [settings.scope, settings.name],
      set: { valueJson: JSON.stringify(value), updatedAt: now },
    })
    .run()
}
