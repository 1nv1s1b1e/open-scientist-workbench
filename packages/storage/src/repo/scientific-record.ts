import { and, desc, eq } from 'drizzle-orm'
import {
  EvidenceRecordSchema,
  ScientificCorrectionSchema,
  ScientificHypothesisSchema,
  ValidationTaskSchema,
  type EvidenceRecord,
  type ScientificCorrection,
  type ScientificHypothesis,
  type ValidationTask,
} from '@open-scientist/schema'
import { createProjectDb } from '../db.ts'
import {
  scientificCorrections,
  scientificEvidence,
  scientificHypotheses,
  validationTasks,
} from '../schema/project.ts'

export interface ScientificRecordBatch {
  projectId: string
  runId: string
  hypotheses: readonly ScientificHypothesis[]
  evidence: readonly EvidenceRecord[]
  corrections: readonly ScientificCorrection[]
  validationTasks?: readonly ValidationTask[]
}

export interface ScientificRecordPersistResult {
  hypothesisCount: number
  evidenceCount: number
  correctionCount: number
  validationTaskCount: number
}

function upsertHypothesis(
  db: ReturnType<typeof createProjectDb>['db'],
  row: typeof scientificHypotheses.$inferInsert,
): void {
  const existing = db
    .select()
    .from(scientificHypotheses)
    .where(eq(scientificHypotheses.id, row.id))
    .all()[0]
  if (existing) {
    if (existing.runId !== row.runId) {
      throw new Error(`Scientific hypothesis id collision across runs: ${row.id}`)
    }
    db.update(scientificHypotheses)
      .set({ ...row, createdAt: existing.createdAt })
      .where(eq(scientificHypotheses.id, row.id))
      .run()
  } else {
    db.insert(scientificHypotheses).values(row).run()
  }
}

function upsertEvidence(
  db: ReturnType<typeof createProjectDb>['db'],
  row: typeof scientificEvidence.$inferInsert,
): void {
  const existing = db
    .select()
    .from(scientificEvidence)
    .where(eq(scientificEvidence.id, row.id))
    .all()[0]
  if (existing) {
    if (existing.runId !== row.runId) {
      throw new Error(`Scientific evidence id collision across runs: ${row.id}`)
    }
    db.update(scientificEvidence)
      .set({ ...row, createdAt: existing.createdAt })
      .where(eq(scientificEvidence.id, row.id))
      .run()
  } else {
    db.insert(scientificEvidence).values(row).run()
  }
}

function upsertCorrection(
  db: ReturnType<typeof createProjectDb>['db'],
  row: typeof scientificCorrections.$inferInsert,
): void {
  const existing = db
    .select()
    .from(scientificCorrections)
    .where(eq(scientificCorrections.id, row.id))
    .all()[0]
  if (existing) {
    if (existing.runId !== row.runId) {
      throw new Error(`Scientific correction id collision across runs: ${row.id}`)
    }
    db.update(scientificCorrections)
      .set({ ...row, createdAt: existing.createdAt })
      .where(eq(scientificCorrections.id, row.id))
      .run()
  } else {
    db.insert(scientificCorrections).values(row).run()
  }
}

function upsertValidationTask(
  db: ReturnType<typeof createProjectDb>['db'],
  projectId: string,
  runId: string,
  item: ValidationTask,
  createdAt: string,
): void {
  const values = {
    executorId: item.executorId ?? null,
    route: item.route,
    type: item.type,
    objective: item.objective,
    hypothesisIdsJson: JSON.stringify(item.hypothesisIds),
    predictionIdsJson: JSON.stringify(item.predictionIds),
    falsificationConditionIdsJson: JSON.stringify(item.falsificationConditionIds),
    requiredSourceIdsJson: JSON.stringify(item.requiredSourceIds),
    requiredDataJson: JSON.stringify(item.requiredData ?? []),
    requiredFacilitiesJson: JSON.stringify(item.requiredFacilities ?? []),
    readiness: item.readiness ?? null,
    expectedDuration: item.expectedDuration ?? null,
    estimatedStorageBytes: item.estimatedStorageBytes ?? null,
    successCriteriaJson: JSON.stringify(item.successCriteria ?? []),
    failureCriteriaJson: JSON.stringify(item.failureCriteria ?? []),
    blockedReason: item.blockedReason ?? null,
    discriminatingOutcomesJson: JSON.stringify(item.discriminatingOutcomes),
    triggeredBy: item.triggeredBy,
    status: item.status,
    resultEvidenceIdsJson: JSON.stringify(item.resultEvidenceIds),
    round: item.round,
    fingerprint: item.fingerprint,
  }
  const duplicate = db
    .select()
    .from(validationTasks)
    .where(and(eq(validationTasks.runId, runId), eq(validationTasks.fingerprint, item.fingerprint)))
    .all()[0]
  if (duplicate) {
    db.update(validationTasks).set(values).where(eq(validationTasks.id, duplicate.id)).run()
    return
  }

  const idCollision = db
    .select()
    .from(validationTasks)
    .where(eq(validationTasks.id, item.taskId))
    .all()[0]
  if (idCollision) {
    throw new Error(`Validation task id collision: ${item.taskId}`)
  }
  db.insert(validationTasks)
    .values({
      id: item.taskId,
      projectId,
      runId,
      ...values,
      createdAt,
    })
    .run()
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
  const tasks = (batch.validationTasks ?? []).map((item) => ValidationTaskSchema.parse(item))
  const { db } = createProjectDb(projectName)
  const createdAt = new Date().toISOString()

  db.transaction((tx) => {
    const transactionDb = tx as unknown as typeof db
    for (const item of hypotheses) {
      upsertHypothesis(transactionDb, {
        id: item.id,
        projectId: batch.projectId,
        runId: batch.runId,
        round: item.round,
        statement: item.statement,
        mechanismCompositionJson: JSON.stringify(item.mechanismComposition),
        predictionsJson: JSON.stringify(item.predictions),
        falsificationConditionsJson: JSON.stringify(item.falsificationConditions),
        sourceIdsJson: JSON.stringify(item.sourceIds),
        priority: item.priority ?? null,
        priorityReason: item.priorityReason ?? null,
        confidenceBasisJson: JSON.stringify(item.confidenceBasis ?? []),
        scope: item.scope,
        // The column is retained for backward-compatible databases only. New
        // scientific runs use ordinal evidenceStrengthGrade and store 0 as an
        // internal null sentinel; it is not returned as a probability.
        confidence: item.confidence ?? 0,
        parentId: item.parentId,
        status: item.status,
        createdAt,
      })
    }
    for (const item of evidence) {
      upsertEvidence(transactionDb, {
        id: item.evidenceId,
        projectId: batch.projectId,
        runId: batch.runId,
        round: item.round,
        hypothesisId: item.hypothesisId ?? null,
        taskId: item.taskId ?? null,
        agentId: item.agentId ?? null,
        status: item.status,
        evidenceRole: item.evidenceRole,
        contradictionScope: item.contradictionScope,
        adjudicationJson: item.adjudication ? JSON.stringify(item.adjudication) : null,
        claim: item.claim,
        observed: item.observed,
        method: item.method,
        sourceIdsJson: JSON.stringify(item.sourceIds),
        sampleIdsJson: JSON.stringify(item.sampleIds),
        predictionIdsJson: JSON.stringify(item.predictionIds),
        falsificationConditionIdsJson: JSON.stringify(item.falsificationConditionIds),
        provenanceJson: item.provenance ? JSON.stringify(item.provenance) : null,
        lineageJson: item.lineage ? JSON.stringify(item.lineage) : null,
        metricsJson: item.metrics ? JSON.stringify(item.metrics) : null,
        quantitativeResultsJson: JSON.stringify(item.quantitativeResults),
        uncertainty: item.uncertainty ?? null,
        limitationsJson: JSON.stringify(item.limitations),
        createdAt,
      })
    }
    for (const item of corrections) {
      upsertCorrection(transactionDb, {
        id: item.correctionId,
        projectId: batch.projectId,
        runId: batch.runId,
        round: item.round,
        stage: item.stage,
        kind: item.kind,
        severity: item.severity,
        message: item.message,
        action: item.action,
        evidenceAction: item.evidenceAction,
        affectedIdsJson: JSON.stringify(item.affectedIds),
        triggeredByJson: JSON.stringify(item.triggeredBy),
        agentId: item.agentId ?? null,
        createdAt,
      })
    }
    for (const item of tasks) {
      upsertValidationTask(transactionDb, batch.projectId, batch.runId, item, createdAt)
    }
  })
  return {
    hypothesisCount: hypotheses.length,
    evidenceCount: evidence.length,
    correctionCount: corrections.length,
    validationTaskCount: tasks.length,
  }
}

export async function listScientificHypotheses(
  projectName: string,
  options?: { runId?: string; limit?: number },
): Promise<ScientificHypothesis[]> {
  const { db } = createProjectDb(projectName)
  let rows = db.select().from(scientificHypotheses).orderBy(desc(scientificHypotheses.round)).all()
  if (options?.runId) rows = rows.filter((row) => row.runId === options.runId)
  return rows.slice(0, options?.limit ?? 100).map((row) =>
    ScientificHypothesisSchema.parse({
      id: row.id,
      statement: row.statement,
      mechanismComposition: JSON.parse(row.mechanismCompositionJson),
      predictions: JSON.parse(row.predictionsJson),
      falsificationConditions: JSON.parse(row.falsificationConditionsJson),
      sourceIds: JSON.parse(row.sourceIdsJson),
      ...(row.priority ? { priority: row.priority } : {}),
      ...(row.priorityReason ? { priorityReason: row.priorityReason } : {}),
      confidenceBasis: JSON.parse(row.confidenceBasisJson),
      scope: row.scope,
      ...(row.confidence > 0 ? { confidence: row.confidence } : {}),
      evidenceStrengthGrade:
        row.status === 'supported'
          ? 'strong'
          : row.status === 'eliminated'
            ? 'conflicted'
            : 'not_assessed',
      parentId: row.parentId,
      round: row.round,
      status: row.status,
    }),
  )
}

export async function listScientificEvidence(
  projectName: string,
  options?: { runId?: string; limit?: number },
): Promise<EvidenceRecord[]> {
  const { db } = createProjectDb(projectName)
  let rows = db.select().from(scientificEvidence).orderBy(desc(scientificEvidence.round)).all()
  if (options?.runId) rows = rows.filter((row) => row.runId === options.runId)
  return rows.slice(0, options?.limit ?? 200).map((row) =>
    EvidenceRecordSchema.parse({
      evidenceId: row.id,
      ...(row.hypothesisId ? { hypothesisId: row.hypothesisId } : {}),
      ...(row.taskId ? { taskId: row.taskId } : {}),
      ...(row.agentId ? { agentId: row.agentId } : {}),
      status: row.status,
      evidenceRole: row.evidenceRole,
      contradictionScope: row.contradictionScope,
      ...(row.adjudicationJson ? { adjudication: JSON.parse(row.adjudicationJson) } : {}),
      claim: row.claim,
      observed: row.observed,
      method: row.method,
      sourceIds: JSON.parse(row.sourceIdsJson),
      sampleIds: JSON.parse(row.sampleIdsJson),
      predictionIds: JSON.parse(row.predictionIdsJson),
      falsificationConditionIds: JSON.parse(row.falsificationConditionIdsJson),
      ...(row.provenanceJson ? { provenance: JSON.parse(row.provenanceJson) } : {}),
      ...(row.lineageJson ? { lineage: JSON.parse(row.lineageJson) } : {}),
      ...(row.metricsJson ? { metrics: JSON.parse(row.metricsJson) } : {}),
      quantitativeResults: JSON.parse(row.quantitativeResultsJson),
      ...(row.uncertainty ? { uncertainty: row.uncertainty } : {}),
      limitations: JSON.parse(row.limitationsJson),
      round: row.round,
    }),
  )
}

export async function listScientificCorrections(
  projectName: string,
  options?: { runId?: string; limit?: number },
): Promise<ScientificCorrection[]> {
  const { db } = createProjectDb(projectName)
  let rows = db
    .select()
    .from(scientificCorrections)
    .orderBy(desc(scientificCorrections.round))
    .all()
  if (options?.runId) rows = rows.filter((row) => row.runId === options.runId)
  return rows.slice(0, options?.limit ?? 200).map((row) =>
    ScientificCorrectionSchema.parse({
      correctionId: row.id,
      stage: row.stage,
      kind: row.kind,
      severity: row.severity,
      message: row.message,
      action: row.action,
      evidenceAction: row.evidenceAction,
      affectedIds: JSON.parse(row.affectedIdsJson),
      triggeredBy: JSON.parse(row.triggeredByJson),
      round: row.round,
      ...(row.agentId ? { agentId: row.agentId } : {}),
    }),
  )
}
