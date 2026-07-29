import { randomUUID } from 'node:crypto'
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
