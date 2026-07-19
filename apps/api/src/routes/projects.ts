import type { Dirent } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getBaseDir } from '@open-scientist/config'
import { CreateProjectRequestSchema } from '@open-scientist/schema'
import { createProject, deleteProject, getProject } from '@open-scientist/storage'
import { Hono } from 'hono'

export const projects = new Hono()

projects.get('/api/projects', async (c) => {
  const projectsDir = join(getBaseDir(), 'projects')
  let entries: Dirent[] = []
  try {
    entries = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    return c.json([])
  }
  const result = entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, createdAt: null as string | null }))
  return c.json(result)
})

projects.post('/api/projects', async (c) => {
  const body = await c.req.json()
  const req = CreateProjectRequestSchema.parse(body)
  const created = await createProject(req.name, req.config)
  return c.json(created, 201)
})

projects.get('/api/projects/:project', async (c) => {
  const name = c.req.param('project')
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
  const name = c.req.param('project')
  await deleteProject(name)
  const dir = join(getBaseDir(), 'projects', name)
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    // directory may not exist; ignore
  }
  return c.json({ ok: true })
})
