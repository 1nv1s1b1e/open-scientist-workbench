import { eq } from 'drizzle-orm'
import { ValidationTaskSchema, type ValidationTask } from '@open-scientist/schema'
import { createProjectDb } from '../db.ts'
import { validationTasks } from '../schema/project.ts'

export type PersistedValidationTask = ValidationTask & { projectId: string; runId: string }

function fromRow(row: typeof validationTasks.$inferSelect): PersistedValidationTask {
  return {
    ...ValidationTaskSchema.parse({
      taskId: row.id,
      route: row.route,
      type: row.type,
      objective: row.objective,
      requiredSourceIds: JSON.parse(row.requiredSourceIdsJson) as string[],
      discriminatingOutcomes: JSON.parse(row.discriminatingOutcomesJson) as string[],
      triggeredBy: row.triggeredBy,
      status: row.status,
      resultEvidenceIds: JSON.parse(row.resultEvidenceIdsJson) as string[],
      round: row.round,
      fingerprint: row.fingerprint,
    }),
    projectId: row.projectId,
    runId: row.runId,
  }
}

export async function createValidationTask(
  projectName: string,
  task: PersistedValidationTask,
): Promise<PersistedValidationTask> {
  const parsed = ValidationTaskSchema.parse(task)
  const { db } = createProjectDb(projectName)
  const duplicate = db
    .select()
    .from(validationTasks)
    .where(eq(validationTasks.fingerprint, parsed.fingerprint))
    .all()[0]
  if (duplicate) return fromRow(duplicate)

  db.insert(validationTasks)
    .values({
      id: parsed.taskId,
      projectId: task.projectId,
      runId: task.runId,
      route: parsed.route,
      type: parsed.type,
      objective: parsed.objective,
      requiredSourceIdsJson: JSON.stringify(parsed.requiredSourceIds),
      discriminatingOutcomesJson: JSON.stringify(parsed.discriminatingOutcomes),
      triggeredBy: parsed.triggeredBy,
      status: parsed.status,
      resultEvidenceIdsJson: JSON.stringify(parsed.resultEvidenceIds),
      round: parsed.round,
      fingerprint: parsed.fingerprint,
      createdAt: new Date().toISOString(),
    })
    .run()
  return { ...parsed, projectId: task.projectId, runId: task.runId }
}

export async function listValidationTasks(
  projectName: string,
  options?: { runId?: string; round?: number },
): Promise<PersistedValidationTask[]> {
  const { db } = createProjectDb(projectName)
  let rows = db.select().from(validationTasks).all()
  if (options?.runId) rows = rows.filter((row) => row.runId === options.runId)
  if (options?.round !== undefined) rows = rows.filter((row) => row.round === options.round)
  return rows.map(fromRow)
}

export async function updateValidationTask(
  projectName: string,
  taskId: string,
  patch: Pick<ValidationTask, 'status' | 'resultEvidenceIds'>,
) {
  const parsed = ValidationTaskSchema.pick({ status: true, resultEvidenceIds: true }).parse(patch)
  const { db } = createProjectDb(projectName)
  db.update(validationTasks)
    .set({
      status: parsed.status,
      resultEvidenceIdsJson: JSON.stringify(parsed.resultEvidenceIds),
    })
    .where(eq(validationTasks.id, taskId))
    .run()
  const row = db.select().from(validationTasks).where(eq(validationTasks.id, taskId)).all()[0]
  return row ? fromRow(row) : null
}
