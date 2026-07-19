import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getGlobalDb } from '../global-db.ts'
import { mcpToolBaselines, mcpTrust } from '../schema/global.ts'

export async function getTrust(projectName: string, serverName: string) {
  const { db } = await getGlobalDb()
  const rows = db.select().from(mcpTrust).where(eq(mcpTrust.serverName, serverName)).all()
  return rows.find((r) => r.projectName === projectName) ?? null
}

export async function setTrust(
  projectName: string,
  serverName: string,
  fingerprint: string,
  trusted: boolean,
) {
  const { db } = await getGlobalDb()
  const id = randomUUID()
  const now = new Date().toISOString()
  db.insert(mcpTrust)
    .values({ id, projectName, serverName, fingerprint, trusted, firstSeen: now, lastChecked: now })
    .run()
}

export async function addToolBaseline(trustId: string, toolName: string, digest: string) {
  const { db } = await getGlobalDb()
  const id = randomUUID()
  const now = new Date().toISOString()
  db.insert(mcpToolBaselines).values({ id, trustId, toolName, digest, recordedAt: now }).run()
}
