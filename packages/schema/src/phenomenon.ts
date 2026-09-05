import { z } from 'zod'

export const ObservationKindSchema = z.enum([
  'image',
  'timeseries',
  'spectrum',
  'catalog',
  'simulation',
  'derived',
])
export type ObservationKind = z.infer<typeof ObservationKindSchema>

/** A source reference is an assertion boundary, not a fabricated measurement. */
export const ObservationRefSchema = z.object({
  sourceId: z.string().min(1),
  kind: ObservationKindSchema,
  label: z.string().min(1),
  uri: z.string().min(1),
  instrument: z.string().min(1).optional(),
  wavelengthOrBand: z.string().min(1).optional(),
  observedAt: z.string().min(1).optional(),
  activeRegion: z.string().min(1).optional(),
  checksum: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type ObservationRef = z.infer<typeof ObservationRefSchema>

export const PhenomenonInputSchema = z.object({
  phenomenonId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  activeRegion: z.string().min(1).optional(),
  /** Optional at intake; Explorer 观测质控/物理诊断 agents may discover and attach sources later. */
  observations: z.array(ObservationRefSchema).default([]),
  requestedQuestion: z.string().min(1).optional(),
  constraints: z.array(z.string().min(1)).default([]),
  inputDigest: z.string().min(1).optional(),
})
export type PhenomenonInput = z.infer<typeof PhenomenonInputSchema>
