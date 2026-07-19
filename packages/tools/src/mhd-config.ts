import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getMhdDir } from '@open-scientist/config'
import { MhdConfigSchema } from '@open-scientist/schema'
import { tool } from 'ai'
import { z } from 'zod'

export const mhdConfigTool = tool({
  description:
    'Generate MHD simulation configuration file (.cfg) and satellite observation proposal',
  inputSchema: z.object({
    runId: z.string(),
    winningHypoId: z.string(),
    hypothesisStatement: z.string(),
    physicalParams: z.record(z.string(), z.number()),
  }),
  outputSchema: MhdConfigSchema,
  execute: async ({ runId, winningHypoId, hypothesisStatement, physicalParams }) => {
    const dir = getMhdDir(runId)
    await mkdir(dir, { recursive: true })
    const cfgPath = resolve(dir, `${runId}.cfg`)
    const cfgContent = `# MHD Simulation Config\n# Run: ${runId}\n# Hypothesis: ${winningHypoId}\n# ${hypothesisStatement}\n\n[params]\n${Object.entries(
      physicalParams,
    )
      .map(([k, v]) => `${k} = ${v}`)
      .join('\n')}\n`
    await writeFile(cfgPath, cfgContent, 'utf-8')
    return {
      runId,
      cfgPath,
      observationProposal: `Observation proposal for hypothesis ${winningHypoId}`,
      summary: `MHD config generated for: ${hypothesisStatement}`,
    }
  },
})
