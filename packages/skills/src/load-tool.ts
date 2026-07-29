import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger } from '@open-scientist/logger'
import { type Tool, tool } from 'ai'
import { z } from 'zod'
import type { DiscoveredSkill } from './discover.ts'

const logger = createLogger('skills')

export function createLoadSkillTool(skills: DiscoveredSkill[]): Tool {
  const byName = new Map(skills.map((s) => [s.name, s]))
  logger.info(
    { availableCount: skills.length, names: skills.map((s) => s.name) },
    'createLoadSkillTool: tool created',
  )

  return tool({
    description: 'Load a skill SKILL.md by name to access specialized instructions',
    inputSchema: z.object({
      name: z.string().describe('Skill name from the available skills list'),
    }),
    outputSchema: z.object({
      skillDirectory: z.string(),
      content: z.string(),
    }),
    execute: async ({ name }) => {
      logger.info({ name }, 'loadSkillTool: execute start')
      const skill = byName.get(name)
      if (!skill) {
        logger.error({ name, available: [...byName.keys()] }, 'loadSkillTool: skill not found')
        throw new Error(`Skill not found: ${name}`)
      }
      const content = await readFile(join(skill.directory, 'SKILL.md'), 'utf-8')
      const withoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
      logger.info(
        { name, contentLen: withoutFrontmatter.length, directory: skill.directory },
        'loadSkillTool: execute done',
      )
      return { skillDirectory: skill.directory, content: withoutFrontmatter }
    },
  })
}
