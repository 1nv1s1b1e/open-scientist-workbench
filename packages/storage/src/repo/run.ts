import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createProjectDb } from '../db.ts'
import { runs } from '../schema/project.ts'

export type RunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'stopped'

export type WorkflowType = 'tournament' | 'scientific-loop'
export type ScientificRunStatus =
  | 'supported'
  | 'inconclusive'
  | 'needs_data'
  | 'needs_external_validation'
  | 'falsified'
  | 'mixed'
  | 'blocked'

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
  workflowType?: WorkflowType
  /** Secret-free, reproducibility-relevant configuration only. */
  config?: Record<string, unknown>
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
    .values({
      id,
      projectId,
      status,
      startedAt: now,
      currentRound: 0,
      bestF1: 0,
      workflowType: options?.workflowType ?? 'tournament',
      configJson: options?.config ? JSON.stringify(options.config) : null,
    })
    .run()
  return { id, projectId, status, startedAt: now }
}

export async function getRun(projectName: string, runId: string) {
  const { db } = createProjectDb(projectName)
  return db.select().from(runs).where(eq(runs.id, runId)).all()[0] ?? null
}

export async function listRuns(projectName: string) {
  const { db } = createProjectDb(projectName)
  return db.select().from(runs).orderBy(runs.startedAt).all()
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

/**
 * Mark a run as completed (or failed) with final metrics.
 *
 * Called by the API layer when `run.result` settles — updates the SQLite row
 * with the tournament's final `bestF1` + `currentRound` + `endedAt` in a
 * single write, so GET /runs/:id returns accurate status after the SSE stream
 * ends.
 */
export async function completeRun(
  projectName: string,
  runId: string,
  status: 'completed' | 'failed',
  metrics?: {
    bestF1?: number
    currentRound?: number
    scientificStatus?: ScientificRunStatus
    terminationReason?: string
    result?: unknown
  },
) {
  const { db } = createProjectDb(projectName)
  db.update(runs)
    .set({
      status,
      endedAt: new Date().toISOString(),
      ...(metrics?.bestF1 !== undefined ? { bestF1: metrics.bestF1 } : {}),
      ...(metrics?.currentRound !== undefined ? { currentRound: metrics.currentRound } : {}),
      ...(metrics?.scientificStatus !== undefined
        ? { scientificStatus: metrics.scientificStatus }
        : {}),
      ...(metrics?.terminationReason !== undefined
        ? { terminationReason: metrics.terminationReason }
        : {}),
      ...(metrics?.result !== undefined ? { resultJson: JSON.stringify(metrics.result) } : {}),
    })
    .where(eq(runs.id, runId))
    .run()
}
