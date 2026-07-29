import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger } from '@open-scientist/logger'

const logger = createLogger('skills')

export interface DiscoveredSkill {
  name: string
  description: string
  directory: string
}

export async function discoverSkills(directories: string[]): Promise<DiscoveredSkill[]> {
  logger.info({ dirCount: directories.length, directories }, 'discoverSkills: start')
  const skills: DiscoveredSkill[] = []
  const seen = new Set<string>()

  for (const dir of directories) {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch (err) {
      logger.warn(
        { dir, error: (err as Error).message },
        'discoverSkills: readdir failed, skipping dir',
      )
      continue
    }

    logger.debug({ dir, entryCount: entries.length }, 'discoverSkills: scanning dir')
    for (const entry of entries) {
      const skillDir = join(dir, entry)
      const skillMdPath = join(skillDir, 'SKILL.md')
      try {
        const content = await readFile(skillMdPath, 'utf-8')
        const { name, description } = parseFrontmatter(content)
        if (name === 'unknown') {
          logger.warn(
            { dir: skillDir },
            'discoverSkills: SKILL.md has no valid name frontmatter, skipping',
          )
          continue
        }
        if (!seen.has(name)) {
          seen.add(name)
          skills.push({ name, description, directory: skillDir })
          logger.debug({ dir, name }, 'discoverSkills: skill discovered')
        }
      } catch (err) {
        logger.debug(
          { dir: skillDir, error: (err as Error).message },
          'discoverSkills: SKILL.md read failed, skipping (not a skill directory)',
        )
      }
    }
  }

  logger.info(
    { foundCount: skills.length, names: skills.map((s) => s.name) },
    'discoverSkills: done',
  )
  return skills
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/

function parseFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(FRONTMATTER_RE)
  if (!match?.[1]) return { name: 'unknown', description: '' }
  const frontmatter = match[1]
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m)
  return {
    name: nameMatch?.[1]?.trim() ?? 'unknown',
    description: descMatch?.[1]?.trim() ?? '',
  }
}
