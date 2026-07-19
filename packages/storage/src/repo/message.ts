import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createProjectDb } from '../db.ts'
import { messages } from '../schema/project.ts'

export async function appendMessage(
  projectName: string,
  runId: string,
  role: 'user' | 'assistant' | 'system' | 'tool',
  parts: unknown[],
) {
  const { db } = createProjectDb(projectName)
  const id = randomUUID()
  const now = new Date().toISOString()
  db.insert(messages)
    .values({ id, runId, role, partsJson: JSON.stringify(parts), createdAt: now })
    .run()
  return { id, runId, role, parts, createdAt: now }
}

export async function listMessages(projectName: string, runId: string) {
  const { db } = createProjectDb(projectName)
  const rows = db.select().from(messages).where(eq(messages.runId, runId)).all()
  return rows.map(
    (r: { id: string; runId: string; role: string; partsJson: string; createdAt: string }) => ({
      id: r.id,
      runId: r.runId,
      role: r.role,
      parts: JSON.parse(r.partsJson) as unknown[],
      createdAt: r.createdAt,
    }),
  )
}
