import { randomUUID } from 'node:crypto'
import type { HypothesisStatus } from '@open-scientist/schema'
import { eq } from 'drizzle-orm'
import { createProjectDb } from '../db.js'
import { hypotheses } from '../schema/project.js'

export async function createHypothesis(
  projectName: string,
  projectId: string,
  runId: string,
  data: { statement: string; pythonCode: string; round: number; parentId?: string | null },
) {
  const { db } = createProjectDb(projectName)
  const id = randomUUID()
  const now = new Date().toISOString()
  db.insert(hypotheses)
    .values({
      id,
      projectId,
      runId,
      parentId: data.parentId ?? null,
      round: data.round,
      statement: data.statement,
      pythonCode: data.pythonCode,
      status: 'candidate',
      createdAt: now,
    })
    .run()
  return { id, ...data, status: 'candidate' as HypothesisStatus, createdAt: now, f1: null }
}

export async function getHypothesis(projectName: string, hypoId: string) {
  const { db } = createProjectDb(projectName)
  return db.select().from(hypotheses).where(eq(hypotheses.id, hypoId)).all()[0] ?? null
}

export async function listHypothesesByRun(projectName: string, runId: string) {
  const { db } = createProjectDb(projectName)
  return db.select().from(hypotheses).where(eq(hypotheses.runId, runId)).all()
}

export async function updateHypothesisStatus(
  projectName: string,
  hypoId: string,
  status: HypothesisStatus,
  f1?: number,
) {
  const { db } = createProjectDb(projectName)
  const updates: Record<string, unknown> = { status }
  if (f1 !== undefined) updates.f1 = f1
  db.update(hypotheses).set(updates).where(eq(hypotheses.id, hypoId)).run()
}
