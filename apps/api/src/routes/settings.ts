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
  type ModelAlias,
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
  const cfg = ModelConfigSchema.parse(body) as ModelAlias
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

// ─── Model aliases ──────────────────────────────────────────────────────────
//
// 前端可定义 alias→{model,thinkingLevel,credentialId} 映射，创建 run 时
// 传 modelAlias 字段引用。provider/baseURL/apiKey 全部由 credentialId 引用
// 的 Credential 条目决定（「同 provider 不同 url+key」= 不同 credential）。

settings.get('/api/settings/model-aliases', async (c) => {
  const s = await getGlobalSettings()
  return c.json(s.modelAliases ?? {})
})

settings.put('/api/settings/model-aliases/:alias', async (c) => {
  const alias = c.req.param('alias')
  const body = await c.req.json()
  const cfg = ModelConfigSchema.parse(body) as ModelAlias
  const current = await getGlobalSettings()
  const modelAliases = { ...(current.modelAliases ?? {}), [alias]: cfg }
  await setGlobalSettings({ ...current, modelAliases })
  return c.json(cfg)
})

settings.delete('/api/settings/model-aliases/:alias', async (c) => {
  const alias = c.req.param('alias')
  const current = await getGlobalSettings()
  const modelAliases = { ...(current.modelAliases ?? {}) }
  delete modelAliases[alias]
  await setGlobalSettings({ ...current, modelAliases })
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
