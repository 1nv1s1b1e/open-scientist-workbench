import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getBaseDir } from '@open-scientist/config'
import { ProjectNameSchema } from '@open-scientist/schema'
import { CreateProjectRequestSchema } from '@open-scientist/schema'
import {
  createProject,
  deleteProject,
  getLatestProjectPhenomenon,
  getProject,
  listProjects,
} from '@open-scientist/storage'
import { Hono } from 'hono'

export const projects = new Hono()

/** Validate project name from path param — throws ZodError (→ 400) on invalid input. */
function validateProjectName(raw: string): string {
  return ProjectNameSchema.parse(raw)
}

projects.get('/api/projects', async (c) => {
  const rows = await listProjects()
  const result = await Promise.all(
    rows.map(async (p) => {
      const phenomenon = await getLatestProjectPhenomenon(p.name)
      return {
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        summary: phenomenon?.title ?? null,
      }
    }),
  )
  return c.json(result)
})

projects.post('/api/projects', async (c) => {
  const body = await c.req.json()
  const req = CreateProjectRequestSchema.parse(body)
  const created = await createProject(req.name, req.config)
  return c.json(created, 201)
})

projects.get('/api/projects/:project', async (c) => {
  const name = validateProjectName(c.req.param('project'))
  const row = await getProject(name)
  if (!row) {
    return c.json({ error: 'not_found', message: `Project "${name}" not found` }, 404)
  }
  const config = row.configJson ? JSON.parse(row.configJson) : null
  return c.json({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    config,
  })
})

projects.delete('/api/projects/:project', async (c) => {
  const name = validateProjectName(c.req.param('project'))
  await deleteProject(name)
  const dir = join(getBaseDir(), 'projects', name)
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    // directory may not exist; ignore
  }
  return c.json({ ok: true })
})
