import { z } from 'zod'

export const DataSnapshotRefSchema = z.object({
  snapshotId: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).min(1),
  manifestPath: z.string().min(1),
  checksums: z
    .record(z.string().min(1), z.string().min(1))
    .refine((value) => Object.keys(value).length > 0, {
      message: 'at least one source checksum is required',
    }),
  selection: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().min(1),
})
export type DataSnapshotRef = z.infer<typeof DataSnapshotRefSchema>

export const ArtifactKindSchema = z.enum([
  'data-snapshot',
  'processed-data',
  'metrics',
  'figure',
  'log',
  'model',
  'simulation',
  'other',
])
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>

export const ArtifactRefSchema = z.object({
  artifactId: z.string().min(1),
  kind: ArtifactKindSchema,
  path: z.string().min(1),
  checksum: z.string().min(1),
  mediaType: z.string().min(1).optional(),
  generatedBy: z.string().min(1),
  processingRunId: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).default([]),
  createdAt: z.string().min(1),
})
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>

export const ProcessingStepSchema = z.object({
  stepId: z.string().min(1),
  name: z.string().min(1),
  tool: z.string().min(1),
  toolVersion: z.string().min(1),
  codeVersion: z.string().min(1).optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
  inputArtifactIds: z.array(z.string().min(1)).default([]),
  outputArtifactIds: z.array(z.string().min(1)).default([]),
  deterministic: z.boolean(),
})
export type ProcessingStep = z.infer<typeof ProcessingStepSchema>

export const ProcessingRunSchema = z
  .object({
    processingRunId: z.string().min(1),
    projectId: z.string().min(1),
    runId: z.string().min(1),
    round: z.number().int().min(0),
    agentId: z.string().min(1),
    taskId: z.string().min(1).optional(),
    triggeredBy: z.string().min(1),
    snapshotIds: z.array(z.string().min(1)).min(1),
    steps: z.array(ProcessingStepSchema).min(1),
    deterministic: z.boolean(),
    status: z.enum(['planned', 'running', 'completed', 'failed', 'rejected']),
    outputArtifactIds: z.array(z.string().min(1)).default([]),
    metricsArtifactId: z.string().min(1).optional(),
    limitations: z.array(z.string().min(1)).default([]),
    fingerprint: z.string().min(1),
    startedAt: z.string().min(1),
    completedAt: z.string().min(1).optional(),
  })
  .superRefine((run, context) => {
    if (run.deterministic && run.steps.some((step) => !step.deterministic)) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'a deterministic run cannot contain a non-deterministic step',
      })
    }
    if (run.status === 'completed' && run.outputArtifactIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['outputArtifactIds'],
        message: 'a completed processing run must bind at least one artifact',
      })
    }
  })
export type ProcessingRun = z.infer<typeof ProcessingRunSchema>
