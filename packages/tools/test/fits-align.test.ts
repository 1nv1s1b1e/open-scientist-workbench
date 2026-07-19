import { describe, expect, it } from 'vitest'
import { fitsAlignTool } from '../src/fits-align.ts'

// Cast the AI SDK tool to a minimal shape so we can invoke `execute` directly.
interface ExecutableTool {
  execute: (input: Record<string, unknown>) => Promise<unknown>
}
const executable = fitsAlignTool as unknown as ExecutableTool

const VALID_INPUT = {
  hypoId: 'h1',
  activeRegion: 'AR13664',
  timestamp: '2024-05-14T00:00:00Z',
  wavelength: '171Å',
}

describe('fitsAlignTool execute (astropy stub)', () => {
  it('throws an informative error mentioning the uv pip install command + all input params', async () => {
    await expect(executable.execute(VALID_INPUT)).rejects.toThrow()
    try {
      await executable.execute(VALID_INPUT)
    } catch (err) {
      const msg = (err as Error).message
      // Install instructions are surfaced so the agent / user can act.
      expect(msg).toContain('uv pip install astropy sunpy scipy numpy')
      // All four input parameters are echoed back for traceability.
      expect(msg).toContain('hypoId=h1')
      expect(msg).toContain('AR=AR13664')
      expect(msg).toContain('t=2024-05-14T00:00:00Z')
      expect(msg).toContain('λ=171Å')
    }
  })

  it('echoes the specific input params for a different request', async () => {
    try {
      await executable.execute({
        hypoId: 'hypo-99',
        activeRegion: 'AR1140',
        timestamp: '2026-07-19T12:00:00Z',
        wavelength: '304Å',
      })
      throw new Error('should have thrown before this point')
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain('hypoId=hypo-99')
      expect(msg).toContain('AR=AR1140')
      expect(msg).toContain('t=2026-07-19T12:00:00Z')
      expect(msg).toContain('λ=304Å')
    }
  })
})
