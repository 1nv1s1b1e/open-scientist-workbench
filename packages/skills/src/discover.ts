import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sandbox } from './sandbox.js'

export interface DiscoveredSkill {
  name: string
  description: string
  directory: string
}

export async function discoverSkills(
  _sandbox: Sandbox,
  directories: string[],
): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = []
  const seen = new Set<string>()

  for (const dir of directories) {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }

    for (const entry of entries) {
      const skillDir = join(dir, entry)
      const skillMdPath = join(skillDir, 'SKILL.md')
      try {
        const content = await readFile(skillMdPath, 'utf-8')
        const { name, description } = parseFrontmatter(content)
        if (!seen.has(name)) {
          seen.add(name)
          skills.push({ name, description, directory: skillDir })
        }
      } catch {
        // not a skill directory
      }
    }
  }

  return skills
}

function parseFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match?.[1]) return { name: 'unknown', description: '' }
  const frontmatter = match[1]
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m)
  return {
    name: nameMatch?.[1]?.trim() ?? 'unknown',
    description: descMatch?.[1]?.trim() ?? '',
  }
}
