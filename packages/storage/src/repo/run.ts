import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createProjectDb } from '../db.js'
import { runs } from '../schema/project.js'

export type RunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'stopped'

/**
 * Optional overrides for {@link createRun}.
 *
 * By default `createRun` mints a fresh UUID for the run id and seeds
 * `status='pending'`. The API layer, however, drives the workflow via
 * `start(tournamentWorkflow, ...)` which returns its own run id — that id must
 * be persisted so subsequent `GET /stream` / `POST /stop` requests (which carry
 * the SDK run id from the `x-workflow-run-id` response header) can look the run
 * up. Callers therefore pass `{ id: run.runId, status: 'running' }`.
 */
export interface CreateRunOptions {
  /** Explicit run id (e.g. the SDK `Run.runId`). Defaults to a fresh UUID. */
  id?: string
  /** Initial status. Defaults to `'pending'`. */
  status?: RunStatus
}

export async function createRun(
  projectName: string,
  projectId: string,
  options?: CreateRunOptions,
) {
  const { db } = createProjectDb(projectName)
  const id = options?.id ?? randomUUID()
  const status: RunStatus = options?.status ?? 'pending'
  const now = new Date().toISOString()
  db.insert(runs)
    .values({ id, projectId, status, startedAt: now, currentRound: 0, bestF1: 0 })
    .run()
  return { id, projectId, status, startedAt: now }
}

export async function getRun(projectName: string, runId: string) {
  const { db } = createProjectDb(projectName)
  return db.select().from(runs).where(eq(runs.id, runId)).all()[0] ?? null
}

export async function listRuns(projectName: string) {
  const { db } = createProjectDb(projectName)
  return db.select().from(runs).all()
}

export async function updateRunStatus(projectName: string, runId: string, status: RunStatus) {
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
