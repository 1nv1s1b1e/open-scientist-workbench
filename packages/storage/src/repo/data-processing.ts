import { desc } from 'drizzle-orm'
import {
  ArtifactRefSchema,
  DataSnapshotRefSchema,
  ProcessingRunSchema,
  type ArtifactRef,
  type DataSnapshotRef,
  type ProcessingRun,
} from '@open-scientist/schema'
import { createProjectDb } from '../db.ts'
import { artifacts, dataSnapshots, processingRuns } from '../schema/project.ts'

export async function createDataSnapshot(
  projectName: string,
  projectId: string,
  runId: string,
  snapshot: DataSnapshotRef,
): Promise<DataSnapshotRef> {
  const parsed = DataSnapshotRefSchema.parse(snapshot)
  const { db } = createProjectDb(projectName)
  db.insert(dataSnapshots)
    .values({
      id: parsed.snapshotId,
      projectId,
      runId,
      sourceIdsJson: JSON.stringify(parsed.sourceIds),
      manifestPath: parsed.manifestPath,
      checksumsJson: JSON.stringify(parsed.checksums),
      selectionJson: JSON.stringify(parsed.selection),
      createdAt: parsed.createdAt,
    })
    .run()
  return parsed
}

export async function listDataSnapshots(
  projectName: string,
  options?: { runId?: string; limit?: number },
): Promise<DataSnapshotRef[]> {
  const { db } = createProjectDb(projectName)
  let rows = db.select().from(dataSnapshots).orderBy(desc(dataSnapshots.createdAt)).all()
  if (options?.runId) rows = rows.filter((row) => row.runId === options.runId)
  return rows.slice(0, options?.limit ?? 50).map((row) =>
    DataSnapshotRefSchema.parse({
      snapshotId: row.id,
      sourceIds: JSON.parse(row.sourceIdsJson),
      manifestPath: row.manifestPath,
      checksums: JSON.parse(row.checksumsJson),
      selection: JSON.parse(row.selectionJson),
      createdAt: row.createdAt,
    }),
  )
}

export async function createArtifact(
  projectName: string,
  projectId: string,
  runId: string,
  artifact: ArtifactRef,
): Promise<ArtifactRef> {
  const parsed = ArtifactRefSchema.parse(artifact)
  const { db } = createProjectDb(projectName)
  db.insert(artifacts)
    .values({
      id: parsed.artifactId,
      projectId,
      runId,
      kind: parsed.kind,
      path: parsed.path,
      checksum: parsed.checksum,
      mediaType: parsed.mediaType ?? null,
      generatedBy: parsed.generatedBy,
      processingRunId: parsed.processingRunId,
      sourceIdsJson: JSON.stringify(parsed.sourceIds),
      createdAt: parsed.createdAt,
    })
    .run()
  return parsed
}

export async function listArtifacts(
  projectName: string,
  options?: { runId?: string; processingRunId?: string; limit?: number },
): Promise<ArtifactRef[]> {
  const { db } = createProjectDb(projectName)
  let rows = db.select().from(artifacts).orderBy(desc(artifacts.createdAt)).all()
  if (options?.runId) rows = rows.filter((row) => row.runId === options.runId)
  if (options?.processingRunId) {
    rows = rows.filter((row) => row.processingRunId === options.processingRunId)
  }
  return rows.slice(0, options?.limit ?? 100).map((row) =>
    ArtifactRefSchema.parse({
      artifactId: row.id,
      kind: row.kind,
      path: row.path,
      checksum: row.checksum,
      ...(row.mediaType ? { mediaType: row.mediaType } : {}),
      generatedBy: row.generatedBy,
      processingRunId: row.processingRunId,
      sourceIds: JSON.parse(row.sourceIdsJson),
      createdAt: row.createdAt,
    }),
  )
}

export async function createProcessingRun(
  projectName: string,
  processingRun: ProcessingRun,
): Promise<ProcessingRun> {
  const parsed = ProcessingRunSchema.parse(processingRun)
  const { db } = createProjectDb(projectName)
  db.insert(processingRuns)
    .values({
      id: parsed.processingRunId,
      projectId: parsed.projectId,
      runId: parsed.runId,
      round: parsed.round,
      agentId: parsed.agentId,
      taskId: parsed.taskId ?? null,
      triggeredBy: parsed.triggeredBy,
      snapshotIdsJson: JSON.stringify(parsed.snapshotIds),
      stepsJson: JSON.stringify(parsed.steps),
      deterministic: parsed.deterministic,
      status: parsed.status,
      outputArtifactIdsJson: JSON.stringify(parsed.outputArtifactIds),
      metricsArtifactId: parsed.metricsArtifactId ?? null,
      limitationsJson: JSON.stringify(parsed.limitations),
      fingerprint: parsed.fingerprint,
      startedAt: parsed.startedAt,
      completedAt: parsed.completedAt ?? null,
    })
    .run()
  return parsed
}

export async function listProcessingRuns(
  projectName: string,
  options?: { runId?: string; agentId?: string; limit?: number },
): Promise<ProcessingRun[]> {
  const { db } = createProjectDb(projectName)
  let rows = db.select().from(processingRuns).orderBy(desc(processingRuns.startedAt)).all()
  if (options?.runId) rows = rows.filter((row) => row.runId === options.runId)
  if (options?.agentId) rows = rows.filter((row) => row.agentId === options.agentId)
  return rows.slice(0, options?.limit ?? 50).map((row) =>
    ProcessingRunSchema.parse({
      processingRunId: row.id,
      projectId: row.projectId,
      runId: row.runId,
      round: row.round,
      agentId: row.agentId,
      ...(row.taskId ? { taskId: row.taskId } : {}),
      triggeredBy: row.triggeredBy,
      snapshotIds: JSON.parse(row.snapshotIdsJson),
      steps: JSON.parse(row.stepsJson),
      deterministic: row.deterministic,
      status: row.status,
      outputArtifactIds: JSON.parse(row.outputArtifactIdsJson),
      ...(row.metricsArtifactId ? { metricsArtifactId: row.metricsArtifactId } : {}),
      limitations: JSON.parse(row.limitationsJson),
      fingerprint: row.fingerprint,
      startedAt: row.startedAt,
      ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    }),
  )
}
