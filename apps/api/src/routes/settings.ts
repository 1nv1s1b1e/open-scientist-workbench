import {
  getGlobalSettings,
  getProjectSettings,
  type ProjectSettings,
  setGlobalSettings,
  setProjectSettings,
} from '@open-scientist/config'
import {
  type GlobalSettings,
  GlobalSettingsSchema,
  type ModelConfig,
  ModelConfigSchema,
} from '@open-scientist/schema'
import { Hono } from 'hono'
import { deepMerge } from '../lib/deep-merge.js'

export const settings = new Hono()

settings.get('/api/settings', async (c) => {
  const s = await getGlobalSettings()
  return c.json(s)
})

settings.put('/api/settings', async (c) => {
  const body = await c.req.json()
  const parsed = GlobalSettingsSchema.parse(body)
  await setGlobalSettings(parsed)
  const next = await getGlobalSettings()
  return c.json(next)
})

settings.patch('/api/settings', async (c) => {
  const body = await c.req.json()
  const current = await getGlobalSettings()
  const merged = deepMerge(current, body as Partial<GlobalSettings>)
  const parsed = GlobalSettingsSchema.parse(merged)
  await setGlobalSettings(parsed)
  const next = await getGlobalSettings()
  return c.json(next)
})

settings.get('/api/settings/models/:role', async (c) => {
  const role = c.req.param('role')
  const s = await getGlobalSettings()
  const cfg = s.models[role]
  if (!cfg) {
    return c.json({ error: 'not_found', message: `No model config for role "${role}"` }, 404)
  }
  return c.json(cfg)
})

settings.put('/api/settings/models/:role', async (c) => {
  const role = c.req.param('role')
  const body = await c.req.json()
  const cfg = ModelConfigSchema.parse(body) as ModelConfig
  const current = await getGlobalSettings()
  const models = { ...current.models, [role]: cfg }
  await setGlobalSettings({ ...current, models })
  return c.json(cfg)
})

settings.delete('/api/settings/models/:role', async (c) => {
  const role = c.req.param('role')
  const current = await getGlobalSettings()
  const models = { ...current.models }
  delete models[role]
  await setGlobalSettings({ ...current, models })
  return c.json({ ok: true })
})

settings.get('/api/projects/:project/settings', async (c) => {
  const project = c.req.param('project')
  const s = await getProjectSettings(project)
  return c.json(s)
})

settings.patch('/api/projects/:project/settings', async (c) => {
  const project = c.req.param('project')
  const body = await c.req.json()
  const current = await getProjectSettings(project)
  const merged = deepMerge(current, body as Partial<ProjectSettings>)
  await setProjectSettings(project, merged)
  const next = await getProjectSettings(project)
  return c.json(next)
})
