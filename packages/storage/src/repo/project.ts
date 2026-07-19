import { randomUUID } from 'node:crypto'
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
  const { db } = createProjectDb(name)
  const rows = db.select().from(projects).where(eq(projects.name, name)).all()
  return rows[0] ?? null
}

export async function deleteProject(name: string) {
  const { db } = createProjectDb(name)
  db.delete(projects).where(eq(projects.name, name)).run()
}
