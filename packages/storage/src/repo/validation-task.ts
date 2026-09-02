import { and, eq } from 'drizzle-orm'
import { ValidationTaskSchema, type ValidationTask } from '@open-scientist/schema'
import { createProjectDb } from '../db.ts'
import { validationTasks } from '../schema/project.ts'

export type PersistedValidationTask = ValidationTask & { projectId: string; runId: string }

function fromRow(row: typeof validationTasks.$inferSelect): PersistedValidationTask {
  return {
    ...ValidationTaskSchema.parse({
      taskId: row.id,
      ...(row.executorId ? { executorId: row.executorId } : {}),
      route: row.route,
      type: row.type,
      objective: row.objective,
      hypothesisIds: JSON.parse(row.hypothesisIdsJson) as string[],
      predictionIds: JSON.parse(row.predictionIdsJson) as string[],
      falsificationConditionIds: JSON.parse(row.falsificationConditionIdsJson) as string[],
      requiredSourceIds: JSON.parse(row.requiredSourceIdsJson) as string[],
      requiredData: JSON.parse(row.requiredDataJson) as string[],
      requiredFacilities: JSON.parse(row.requiredFacilitiesJson) as string[],
      ...(row.readiness ? { readiness: row.readiness } : {}),
      ...(row.expectedDuration ? { expectedDuration: row.expectedDuration } : {}),
      ...(row.estimatedStorageBytes !== null
        ? { estimatedStorageBytes: row.estimatedStorageBytes }
        : {}),
      successCriteria: JSON.parse(row.successCriteriaJson) as string[],
      failureCriteria: JSON.parse(row.failureCriteriaJson) as string[],
      ...(row.blockedReason ? { blockedReason: row.blockedReason } : {}),
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
    .where(
      and(
        eq(validationTasks.runId, task.runId),
        eq(validationTasks.fingerprint, parsed.fingerprint),
      ),
    )
    .all()[0]
  if (duplicate) {
    db.update(validationTasks)
      .set({
        executorId: parsed.executorId ?? null,
        route: parsed.route,
        type: parsed.type,
        objective: parsed.objective,
        hypothesisIdsJson: JSON.stringify(parsed.hypothesisIds),
        predictionIdsJson: JSON.stringify(parsed.predictionIds),
        falsificationConditionIdsJson: JSON.stringify(parsed.falsificationConditionIds),
        requiredSourceIdsJson: JSON.stringify(parsed.requiredSourceIds),
        requiredDataJson: JSON.stringify(parsed.requiredData ?? []),
        requiredFacilitiesJson: JSON.stringify(parsed.requiredFacilities ?? []),
        readiness: parsed.readiness ?? null,
        expectedDuration: parsed.expectedDuration ?? null,
        estimatedStorageBytes: parsed.estimatedStorageBytes ?? null,
        successCriteriaJson: JSON.stringify(parsed.successCriteria ?? []),
        failureCriteriaJson: JSON.stringify(parsed.failureCriteria ?? []),
        blockedReason: parsed.blockedReason ?? null,
        discriminatingOutcomesJson: JSON.stringify(parsed.discriminatingOutcomes),
        triggeredBy: parsed.triggeredBy,
        status: parsed.status,
        resultEvidenceIdsJson: JSON.stringify(parsed.resultEvidenceIds),
        round: parsed.round,
      })
      .where(eq(validationTasks.id, duplicate.id))
      .run()
    const updated = db
      .select()
      .from(validationTasks)
      .where(eq(validationTasks.id, duplicate.id))
      .all()[0]
    return fromRow(updated!)
  }

  const idCollision = db
    .select()
    .from(validationTasks)
    .where(eq(validationTasks.id, parsed.taskId))
    .all()[0]
  if (idCollision && idCollision.runId !== task.runId) {
    throw new Error(`Validation task id collision across runs: ${parsed.taskId}`)
  }

  db.insert(validationTasks)
    .values({
      id: parsed.taskId,
      projectId: task.projectId,
      runId: task.runId,
      executorId: parsed.executorId ?? null,
      route: parsed.route,
      type: parsed.type,
      objective: parsed.objective,
      hypothesisIdsJson: JSON.stringify(parsed.hypothesisIds),
      predictionIdsJson: JSON.stringify(parsed.predictionIds),
      falsificationConditionIdsJson: JSON.stringify(parsed.falsificationConditionIds),
      requiredSourceIdsJson: JSON.stringify(parsed.requiredSourceIds),
      requiredDataJson: JSON.stringify(parsed.requiredData ?? []),
      requiredFacilitiesJson: JSON.stringify(parsed.requiredFacilities ?? []),
      readiness: parsed.readiness ?? null,
      expectedDuration: parsed.expectedDuration ?? null,
      estimatedStorageBytes: parsed.estimatedStorageBytes ?? null,
      successCriteriaJson: JSON.stringify(parsed.successCriteria ?? []),
      failureCriteriaJson: JSON.stringify(parsed.failureCriteria ?? []),
      blockedReason: parsed.blockedReason ?? null,
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
