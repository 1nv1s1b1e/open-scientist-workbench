import { describe, expect, it } from 'vite-plus/test'
import type { DiscoveredSkill } from '../src/index.ts'
import { buildSkillsPrompt } from '../src/index.ts'

describe('skills', () => {
  it('builds prompt from discovered skills', () => {
    const skills: DiscoveredSkill[] = [
      {
        name: 'solar-physics-rag',
        description: 'RAG for solar physics literature',
        directory: '/skills/rag',
      },
      {
        name: 'critique-protocol',
        description: 'Critique protocol for Oracle',
        directory: '/skills/critique',
      },
    ]
    const prompt = buildSkillsPrompt(skills)
    expect(prompt).toContain('solar-physics-rag')
    expect(prompt).toContain('critique-protocol')
    expect(prompt).toContain('loadSkill')
  })

  it('returns empty string for no skills', () => {
    expect(buildSkillsPrompt([])).toBe('')
  })
})
