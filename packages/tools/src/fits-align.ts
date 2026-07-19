import { EvidenceAlignmentSchema } from '@open-scientist/schema'
import { tool } from 'ai'
import { z } from 'zod'

export const fitsAlignTool = tool({
  description:
    'Align high-score candidate cases with raw FITS images and MP4 video clips by spatiotemporal index',
  inputSchema: z.object({
    hypoId: z.string(),
    activeRegion: z.string().describe('Active region ID, e.g. AR1140'),
    timestamp: z.string().describe('ISO 8601 timestamp'),
    wavelength: z.string().describe('SDO/AIA wavelength, e.g. 171Å, 304Å, 94Å'),
  }),
  outputSchema: EvidenceAlignmentSchema,
  execute: async (input) => {
    // 实际实现调 astropy/sunpy 查询本地 FITS 库或远程 SDO 数据中心
    throw new Error(`fitsAlignTool.execute not implemented: ${JSON.stringify(input)}`)
  },
})
