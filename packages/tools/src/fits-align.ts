import { createLogger } from '@open-scientist/logger'
import { EvidenceAlignmentSchema } from '@open-scientist/schema'
import { tool } from 'ai'
import { z } from 'zod'

const logger = createLogger('tools')

// Informativ stub: the Python scientific stack (astropy / sunpy / scipy / numpy)
// is not installed in this environment, so real FITS/video alignment cannot run.
// We throw a descriptive error so the agent learns the tool is unavailable and
// can either surface the install instructions to the user or fall back to other
// tools. The outputSchema is retained for when a real implementation lands.
export const fitsAlignTool = tool({
  description:
    'Align high-score candidate cases with raw FITS images and MP4 video clips by spatiotemporal index. Requires Python with astropy + sunpy installed.',
  inputSchema: z.object({
    hypoId: z.string(),
    activeRegion: z.string().describe('Active region ID, e.g. AR1140'),
    timestamp: z.string().describe('ISO 8601 timestamp'),
    wavelength: z.string().describe('SDO/AIA wavelength, e.g. 171Å, 304Å, 94Å'),
  }),
  outputSchema: EvidenceAlignmentSchema,
  execute: async (input) => {
    logger.info(
      {
        hypoId: input.hypoId,
        activeRegion: input.activeRegion,
        timestamp: input.timestamp,
        wavelength: input.wavelength,
      },
      'fitsAlignTool: execute start (will throw — Python stack not installed)',
    )
    throw new Error(
      `FITS alignment unavailable: Python scientific stack not installed. ` +
        `Install with: uv pip install astropy sunpy scipy numpy. ` +
        `Requested alignment: hypoId=${input.hypoId} AR=${input.activeRegion} ` +
        `t=${input.timestamp} λ=${input.wavelength}`,
    )
  },
})
