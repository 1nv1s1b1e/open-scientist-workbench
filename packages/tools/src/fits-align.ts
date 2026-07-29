import { createLogger } from '@open-scientist/logger'
import { EvidenceAlignmentSchema } from '@open-scientist/schema'
import { tool } from 'ai'
import { z } from 'zod'

const logger = createLogger('tools')

// Informative stub: the Python scientific stack (astropy / sunpy / scipy / numpy)
// is not installed, so real FITS/video alignment cannot run. The tool throws a
// descriptive error so the agent learns it is unavailable and can fall back to
// other tools or surface install instructions to the user.
//
// NOTE: The MCP fits-server (`packages/mcp/src/servers/fits-server.ts`) exposes
// a parallel `align_fits` stub that returns a graceful `{ok:false, stub:true}`
// JSON payload (non-throwing) instead. The two stubs intentionally differ in
// error contract: the in-process tool throws (AI SDK idiom for unavailable
// tools), the MCP server returns a result (MCP idiom — no exceptions over
// stdio). When a real Python bridge lands, update both in tandem. The
// outputSchema is retained for when a real implementation replaces this stub.
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
