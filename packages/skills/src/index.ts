import { fileURLToPath } from 'node:url'
import { type Tool } from 'ai'

import { type DiscoveredSkill, discoverSkills } from './discover.ts'
import { createLoadSkillTool } from './load-tool.ts'

export * from './discover.ts'
export * from './load-tool.ts'

export const DEFAULT_SKILLS_DIR = fileURLToPath(new URL('./defaults', import.meta.url))

export interface SkillToolkit {
  skills: DiscoveredSkill[]
  loadSkillTool: Tool
}

/**
 * Convenience wrapper: discover skills from `directories`, then build the
 * `loadSkill` tool from the result. Replaces the 2-call dance
 * (`discoverSkills` → `createLoadSkillTool`) in agent factories.
 *
 * `discoverSkills` and `createLoadSkillTool` remain exported for callers that
 * need them individually.
 */
export async function createSkillToolkit(directories: string[]): Promise<SkillToolkit> {
  const skills = await discoverSkills(directories)
  const loadSkillTool = createLoadSkillTool(skills)
  return { skills, loadSkillTool }
}
