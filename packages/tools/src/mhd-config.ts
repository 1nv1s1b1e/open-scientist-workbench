import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getMhdDir } from '@open-scientist/config'
import { createLogger } from '@open-scientist/logger'
import { MhdConfigSchema } from '@open-scientist/schema'
import { tool } from 'ai'
import { z } from 'zod'

const logger = createLogger('tools')

export function createMhdConfigTool(boundProjectId?: string) {
  return tool({
    description:
      'Generate MHD simulation configuration file (.cfg) and satellite observation proposal. Writes the proposal to a markdown file and returns file paths — the agent does NOT need to embed the proposal in submit_result.',
    inputSchema: z.object({
      project: z.string().optional(),
      runId: z.string(),
      winningHypoId: z.string(),
      hypothesisStatement: z.string(),
      physicalParams: z.record(z.string(), z.number()),
      observationProposal: z.string(),
    }),
    outputSchema: MhdConfigSchema,
    execute: async ({
      project,
      runId,
      winningHypoId,
      hypothesisStatement,
      physicalParams,
      observationProposal,
    }) => {
      const targetProject = project ?? boundProjectId ?? 'default'
      logger.info(
        {
          project: targetProject,
          runId,
          winningHypoId,
          paramCount: Object.keys(physicalParams).length,
          statementLen: hypothesisStatement.length,
          proposalLen: observationProposal.length,
        },
        'mhdConfigTool: execute start',
      )
      const dir = getMhdDir(targetProject)
      await mkdir(dir, { recursive: true })
      const cfgPath = resolve(dir, `${runId}.cfg`)
      const proposalPath = resolve(dir, `${runId}_proposal.md`)
      const cfgContent = `# MHD Simulation Config\n# Run: ${runId}\n# Hypothesis: ${winningHypoId}\n# ${hypothesisStatement}\n\n[params]\n${Object.entries(
        physicalParams,
      )
        .map(([k, v]) => `${k} = ${v}`)
        .join('\n')}\n`
      await writeFile(cfgPath, cfgContent, 'utf-8')
      await writeFile(proposalPath, observationProposal, 'utf-8')
      logger.info({ runId, cfgPath, proposalPath }, 'mhdConfigTool: execute done')
      return {
        runId,
        cfgPath,
        proposalPath,
        summary: `MHD config generated for: ${hypothesisStatement}`,
      }
    },
  })
}

export const mhdConfigTool = createMhdConfigTool()
