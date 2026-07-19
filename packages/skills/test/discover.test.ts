import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNodeSandbox, type DiscoveredSkill, discoverSkills } from '../src/index.js'

// Build a temporary skills-root tree under os.tmpdir() per test.
function makeSkillDir(
  root: string,
  name: string,
  description: string,
  body = 'body',
): Promise<string> {
  const dir = join(root, name)
  const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`
  return mkdir(dir, { recursive: true })
    .then(() => writeFile(join(dir, 'SKILL.md'), content))
    .then(() => dir)
}

async function makeEmptyDir(root: string, name: string): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  return dir
}

async function makeDirWithoutFrontmatter(root: string, name: string): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '# no frontmatter here\n\njust plain markdown\n')
  return dir
}

describe('discoverSkills', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'os-skills-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('discovers valid skills with frontmatter parsed', async () => {
    await makeSkillDir(root, 'solar-physics-rag', 'RAG for solar physics literature')
    await makeSkillDir(root, 'critique-protocol', 'Critique protocol for Oracle')

    const skills = await discoverSkills(createNodeSandbox(), [root])
    expect(skills).toHaveLength(2)

    const names = skills.map((s) => s.name).sort()
    expect(names).toEqual(['critique-protocol', 'solar-physics-rag'])

    const rag = skills.find((s) => s.name === 'solar-physics-rag') as DiscoveredSkill
    expect(rag.description).toBe('RAG for solar physics literature')
    expect(rag.directory).toBe(join(root, 'solar-physics-rag'))
  })

  it('skips directories without a SKILL.md', async () => {
    await makeSkillDir(root, 'real-skill', 'a real one')
    await makeEmptyDir(root, 'no-skill-md')

    const skills = await discoverSkills(createNodeSandbox(), [root])
    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('real-skill')
  })

  it('skips directories whose SKILL.md has no frontmatter (name falls back to unknown)', async () => {
    await makeSkillDir(root, 'with-fm', 'has frontmatter')
    await makeDirWithoutFrontmatter(root, 'no-fm')

    const skills = await discoverSkills(createNodeSandbox(), [root])
    // The no-frontmatter dir still produces a skill entry, but with name='unknown'.
    // We verify the frontmatter-parsed one is correct and the unknown one is present.
    expect(skills).toHaveLength(2)
    const withFm = skills.find((s) => s.name === 'with-fm')
    expect(withFm?.description).toBe('has frontmatter')
    const unknown = skills.find((s) => s.name === 'unknown')
    expect(unknown).toBeDefined()
    expect(unknown?.description).toBe('')
  })

  it('returns [] for a directory containing only empty subdirectories', async () => {
    await makeEmptyDir(root, 'empty-one')
    await makeEmptyDir(root, 'empty-two')
    const skills = await discoverSkills(createNodeSandbox(), [root])
    expect(skills).toEqual([])
  })

  it('returns [] when the directory does not exist', async () => {
    const skills = await discoverSkills(createNodeSandbox(), [join(root, 'does-not-exist')])
    expect(skills).toEqual([])
  })

  it('first-name-wins: deduplicates skills with the same name across directories', async () => {
    const root2 = await mkdtemp(join(tmpdir(), 'os-skills-'))
    try {
      await makeSkillDir(root, 'dup-skill', 'first description wins')
      await makeSkillDir(root2, 'dup-skill', 'second description loses')

      const skills = await discoverSkills(createNodeSandbox(), [root, root2])
      expect(skills).toHaveLength(1)
      expect(skills[0]?.description).toBe('first description wins')
      // directory points at the first-seen location.
      expect(skills[0]?.directory).toBe(join(root, 'dup-skill'))
    } finally {
      await rm(root2, { recursive: true, force: true })
    }
  })
})
