import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Tool, tool } from 'ai'
import { z } from 'zod'
import type { DiscoveredSkill } from './discover.js'

export function createLoadSkillTool(skills: DiscoveredSkill[]): Tool {
  const byName = new Map(skills.map((s) => [s.name, s]))

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
      const skill = byName.get(name)
      if (!skill) throw new Error(`Skill not found: ${name}`)
      const content = await readFile(join(skill.directory, 'SKILL.md'), 'utf-8')
      const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
      return { skillDirectory: skill.directory, content: withoutFrontmatter }
    },
  })
}
