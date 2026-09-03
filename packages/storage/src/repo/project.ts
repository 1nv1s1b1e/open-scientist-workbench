import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getBaseDir, getProjectDbPath } from '@open-scientist/config'
import { PhenomenonInputSchema, type PhenomenonInput } from '@open-scientist/schema'
import { desc, eq } from 'drizzle-orm'
import { createProjectDb } from '../db.ts'
import { projects, runChunks, runs } from '../schema/project.ts'

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

function phenomenonFromChunk(chunkJson: string): PhenomenonInput | null {
  try {
    const chunk = JSON.parse(chunkJson) as { kind?: unknown; phenomenon?: unknown }
    if (chunk.kind !== 'scientific.phenomenon') return null
    const parsed = PhenomenonInputSchema.safeParse(chunk.phenomenon)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Read the latest persisted scientific input for a project, if one exists. */
export async function getLatestProjectPhenomenon(name: string): Promise<PhenomenonInput | null> {
  if (!existsSync(getProjectDbPath(name))) return null
  const { db } = createProjectDb(name)
  const projectRuns = db.select({ id: runs.id }).from(runs).orderBy(desc(runs.startedAt)).all()

  for (const run of projectRuns) {
    const chunks = db
      .select({ chunkJson: runChunks.chunkJson })
      .from(runChunks)
      .where(eq(runChunks.runId, run.id))
      .orderBy(desc(runChunks.seq))
      .all()
    for (const chunk of chunks) {
      const phenomenon = phenomenonFromChunk(chunk.chunkJson)
      if (phenomenon) return phenomenon
    }
  }
  return null
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
