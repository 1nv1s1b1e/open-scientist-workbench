import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { DiscoveredSkill } from '../src/discover.ts'
import { createLoadSkillTool } from '../src/load-tool.ts'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'os-load-tool-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

interface ExecutableTool {
  execute: (args: { name: string }) => Promise<{ skillDirectory: string; content: string }>
}

async function writeSkill(
  name: string,
  frontmatter: Record<string, string>,
  body: string,
): Promise<DiscoveredSkill> {
  const skillDir = join(tmp, name)
  await mkdir(skillDir, { recursive: true })
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  await writeFile(join(skillDir, 'SKILL.md'), `---\n${fm}\n---\n${body}`, 'utf-8')
  return { name, description: frontmatter.description ?? '', directory: skillDir }
}

describe('createLoadSkillTool', () => {
  it('loads a skill by name and returns content with frontmatter stripped', async () => {
    const skill = await writeSkill(
      'solar-physics-rag',
      { name: 'solar-physics-rag', description: 'RAG for solar physics' },
      '# Solar Physics RAG\n\nRetrieve literature about coronal heating.\n',
    )
    const tool = createLoadSkillTool([skill]) as unknown as ExecutableTool

    const result = await tool.execute({ name: 'solar-physics-rag' })

    expect(result.skillDirectory).toBe(skill.directory)
    // Frontmatter (--- ... ---) must be stripped from the returned content.
    expect(result.content).not.toContain('---')
    expect(result.content).not.toContain('name: solar-physics-rag')
    expect(result.content).toContain('# Solar Physics RAG')
    expect(result.content).toContain('coronal heating')
  })

  it('returns the exact body when there is no frontmatter', async () => {
    const skillDir = join(tmp, 'bare-skill')
    await mkdir(skillDir, { recursive: true })
    const body = 'Just plain instructions.\nNo frontmatter here.\n'
    await writeFile(join(skillDir, 'SKILL.md'), body, 'utf-8')
    const skill: DiscoveredSkill = {
      name: 'bare-skill',
      description: '',
      directory: skillDir,
    }
    const tool = createLoadSkillTool([skill]) as unknown as ExecutableTool

    const result = await tool.execute({ name: 'bare-skill' })

    expect(result.content).toBe(body)
    expect(result.skillDirectory).toBe(skillDir)
  })

  it('throws when the skill name is unknown', async () => {
    const tool = createLoadSkillTool([]) as unknown as ExecutableTool
    await expect(tool.execute({ name: 'does-not-exist' })).rejects.toThrow(
      'Skill not found: does-not-exist',
    )
  })

  it('reads the actual SKILL.md from disk (round-trip with writeFile)', async () => {
    const skill = await writeSkill(
      'critique-protocol',
      { name: 'critique-protocol', description: 'Oracle critique rubric' },
      '## 5-Dimension Scoring\n\n1. physical plausibility\n2. observational consistency\n',
    )
    const tool = createLoadSkillTool([skill]) as unknown as ExecutableTool

    const result = await tool.execute({ name: 'critique-protocol' })
    const original = await readFile(join(skill.directory, 'SKILL.md'), 'utf-8')
    // Returned content is the original file minus the leading frontmatter block.
    expect(original.endsWith(result.content)).toBe(true)
    expect(result.content).toContain('5-Dimension Scoring')
    expect(result.content).toContain('observational consistency')
  })
})
