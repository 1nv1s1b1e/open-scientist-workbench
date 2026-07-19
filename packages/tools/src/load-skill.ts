import { tool } from 'ai'
import { z } from 'zod'

export function createLoadSkillTool(skillsDirectories: string[]) {
  return tool({
    description: 'Load a skill SKILL.md by name. Use this to access specialized instructions.',
    inputSchema: z.object({
      name: z.string().describe('Skill name from the available skills list'),
    }),
    outputSchema: z.object({
      skillDirectory: z.string(),
      content: z.string(),
    }),
    execute: async ({ name }) => {
      // 实际实现扫 skillsDirectories 找到 <name>/SKILL.md，去 frontmatter 返回
      throw new Error(`loadSkill not implemented: ${name} in ${skillsDirectories.join(', ')}`)
    },
  })
}
