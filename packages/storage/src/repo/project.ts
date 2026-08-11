import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getBaseDir, getProjectDbPath } from '@open-scientist/config'
import { eq } from 'drizzle-orm'
import { createProjectDb } from '../db.ts'
import { projects } from '../schema/project.ts'

export async function createProject(name: string, config?: Record<string, unknown>) {
  const { db } = createProjectDb(name)
  const id = randomUUID()
  const now = new Date().toISOString()
  db.insert(projects)
    .values({ id, name, createdAt: now, configJson: config ? JSON.stringify(config) : null })
    .run()
  return { id, name, createdAt: now, config: config ?? null }
}

export async function getProject(name: string) {
  if (!existsSync(getProjectDbPath(name))) return null
  const { db } = createProjectDb(name)
  const rows = db.select().from(projects).where(eq(projects.name, name)).all()
  return rows[0] ?? null
}

export async function deleteProject(name: string) {
  if (!existsSync(getProjectDbPath(name))) return
  const { db } = createProjectDb(name)
  db.delete(projects).where(eq(projects.name, name)).run()
}

export async function listProjects() {
  const projectsDir = join(getBaseDir(), 'projects')
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const result: { id: string; name: string; createdAt: string; configJson: string | null }[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const row = await getProject(entry.name)
    if (row) result.push(row)
  }
  return result
}
