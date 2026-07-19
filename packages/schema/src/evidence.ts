import { z } from 'zod'

export const EvidenceAlignmentSchema = z.object({
  hypoId: z.string(),
  fitsPaths: z.array(z.string()),
  videoClipPath: z.string().nullable(),
  metadata: z.object({
    activeRegion: z.string(),
    timestamp: z.string(),
    wavelength: z.string(),
    spatialIndex: z.string(),
  }),
})
export type EvidenceAlignment = z.infer<typeof EvidenceAlignmentSchema>
