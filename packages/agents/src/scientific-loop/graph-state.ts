import { StateSchema } from '@langchain/langgraph'
import {
  AgentExecutionSchema,
  EvidenceRecordSchema,
  HypothesisCoverageAuditSchema,
  HypothesisVerificationReportSchema,
  PhenomenonInputSchema,
  ScientificCorrectionSchema,
  ScientificHypothesisSchema,
  ValidationTaskSchema,
} from '@open-scientist/schema'
import { z } from 'zod'

export const ScientificGraphStateSchema = new StateSchema({
  projectId: z.string().min(1),
  runId: z.string().min(1),
  phenomenon: PhenomenonInputSchema,
  round: z.number().int().min(1),
  maxRounds: z.number().int().min(1),
  hypotheses: z.array(ScientificHypothesisSchema).default([]),
  hypothesisCoverage: HypothesisCoverageAuditSchema.default({
    mode: 'open_world',
    exhaustiveClaim: false,
    fixedMechanismCount: false,
    candidateCount: 0,
    retrievalSourceCount: 0,
    retrievedMechanismFamilies: [],
    representedMechanismFamilies: [],
    unrepresentedMechanismFamilies: [],
    residualAlternativeAllowed: true,
    limitations: ['尚未完成 A 阶段假设覆盖审计。'],
  }),
  evidence: z.array(EvidenceRecordSchema).default([]),
  verificationReports: z.array(HypothesisVerificationReportSchema).default([]),
  validationTasks: z.array(ValidationTaskSchema).default([]),
  corrections: z.array(ScientificCorrectionSchema).default([]),
  agentExecutions: z.array(AgentExecutionSchema).default([]),
  limitations: z.array(z.string().min(1)).default([]),
  conclusion: z.string().default(''),
  newEvidenceCount: z.number().int().min(0).default(0),
  newTaskCount: z.number().int().min(0).default(0),
  roundTaskIds: z.array(z.string().min(1)).default([]),
  completedRounds: z.number().int().min(0).default(0),
  nextRoute: z.enum(['A', 'B', 'END']).default('B'),
  terminationReason: z
    .enum([
      'max_rounds_reached',
      'no_new_evidence_or_tasks',
      'new_evidence',
      'new_task',
      'no_executable_validation_task',
      'no_valid_hypotheses',
      'human_halted_at_plan_review',
    ])
    .nullable()
    .default(null),
})

export type ScientificGraphState = typeof ScientificGraphStateSchema.State
export type ScientificGraphUpdate = typeof ScientificGraphStateSchema.Update
