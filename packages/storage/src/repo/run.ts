import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createProjectDb } from '../db.js'
import { runs } from '../schema/project.js'

export async function createRun(projectName: string, projectId: string) {
  const { db } = createProjectDb(projectName)
  const id = randomUUID()
  const now = new Date().toISOString()
  db.insert(runs)
    .values({ id, projectId, status: 'pending', startedAt: now, currentRound: 0, bestF1: 0 })
    .run()
  return { id, projectId, status: 'pending' as const, startedAt: now }
}

export async function getRun(projectName: string, runId: string) {
  const { db } = createProjectDb(projectName)
  return db.select().from(runs).where(eq(runs.id, runId)).all()[0] ?? null
}

export async function listRuns(projectName: string) {
  const { db } = createProjectDb(projectName)
  return db.select().from(runs).all()
}

export async function updateRunStatus(
  projectName: string,
  runId: string,
  status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'stopped',
) {
  const { db } = createProjectDb(projectName)
  db.update(runs)
    .set({
      status,
      endedAt: ['completed', 'failed', 'stopped'].includes(status)
        ? new Date().toISOString()
        : null,
    })
    .where(eq(runs.id, runId))
    .run()
}

export async function saveResumeState(projectName: string, runId: string, blob: string) {
  const { db } = createProjectDb(projectName)
  db.update(runs).set({ resumeStateBlob: blob }).where(eq(runs.id, runId)).run()
}

export async function updateRound(
  projectName: string,
  runId: string,
  round: number,
  bestF1: number,
) {
  const { db } = createProjectDb(projectName)
  db.update(runs).set({ currentRound: round, bestF1 }).where(eq(runs.id, runId)).run()
}
