import { StateSchema } from '@langchain/langgraph'
import {
  AgentExecutionSchema,
  EvidenceRecordSchema,
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
  evidence: z.array(EvidenceRecordSchema).default([]),
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
    ])
    .nullable()
    .default(null),
})

export type ScientificGraphState = typeof ScientificGraphStateSchema.State
export type ScientificGraphUpdate = typeof ScientificGraphStateSchema.Update
