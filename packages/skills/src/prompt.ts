import type { DiscoveredSkill } from './discover.ts'

export function buildSkillsPrompt(skills: DiscoveredSkill[]): string {
  if (skills.length === 0) return ''
  const list = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')
  return `\n\n## Available Skills\n\nThe following skills are available. Use the loadSkill tool to load the full instructions for a skill when needed:\n\n${list}\n`
}
