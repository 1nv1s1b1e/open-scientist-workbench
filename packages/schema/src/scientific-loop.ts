import { z } from 'zod'
import { PhenomenonInputSchema } from './phenomenon.ts'

export const MechanismComponentSchema = z.object({
  mechanism: z.string().min(1),
  role: z.enum(['dominant', 'secondary', 'coupled', 'unknown']),
  contribution: z.number().min(0).max(1).optional(),
})
export type MechanismComponent = z.infer<typeof MechanismComponentSchema>

export const HypothesisPrioritySchema = z.enum(['high', 'medium', 'low'])
export type HypothesisPriority = z.infer<typeof HypothesisPrioritySchema>

/**
 * Ordinal evidence assessment for a hypothesis. These labels are deliberately
 * not mapped to probabilities: without adjudicated labels and an external
 * calibration set, a decimal would be pseudo-precision.
 */
export const EvidenceStrengthGradeSchema = z.enum([
  'not_assessed',
  'insufficient',
  'limited',
  'moderate',
  'strong',
  'conflicted',
])
export type EvidenceStrengthGrade = z.infer<typeof EvidenceStrengthGradeSchema>

/**
 * Why a confidence value changed. Until independently adjudicated mechanism
 * labels exist, `confidence` is an uncalibrated evidence-ranking rubric, not a
 * posterior probability. Model output alone is never treated as empirical support.
 */
export const HypothesisConfidenceBasisSchema = z.object({
  basisId: z.string().min(1),
  kind: z.enum(['model', 'literature', 'statistical', 'holdout', 'expert', 'other']),
  sourceIds: z.array(z.string().min(1)).default([]),
  evidenceIds: z.array(z.string().min(1)).default([]),
  explanation: z.string().min(1),
})
export type HypothesisConfidenceBasis = z.infer<typeof HypothesisConfidenceBasisSchema>

export const ScientificHypothesisSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  mechanismComposition: z.array(MechanismComponentSchema).min(1),
  predictions: z.array(z.string().min(1)).min(1),
  falsificationConditions: z.array(z.string().min(1)).min(1),
  sourceIds: z.array(z.string().min(1)).default([]),
  scope: z.string().min(1),
  /** @deprecated Legacy ranking value; never interpret as a probability or support gate. */
  confidence: z.number().min(0).max(1).optional(),
  evidenceStrengthGrade: EvidenceStrengthGradeSchema.default('not_assessed'),
  priority: HypothesisPrioritySchema.optional(),
  priorityReason: z.string().min(1).optional(),
  confidenceBasis: z.array(HypothesisConfidenceBasisSchema).optional(),
  parentId: z.string().min(1).nullable().default(null),
  round: z.number().int().min(0),
  status: z.enum([
    'candidate',
    'supported',
    'provisionally_supported',
    'contradicted',
    'deferred_requires_data',
    'uncertain',
    'revised',
    'eliminated',
  ]),
})
export type ScientificHypothesis = z.infer<typeof ScientificHypothesisSchema>

/** Stable references let evidence and validation tasks target a concrete prediction. */
export function scientificPredictionId(hypothesisId: string, index: number): string {
  return `${hypothesisId}:prediction:${index + 1}`
}

export function scientificFalsificationConditionId(hypothesisId: string, index: number): string {
  return `${hypothesisId}:falsification:${index + 1}`
}

export const EvidenceStatusSchema = z.enum(['support', 'contradict', 'unknown'])
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>

/**
 * `prediction_consistent` means an observable is compatible with a prediction,
 * but is not specific to the proposed mechanism. Only
 * `mechanism_discriminating` evidence may pass the strong support gate.
 */
export const EvidenceRoleSchema = z.enum([
  'mechanism_discriminating',
  'prediction_consistent',
  'diagnostic_boundary',
])
export type EvidenceRole = z.infer<typeof EvidenceRoleSchema>

/** A contradiction can challenge a mechanism or merely expose a weak diagnostic. */
export const EvidenceContradictionScopeSchema = z.enum([
  'mechanism',
  'critical_prediction',
  'diagnostic_specificity',
  'data_quality',
])
export type EvidenceContradictionScope = z.infer<typeof EvidenceContradictionScopeSchema>

export const EvidenceAdjudicationSchema = z.object({
  status: z.enum(['accepted', 'downgraded', 'revoked']),
  correctionIds: z.array(z.string().min(1)).default([]),
  reason: z.string().min(1),
})
export type EvidenceAdjudication = z.infer<typeof EvidenceAdjudicationSchema>

export const EvidenceProvenanceSchema = z.object({
  processingRunId: z.string().min(1),
  dataSnapshotIds: z.array(z.string().min(1)).min(1),
  artifactIds: z.array(z.string().min(1)).min(1),
  generatedBy: z.string().min(1),
  deterministic: z.literal(true),
})
export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>

export const EvidenceObservableFamilySchema = z.enum([
  'wave_timing',
  'thermal_variability',
  'magnetic_evolution',
  'spectroscopy',
  'background_control',
  'simulation',
  'other',
])
export type EvidenceObservableFamily = z.infer<typeof EvidenceObservableFamilySchema>

export const EvidenceAnalysisSplitSchema = z.enum(['discovery', 'validation', 'holdout'])
export type EvidenceAnalysisSplit = z.infer<typeof EvidenceAnalysisSplitSchema>

/**
 * Scientific independence is attached to the raw event and observable, not
 * inferred from a new processing id or a different agent name.
 */
export const EvidenceLineageSchema = z.object({
  eventGroupId: z.string().min(1),
  relatedEventGroupIds: z.array(z.string().min(1)).default([]),
  rawDataFingerprint: z.string().min(1),
  observableFamily: EvidenceObservableFamilySchema,
  methodFamily: z.string().min(1),
  analysisSplit: EvidenceAnalysisSplitSchema,
})
export type EvidenceLineage = z.infer<typeof EvidenceLineageSchema>

export const QuantitativeResultSchema = z
  .object({
    metric: z.string().min(1),
    estimate: z.number().finite(),
    lowerBound: z.number().finite(),
    upperBound: z.number().finite(),
    confidenceLevel: z.number().gt(0).lte(1).default(0.95),
    unit: z.string().min(1).optional(),
  })
  .superRefine((result, context) => {
    if (result.lowerBound > result.estimate || result.estimate > result.upperBound) {
      context.addIssue({
        code: 'custom',
        path: ['estimate'],
        message: 'estimate must fall inside [lowerBound, upperBound]',
      })
    }
  })
export type QuantitativeResult = z.infer<typeof QuantitativeResultSchema>

export const EvidenceRecordSchema = z
  .object({
    evidenceId: z.string().min(1),
    hypothesisId: z.string().min(1).nullable().optional(),
    taskId: z.string().min(1).nullable().optional(),
    agentId: z.string().min(1).optional(),
    status: EvidenceStatusSchema,
    evidenceRole: EvidenceRoleSchema.default('prediction_consistent'),
    contradictionScope: EvidenceContradictionScopeSchema.default('mechanism'),
    adjudication: EvidenceAdjudicationSchema.optional(),
    claim: z.string().min(1),
    observed: z.string().min(1),
    method: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).default([]),
    sampleIds: z.array(z.string().min(1)).default([]),
    predictionIds: z.array(z.string().min(1)).default([]),
    falsificationConditionIds: z.array(z.string().min(1)).default([]),
    provenance: EvidenceProvenanceSchema.optional(),
    lineage: EvidenceLineageSchema.optional(),
    metrics: z.record(z.string(), z.unknown()).optional(),
    quantitativeResults: z.array(QuantitativeResultSchema).default([]),
    uncertainty: z.string().min(1).optional(),
    limitations: z.array(z.string().min(1)).default([]),
    round: z.number().int().min(0),
  })
  .superRefine((evidence, context) => {
    if (evidence.status !== 'unknown' && !evidence.provenance) {
      context.addIssue({
        code: 'custom',
        path: ['provenance'],
        message:
          'supporting or contradicting evidence requires deterministic processing provenance',
      })
    }
  })
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>

/** Machine-readable audit of why one hypothesis did or did not pass the support gate. */
export const HypothesisVerificationReportSchema = z.object({
  hypothesisId: z.string().min(1),
  round: z.number().int().min(0),
  decision: z.enum([
    'candidate',
    'supported',
    'provisionally_supported',
    'contradicted',
    'deferred_requires_data',
    'uncertain',
    'revised',
    'eliminated',
  ]),
  /** @deprecated Accepted only when reading historical run artifacts. */
  confidence: z.number().min(0).max(1).optional(),
  confidenceSemantics: z.literal('uncalibrated_evidence_rubric_not_probability').optional(),
  evidenceStrengthGrade: EvidenceStrengthGradeSchema.default('not_assessed'),
  evidenceStrengthSemantics: z
    .literal('ordinal_evidence_grade_not_probability')
    .default('ordinal_evidence_grade_not_probability'),
  supportTier: z
    .enum(['not_supported', 'bounded_process_support', 'specific_mechanism_support', 'conflicted'])
    .default('not_supported'),
  supportEvidenceIds: z.array(z.string().min(1)).default([]),
  validSupportEvidenceIds: z.array(z.string().min(1)).default([]),
  contradictionEvidenceIds: z.array(z.string().min(1)).default([]),
  eventGroupIds: z.array(z.string().min(1)).default([]),
  rawDataFingerprints: z.array(z.string().min(1)).default([]),
  observableFamilies: z.array(z.string().min(1)).default([]),
  methodFamilies: z.array(z.string().min(1)).default([]),
  analysisSplits: z.array(EvidenceAnalysisSplitSchema).default([]),
  attemptedAnalysisSplits: z.array(EvidenceAnalysisSplitSchema).default([]),
  coveredPredictionIds: z.array(z.string().min(1)).default([]),
  uncoveredPredictionIds: z.array(z.string().min(1)).default([]),
  /** Predictions exercised by completed tasks this run, regardless of evidence role. */
  testedPredictionIds: z.array(z.string().min(1)).default([]),
  /** Registered predictions never exercised by any completed task this run. */
  untestedPredictionIds: z.array(z.string().min(1)).default([]),
  hasHoldoutEvidence: z.boolean(),
  holdoutAttempted: z.boolean(),
  hasQuantitativeEvidence: z.boolean(),
  meetsEvidenceCriteria: z.boolean(),
  /** @deprecated Historical field; the support decision is evidence-gated only. */
  meetsConfidenceCriteria: z.boolean().optional(),
  supportGatePassed: z.boolean(),
  eliminationGatePassed: z.boolean().default(false),
  eliminationEvidenceIds: z.array(z.string().min(1)).default([]),
  coveredFalsificationConditionIds: z.array(z.string().min(1)).default([]),
  decisiveFalsificationConditionIds: z.array(z.string().min(1)).default([]),
  uncoveredFalsificationConditionIds: z.array(z.string().min(1)).default([]),
  eliminationTaskIds: z.array(z.string().min(1)).default([]),
  eliminationReasons: z.array(z.string().min(1)).default([]),
  reasons: z.array(z.string().min(1)).default([]),
  nextActions: z.array(z.string().min(1)).default([]),
})
export type HypothesisVerificationReport = z.infer<typeof HypothesisVerificationReportSchema>

/**
 * A negative counterexample search is meaningful only when its sensitivity was
 * registered and achieved. This record prevents "not found" from being treated
 * as "does not exist" when the sample, cadence, or measurement precision is weak.
 */
export const ValidationDetectabilitySchema = z
  .object({
    effectMetric: z.string().min(1),
    unit: z.string().min(1).optional(),
    alpha: z.number().gt(0).lt(1).default(0.05),
    targetPower: z.number().gt(0).lte(1).default(0.8),
    achievedPower: z.number().gt(0).lte(1).optional(),
    minimumMeaningfulEffect: z.number().positive(),
    minimumDetectableEffect: z.number().positive().optional(),
    independentEventCount: z.number().int().nonnegative(),
    minimumIndependentEventCount: z.number().int().positive(),
    adequate: z.boolean(),
    assumptions: z.array(z.string().min(1)).default([]),
  })
  .superRefine((assessment, context) => {
    if (!assessment.adequate) return
    if (assessment.achievedPower === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['achievedPower'],
        message: 'an adequate search must report achievedPower',
      })
    } else if (assessment.achievedPower < assessment.targetPower) {
      context.addIssue({
        code: 'custom',
        path: ['achievedPower'],
        message: 'achievedPower must meet targetPower when adequate is true',
      })
    }
    if (assessment.minimumDetectableEffect === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['minimumDetectableEffect'],
        message: 'an adequate search must report minimumDetectableEffect',
      })
    } else if (assessment.minimumDetectableEffect > assessment.minimumMeaningfulEffect) {
      context.addIssue({
        code: 'custom',
        path: ['minimumDetectableEffect'],
        message: 'minimumDetectableEffect must not exceed minimumMeaningfulEffect',
      })
    }
    if (assessment.independentEventCount < assessment.minimumIndependentEventCount) {
      context.addIssue({
        code: 'custom',
        path: ['independentEventCount'],
        message: 'independentEventCount must meet the registered minimum',
      })
    }
  })
export type ValidationDetectability = z.infer<typeof ValidationDetectabilitySchema>

export const ValidationTaskSchema = z.object({
  taskId: z.string().min(1),
  /** Explicit runtime binding. `external` means planned but not executable here. */
  executorId: z.string().min(1).optional(),
  route: z.enum(['A', 'B']),
  type: z.enum([
    'observation',
    'analysis',
    'history-search',
    'simulation',
    'model-update',
    'human-review',
  ]),
  objective: z.string().min(1),
  hypothesisIds: z.array(z.string().min(1)).default([]),
  predictionIds: z.array(z.string().min(1)).default([]),
  falsificationConditionIds: z.array(z.string().min(1)).default([]),
  requiredSourceIds: z.array(z.string().min(1)).default([]),
  /** Human-readable P5.4 fields, kept separate from machine source ids. */
  requiredData: z.array(z.string().min(1)).optional(),
  requiredFacilities: z.array(z.string().min(1)).optional(),
  readiness: z
    .enum(['executable_now', 'requires_data', 'external', 'human_review', 'unassessed'])
    .optional(),
  expectedDuration: z.string().min(1).optional(),
  estimatedStorageBytes: z.number().int().nonnegative().optional(),
  successCriteria: z.array(z.string().min(1)).optional(),
  failureCriteria: z.array(z.string().min(1)).optional(),
  blockedReason: z.string().min(1).optional(),
  /** Pre-registered sensitivity/power audit for a negative or null result. */
  detectability: ValidationDetectabilitySchema.optional(),
  discriminatingOutcomes: z.array(z.string().min(1)).min(1),
  triggeredBy: z.string().min(1),
  status: z.enum(['planned', 'running', 'completed', 'failed', 'rejected']),
  resultEvidenceIds: z.array(z.string().min(1)).default([]),
  round: z.number().int().min(0),
  fingerprint: z.string().min(1),
})
export type ValidationTask = z.infer<typeof ValidationTaskSchema>

export const CounterexampleSearchStatusSchema = z.enum([
  'not_executed',
  'underpowered',
  'adequately_tested_not_detected',
  'counterexample_detected',
])
export type CounterexampleSearchStatus = z.infer<typeof CounterexampleSearchStatusSchema>

export const CounterexampleSearchAssessmentSchema = z.object({
  falsificationConditionId: z.string().min(1),
  status: CounterexampleSearchStatusSchema,
  evidenceIds: z.array(z.string().min(1)).default([]),
  taskIds: z.array(z.string().min(1)).default([]),
  reasons: z.array(z.string().min(1)).default([]),
})
export type CounterexampleSearchAssessment = z.infer<typeof CounterexampleSearchAssessmentSchema>

/**
 * Terminal disposition for one hypothesis in the current run. This is an
 * operationally complete decision, not a claim that every scientific question
 * has been resolved by the available observations.
 */
export const HypothesisRunDispositionSchema = z.enum([
  'accepted_bounded_process',
  'accepted_specific_mechanism',
  'rejected_falsified',
  'disfavored_not_falsified',
  'deferred_requires_data',
  'deferred_external_validation',
  'deferred_underpowered',
  'incomplete_executable_work',
  'unresolved_no_executable_path',
  'superseded_by_revision',
])
export type HypothesisRunDisposition = z.infer<typeof HypothesisRunDispositionSchema>

export const HypothesisClosureReportSchema = z.object({
  hypothesisId: z.string().min(1),
  status: z.enum(['complete', 'partial', 'blocked']),
  runDisposition: HypothesisRunDispositionSchema,
  dispositionReason: z.string().min(1),
  localDataSufficient: z.boolean(),
  blockingTaskIds: z.array(z.string().min(1)).default([]),
  hasTestablePredictions: z.boolean(),
  evidenceSearchAttempted: z.boolean(),
  counterexampleSearchAttempted: z.boolean(),
  counterexampleSearchAdequate: z.boolean(),
  counterexampleAssessments: z.array(CounterexampleSearchAssessmentSchema).default([]),
  hasVerificationDecision: z.boolean(),
  hasNextValidationPlan: z.boolean(),
  coveredPredictionIds: z.array(z.string().min(1)).default([]),
  plannedPredictionIds: z.array(z.string().min(1)).default([]),
  missingPredictionIds: z.array(z.string().min(1)).default([]),
  coveredFalsificationConditionIds: z.array(z.string().min(1)).default([]),
  plannedFalsificationConditionIds: z.array(z.string().min(1)).default([]),
  missingFalsificationConditionIds: z.array(z.string().min(1)).default([]),
  relatedEvidenceIds: z.array(z.string().min(1)).default([]),
  relatedTaskIds: z.array(z.string().min(1)).default([]),
  reasons: z.array(z.string().min(1)).default([]),
})
export type HypothesisClosureReport = z.infer<typeof HypothesisClosureReportSchema>

export const WorkflowClosureSummarySchema = z.object({
  status: z.enum(['complete', 'incomplete']),
  allHypothesesDisposed: z.boolean(),
  noExecutableTasksRemaining: z.boolean(),
  noUnassessedTasksRemaining: z.boolean(),
  terminalHypothesisCount: z.number().int().nonnegative(),
  totalHypothesisCount: z.number().int().nonnegative(),
  dispositionCounts: z.record(HypothesisRunDispositionSchema, z.number().int().nonnegative()),
  reasons: z.array(z.string().min(1)).default([]),
})
export type WorkflowClosureSummary = z.infer<typeof WorkflowClosureSummarySchema>

/** Operational health of the run: did every executor/agent/data input succeed? */
export const OperationalClosureSummarySchema = z.object({
  status: z.enum(['complete', 'degraded']),
  agentFailures: z
    .array(
      z.object({
        agentId: z.string().min(1),
        status: z.string().min(1),
      }),
    )
    .default([]),
  failedTaskIds: z.array(z.string().min(1)).default([]),
  unresolvedErrorCorrectionCount: z.number().int().nonnegative().default(0),
  dataIntegrityErrors: z.array(z.string().min(1)).default([]),
  reasons: z.array(z.string().min(1)).default([]),
})
export type OperationalClosureSummary = z.infer<typeof OperationalClosureSummarySchema>

/** P1-8: honest self-correction accounting (duplicates separated from real fixes). */
export const CorrectionsSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  uniqueProblemCount: z.number().int().nonnegative(),
  duplicateCorrectionCount: z.number().int().nonnegative(),
  uniqueAffectedEvidenceCount: z.number().int().nonnegative(),
  realDowngradeCount: z.number().int().nonnegative(),
  realRevocationCount: z.number().int().nonnegative(),
})

/** P1-9: per-hypothesis primary status + machine-readable reason status. */
export const HypothesisDispositionRowSchema = z.object({
  hypothesisId: z.string().min(1),
  statement: z.string().min(1),
  primaryStatus: z.string().min(1),
  reasonStatus: z.string().min(1),
  reasonLabel: z.string().min(1),
  evidenceStrengthGrade: z.string().min(1).nullable().optional(),
})
export type HypothesisDispositionRow = z.infer<typeof HypothesisDispositionRowSchema>

/**
 * Open-world audit of A-stage hypothesis coverage. `exhaustiveClaim=false` is
 * deliberate: no finite retrieval can prove that every physically possible
 * explanation has been enumerated. The audit instead exposes what the
 * retrieved corpus suggested, what became a testable candidate, and what was
 * left unrepresented for follow-up.
 */
export const HypothesisCoverageAuditSchema = z.object({
  mode: z.literal('open_world').default('open_world'),
  exhaustiveClaim: z.literal(false).default(false),
  fixedMechanismCount: z.literal(false).default(false),
  candidateCount: z.number().int().nonnegative(),
  retrievalSourceCount: z.number().int().nonnegative(),
  retrievedMechanismFamilies: z.array(z.string().min(1)).default([]),
  representedMechanismFamilies: z.array(z.string().min(1)).default([]),
  unrepresentedMechanismFamilies: z.array(z.string().min(1)).default([]),
  residualAlternativeAllowed: z.literal(true).default(true),
  limitations: z.array(z.string().min(1)).default([]),
})
export type HypothesisCoverageAudit = z.infer<typeof HypothesisCoverageAuditSchema>

export const ScientificOutcomeProfileSchema = z.object({
  total: z.number().int().nonnegative(),
  candidate: z.number().int().nonnegative(),
  uncertain: z.number().int().nonnegative(),
  supported: z.number().int().nonnegative(),
  provisionallySupported: z.number().int().nonnegative().default(0),
  contradicted: z.number().int().nonnegative().default(0),
  deferredRequiresData: z.number().int().nonnegative().default(0),
  eliminated: z.number().int().nonnegative(),
  revised: z.number().int().nonnegative(),
})
export type ScientificOutcomeProfile = z.infer<typeof ScientificOutcomeProfileSchema>

export const DataReadinessSummarySchema = z.object({
  executableNowTaskIds: z.array(z.string().min(1)).default([]),
  requiresDataTaskIds: z.array(z.string().min(1)).default([]),
  externalTaskIds: z.array(z.string().min(1)).default([]),
  humanReviewTaskIds: z.array(z.string().min(1)).default([]),
  unassessedTaskIds: z.array(z.string().min(1)).default([]),
  requiresNewData: z.boolean(),
})
export type DataReadinessSummary = z.infer<typeof DataReadinessSummarySchema>

export const MemoryLayerSchema = z.enum(['working', 'episodic', 'semantic', 'procedural-data'])
export type MemoryLayer = z.infer<typeof MemoryLayerSchema>

export const MemoryKindSchema = z.enum([
  'phenomenon',
  'hypothesis',
  'evidence',
  'counterexample',
  'revision',
  'validation-task',
  'decision',
  'failure',
  'lesson',
  'data-snapshot',
  'processing-run',
  'artifact',
])
export type MemoryKind = z.infer<typeof MemoryKindSchema>

export const MemoryEntrySchema = z.object({
  memoryId: z.string().min(1),
  layer: MemoryLayerSchema.default('episodic'),
  kind: MemoryKindSchema,
  summary: z.string().min(1),
  content: z.string().min(1).optional(),
  namespace: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
  sourceIds: z.array(z.string().min(1)).default([]),
  hypothesisIds: z.array(z.string().min(1)).default([]),
  evidenceIds: z.array(z.string().min(1)).default([]),
  taskIds: z.array(z.string().min(1)).default([]),
  artifactIds: z.array(z.string().min(1)).default([]),
  processingRunIds: z.array(z.string().min(1)).default([]),
  triggeredBy: z.array(z.string().min(1)).default([]),
  verificationStatus: z.enum(['unverified', 'verified', 'rejected']).default('unverified'),
  agentId: z.string().min(1).optional(),
  phenomenonId: z.string().min(1).optional(),
  projectId: z.string().min(1),
  runId: z.string().min(1),
  round: z.number().int().min(0),
  fingerprint: z.string().min(1),
  utility: z.number().min(0).max(1).default(0.5),
  createdAt: z.string().min(1),
})
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>

export const ScientificCorrectionSchema = z.object({
  correctionId: z.string().min(1),
  stage: z.enum(['A', 'B', 'C', 'D', 'memory', 'data-processing']),
  kind: z.enum(['schema', 'provenance', 'factual', 'execution', 'memory-policy']),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().min(1),
  action: z.string().min(1),
  evidenceAction: z.enum(['none', 'downgrade_to_unknown', 'revoke']).default('none'),
  affectedIds: z.array(z.string().min(1)).default([]),
  triggeredBy: z.array(z.string().min(1)).min(1),
  round: z.number().int().min(0),
  agentId: z.string().min(1).optional(),
})
export type ScientificCorrection = z.infer<typeof ScientificCorrectionSchema>

export const AgentExecutionSchema = z.object({
  agentId: z.string().min(1),
  label: z.string().min(1),
  stage: z.enum(['A', 'B', 'C', 'D']),
  status: z.enum(['queued', 'running', 'completed', 'skipped', 'failed']),
  capabilities: z.array(z.string().min(1)).default([]),
  round: z.number().int().min(0),
  error: z.string().min(1).optional(),
  outputEvidenceIds: z.array(z.string().min(1)).default([]),
  outputTaskIds: z.array(z.string().min(1)).default([]),
})
export type AgentExecution = z.infer<typeof AgentExecutionSchema>

export const ScientificRoundSnapshotSchema = z.object({
  projectId: z.string().min(1),
  runId: z.string().min(1),
  round: z.number().int().min(0),
  phenomenon: PhenomenonInputSchema,
  hypotheses: z.array(ScientificHypothesisSchema),
  evidence: z.array(EvidenceRecordSchema),
  validationTasks: z.array(ValidationTaskSchema),
  verificationReports: z.array(HypothesisVerificationReportSchema).default([]),
  memoryIds: z.array(z.string().min(1)),
  conclusion: z.string().min(1).optional(),
  terminationReason: z.string().min(1).optional(),
  capturedAt: z.string().min(1),
})
export type ScientificRoundSnapshot = z.infer<typeof ScientificRoundSnapshotSchema>

/**
 * A human steering/follow-up message that was queued through the run control
 * API and injected into an A-stage generation context. Steering is advisory:
 * it can bias candidate generation and planning emphasis, but it can never
 * alter gate verdicts, evidence records, or their quantitative content.
 */
export const ScientificSteeringRecordSchema = z.object({
  messageId: z.string().min(1),
  mode: z.enum(['steering', 'follow-up']),
  content: z.string().min(1),
  /** The round whose A-stage consumed this message. */
  round: z.number().int().min(1),
  injectedAt: z.string().min(1),
})
export type ScientificSteeringRecord = z.infer<typeof ScientificSteeringRecordSchema>

/**
 * An audit record for an optional human approval gate (e.g. plan review
 * before continuing to the next round). Gates only decide whether the loop
 * continues; they never overwrite a gate verdict or evidence status.
 */
export const ScientificHumanGateRecordSchema = z.object({
  gateId: z.string().min(1),
  kind: z.enum(['plan_review']),
  round: z.number().int().min(1),
  summary: z.string().min(1),
  approved: z.boolean(),
  /** Who decided: a human via POST /approve, or an automatic fail-open path. */
  source: z.enum(['human', 'auto_timeout', 'auto_aborted']),
  reason: z.string().optional(),
  decidedAt: z.string().min(1),
})
export type ScientificHumanGateRecord = z.infer<typeof ScientificHumanGateRecordSchema>

export const ScientificLoopResultSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(['completed', 'stopped', 'blocked', 'failed']),
  totalRounds: z.number().int().min(0),
  hypotheses: z.array(ScientificHypothesisSchema),
  evidence: z.array(EvidenceRecordSchema),
  validationTasks: z.array(ValidationTaskSchema),
  verificationReports: z.array(HypothesisVerificationReportSchema).default([]),
  closureReports: z.array(HypothesisClosureReportSchema).optional(),
  /** Advisory steering messages actually injected (present only when used). */
  humanSteering: z.array(ScientificSteeringRecordSchema).optional(),
  /** Approval-gate decisions (present only when a gate is armed and fires). */
  humanGates: z.array(ScientificHumanGateRecordSchema).optional(),
  closureStatus: z.enum(['complete', 'partial', 'blocked']).optional(),
  workflowClosure: WorkflowClosureSummarySchema.optional(),
  operationalClosure: OperationalClosureSummarySchema.optional(),
  correctionsSummary: CorrectionsSummarySchema.optional(),
  hypothesisDispositions: z.array(HypothesisDispositionRowSchema).optional(),
  hypothesisCoverage: HypothesisCoverageAuditSchema.optional(),
  outcomeProfile: ScientificOutcomeProfileSchema.optional(),
  dataReadiness: DataReadinessSummarySchema.optional(),
  conclusion: z.string().min(1),
  nextValidationPlan: z.array(ValidationTaskSchema),
  terminationReason: z.string().min(1),
  scientificStatus: z
    .enum([
      'supported',
      'inconclusive',
      'needs_data',
      'needs_external_validation',
      'falsified',
      'mixed',
      'blocked',
    ])
    .optional(),
})
export type ScientificLoopResult = z.infer<typeof ScientificLoopResultSchema>
