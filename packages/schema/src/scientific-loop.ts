import { z } from 'zod'
import { PhenomenonInputSchema } from './phenomenon.ts'

export const MechanismComponentSchema = z.object({
  mechanism: z.string().min(1),
  role: z.enum(['dominant', 'secondary', 'coupled', 'unknown']),
  contribution: z.number().min(0).max(1).optional(),
})
export type MechanismComponent = z.infer<typeof MechanismComponentSchema>

export const ScientificHypothesisSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  mechanismComposition: z.array(MechanismComponentSchema).min(1),
  predictions: z.array(z.string().min(1)).min(1),
  falsificationConditions: z.array(z.string().min(1)).min(1),
  sourceIds: z.array(z.string().min(1)).default([]),
  scope: z.string().min(1),
  confidence: z.number().min(0).max(1),
  parentId: z.string().min(1).nullable().default(null),
  round: z.number().int().min(0),
  status: z.enum(['candidate', 'supported', 'uncertain', 'revised', 'eliminated']),
})
export type ScientificHypothesis = z.infer<typeof ScientificHypothesisSchema>

export const EvidenceStatusSchema = z.enum(['support', 'contradict', 'unknown'])
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>

export const EvidenceProvenanceSchema = z.object({
  processingRunId: z.string().min(1),
  dataSnapshotIds: z.array(z.string().min(1)).min(1),
  artifactIds: z.array(z.string().min(1)).min(1),
  generatedBy: z.string().min(1),
  deterministic: z.literal(true),
})
export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>

export const EvidenceRecordSchema = z
  .object({
    evidenceId: z.string().min(1),
    hypothesisId: z.string().min(1).nullable().optional(),
    taskId: z.string().min(1).nullable().optional(),
    agentId: z.string().min(1).optional(),
    status: EvidenceStatusSchema,
    claim: z.string().min(1),
    observed: z.string().min(1),
    method: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).default([]),
    sampleIds: z.array(z.string().min(1)).default([]),
    provenance: EvidenceProvenanceSchema.optional(),
    metrics: z.record(z.string(), z.unknown()).optional(),
    uncertainty: z.string().min(1).optional(),
    limitations: z.array(z.string().min(1)).default([]),
    round: z.number().int().min(0),
  })
  .superRefine((evidence, context) => {
    if (evidence.status !== 'unknown' && !evidence.provenance) {
      context.addIssue({
        code: 'custom',
        path: ['provenance'],
        message: 'supporting or contradicting evidence requires deterministic processing provenance',
      })
    }
  })
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>

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
  requiredSourceIds: z.array(z.string().min(1)).default([]),
  discriminatingOutcomes: z.array(z.string().min(1)).min(1),
  triggeredBy: z.string().min(1),
  status: z.enum(['planned', 'running', 'completed', 'failed', 'rejected']),
  resultEvidenceIds: z.array(z.string().min(1)).default([]),
  round: z.number().int().min(0),
  fingerprint: z.string().min(1),
})
export type ValidationTask = z.infer<typeof ValidationTaskSchema>

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
  memoryIds: z.array(z.string().min(1)),
  conclusion: z.string().min(1).optional(),
  terminationReason: z.string().min(1).optional(),
  capturedAt: z.string().min(1),
})
export type ScientificRoundSnapshot = z.infer<typeof ScientificRoundSnapshotSchema>

export const ScientificLoopResultSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(['completed', 'stopped', 'blocked', 'failed']),
  totalRounds: z.number().int().min(0),
  hypotheses: z.array(ScientificHypothesisSchema),
  evidence: z.array(EvidenceRecordSchema),
  validationTasks: z.array(ValidationTaskSchema),
  conclusion: z.string().min(1),
  nextValidationPlan: z.array(ValidationTaskSchema),
  terminationReason: z.string().min(1),
})
export type ScientificLoopResult = z.infer<typeof ScientificLoopResultSchema>
