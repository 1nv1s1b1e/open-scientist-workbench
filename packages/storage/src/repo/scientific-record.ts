import { desc, eq } from 'drizzle-orm'
import {
  EvidenceRecordSchema,
  ScientificCorrectionSchema,
  ScientificHypothesisSchema,
  type EvidenceRecord,
  type ScientificCorrection,
  type ScientificHypothesis,
} from '@open-scientist/schema'
import { createProjectDb } from '../db.ts'
import {
  scientificCorrections,
  scientificEvidence,
  scientificHypotheses,
} from '../schema/project.ts'

export interface ScientificRecordBatch {
  projectId: string
  runId: string
  hypotheses: readonly ScientificHypothesis[]
  evidence: readonly EvidenceRecord[]
  corrections: readonly ScientificCorrection[]
}

export interface ScientificRecordPersistResult {
  hypothesisCount: number
  evidenceCount: number
  correctionCount: number
}

function upsertHypothesis(
  db: ReturnType<typeof createProjectDb>['db'],
  row: typeof scientificHypotheses.$inferInsert,
): void {
  const existing = db.select().from(scientificHypotheses).where(eq(scientificHypotheses.id, row.id)).all()[0]
  if (existing) {
    db.update(scientificHypotheses).set(row).where(eq(scientificHypotheses.id, row.id)).run()
  } else {
    db.insert(scientificHypotheses).values(row).run()
  }
}

function upsertEvidence(
  db: ReturnType<typeof createProjectDb>['db'],
  row: typeof scientificEvidence.$inferInsert,
): void {
  const existing = db.select().from(scientificEvidence).where(eq(scientificEvidence.id, row.id)).all()[0]
  if (existing) {
    db.update(scientificEvidence).set(row).where(eq(scientificEvidence.id, row.id)).run()
  } else {
    db.insert(scientificEvidence).values(row).run()
  }
}

function upsertCorrection(
  db: ReturnType<typeof createProjectDb>['db'],
  row: typeof scientificCorrections.$inferInsert,
): void {
  const existing = db.select().from(scientificCorrections).where(eq(scientificCorrections.id, row.id)).all()[0]
  if (existing) {
    db.update(scientificCorrections).set(row).where(eq(scientificCorrections.id, row.id)).run()
  } else {
    db.insert(scientificCorrections).values(row).run()
  }
}

export async function persistScientificRecords(
  projectName: string,
  batch: ScientificRecordBatch,
): Promise<ScientificRecordPersistResult> {
  // Parse the complete batch before writing anything. In particular, this
  // rejects decisive evidence without deterministic processing provenance.
  const hypotheses = batch.hypotheses.map((item) => ScientificHypothesisSchema.parse(item))
  const evidence = batch.evidence.map((item) => EvidenceRecordSchema.parse(item))
  const corrections = batch.corrections.map((item) => ScientificCorrectionSchema.parse(item))
  const { db } = createProjectDb(projectName)
  const createdAt = new Date().toISOString()

  for (const item of hypotheses) {
    upsertHypothesis(db, {
      id: item.id,
      projectId: batch.projectId,
      runId: batch.runId,
      round: item.round,
      statement: item.statement,
      mechanismCompositionJson: JSON.stringify(item.mechanismComposition),
      predictionsJson: JSON.stringify(item.predictions),
      falsificationConditionsJson: JSON.stringify(item.falsificationConditions),
      sourceIdsJson: JSON.stringify(item.sourceIds),
      scope: item.scope,
      confidence: item.confidence,
      parentId: item.parentId,
      status: item.status,
      createdAt,
    })
  }
  for (const item of evidence) {
    upsertEvidence(db, {
      id: item.evidenceId,
      projectId: batch.projectId,
      runId: batch.runId,
      round: item.round,
      hypothesisId: item.hypothesisId ?? null,
      taskId: item.taskId ?? null,
      agentId: item.agentId ?? null,
      status: item.status,
      claim: item.claim,
      observed: item.observed,
      method: item.method,
      sourceIdsJson: JSON.stringify(item.sourceIds),
      sampleIdsJson: JSON.stringify(item.sampleIds),
      provenanceJson: item.provenance ? JSON.stringify(item.provenance) : null,
      metricsJson: item.metrics ? JSON.stringify(item.metrics) : null,
      uncertainty: item.uncertainty ?? null,
      limitationsJson: JSON.stringify(item.limitations),
      createdAt,
    })
  }
  for (const item of corrections) {
    upsertCorrection(db, {
      id: item.correctionId,
      projectId: batch.projectId,
      runId: batch.runId,
      round: item.round,
      stage: item.stage,
      kind: item.kind,
      severity: item.severity,
      message: item.message,
      action: item.action,
      affectedIdsJson: JSON.stringify(item.affectedIds),
      triggeredByJson: JSON.stringify(item.triggeredBy),
      agentId: item.agentId ?? null,
      createdAt,
    })
  }
  return {
    hypothesisCount: hypotheses.length,
    evidenceCount: evidence.length,
    correctionCount: corrections.length,
  }
}

export async function listScientificHypotheses(
  projectName: string,
  options?: { runId?: string; limit?: number },
): Promise<ScientificHypothesis[]> {
  const { db } = createProjectDb(projectName)
  let rows = db.select().from(scientificHypotheses).orderBy(desc(scientificHypotheses.round)).all()
  if (options?.runId) rows = rows.filter((row) => row.runId === options.runId)
  return rows.slice(0, options?.limit ?? 100).map((row) => ScientificHypothesisSchema.parse({
    id: row.id,
    statement: row.statement,
    mechanismComposition: JSON.parse(row.mechanismCompositionJson),
    predictions: JSON.parse(row.predictionsJson),
    falsificationConditions: JSON.parse(row.falsificationConditionsJson),
    sourceIds: JSON.parse(row.sourceIdsJson),
    scope: row.scope,
    confidence: row.confidence,
    parentId: row.parentId,
    round: row.round,
    status: row.status,
  }))
}

export async function listScientificEvidence(
  projectName: string,
  options?: { runId?: string; limit?: number },
): Promise<EvidenceRecord[]> {
  const { db } = createProjectDb(projectName)
  let rows = db.select().from(scientificEvidence).orderBy(desc(scientificEvidence.round)).all()
  if (options?.runId) rows = rows.filter((row) => row.runId === options.runId)
  return rows.slice(0, options?.limit ?? 200).map((row) => EvidenceRecordSchema.parse({
    evidenceId: row.id,
    ...(row.hypothesisId ? { hypothesisId: row.hypothesisId } : {}),
    ...(row.taskId ? { taskId: row.taskId } : {}),
    ...(row.agentId ? { agentId: row.agentId } : {}),
    status: row.status,
    claim: row.claim,
    observed: row.observed,
    method: row.method,
    sourceIds: JSON.parse(row.sourceIdsJson),
    sampleIds: JSON.parse(row.sampleIdsJson),
    ...(row.provenanceJson ? { provenance: JSON.parse(row.provenanceJson) } : {}),
    ...(row.metricsJson ? { metrics: JSON.parse(row.metricsJson) } : {}),
    ...(row.uncertainty ? { uncertainty: row.uncertainty } : {}),
    limitations: JSON.parse(row.limitationsJson),
    round: row.round,
  }))
}

export async function listScientificCorrections(
  projectName: string,
  options?: { runId?: string; limit?: number },
): Promise<ScientificCorrection[]> {
  const { db } = createProjectDb(projectName)
  let rows = db.select().from(scientificCorrections).orderBy(desc(scientificCorrections.round)).all()
  if (options?.runId) rows = rows.filter((row) => row.runId === options.runId)
  return rows.slice(0, options?.limit ?? 200).map((row) => ScientificCorrectionSchema.parse({
    correctionId: row.id,
    stage: row.stage,
    kind: row.kind,
    severity: row.severity,
    message: row.message,
    action: row.action,
    affectedIds: JSON.parse(row.affectedIdsJson),
    triggeredBy: JSON.parse(row.triggeredByJson),
    round: row.round,
    ...(row.agentId ? { agentId: row.agentId } : {}),
  }))
}
