import {
  getGlobalSettings,
  getProjectSettings,
  type ProjectSettings,
  setGlobalSettings,
  setProjectSettings,
} from '@open-scientist/config'
import { MCP_PRESETS } from '@open-scientist/mcp'
import {
  type AgentConfig,
  AgentConfigSchema,
  type GlobalSettings,
  GlobalSettingsSchema,
  type ModelAlias,
  ModelConfigSchema,
} from '@open-scientist/schema'
import { Hono } from 'hono'
import { deepMerge } from '../lib/deep-merge.js'

export const settings = new Hono()

async function updateGlobalSetting<T>(
  section: keyof GlobalSettings,
  key: string,
  value: T,
): Promise<void> {
  const current = await getGlobalSettings()
  const sectionObj = (current[section] as Record<string, T> | undefined) ?? {}
  await setGlobalSettings({ ...current, [section]: { ...sectionObj, [key]: value } })
}

async function deleteGlobalSettingKey(section: keyof GlobalSettings, key: string): Promise<void> {
  const current = await getGlobalSettings()
  const sectionObj = { ...(current[section] as Record<string, unknown> | undefined) }
  delete sectionObj[key]
  await setGlobalSettings({ ...current, [section]: sectionObj })
}

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
  await updateGlobalSetting('models', role, cfg)
  return c.json(cfg)
})

settings.delete('/api/settings/models/:role', async (c) => {
  const role = c.req.param('role')
  await deleteGlobalSettingKey('models', role)
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
  await updateGlobalSetting('modelAliases', alias, cfg)
  return c.json(cfg)
})

settings.delete('/api/settings/model-aliases/:alias', async (c) => {
  const alias = c.req.param('alias')
  await deleteGlobalSettingKey('modelAliases', alias)
  return c.json({ ok: true })
})

// ─── Per-agent config (non-model overrides) ─────────────────────────────────
//
// Each agent role (sisyphus/librarian/looker/explore/oracle/prometheus) can
// override three NON-model dimensions:
//   - instructions    system-prompt string (factory default when undefined)
//   - skillDirectories extra dirs to scan for skills (DEFAULT_SKILLS_DIR
//                     always included as a fallback)
//   - mcpServers      remote tool servers to mount (merged into the toolset)
//
// Model config stays keyed by role under `settings.models[role]` (use
// /api/settings/models/:role for that). `settings.agents[role]` holds only
// these three non-model fields, all optional — undefined fields fall back to
// the agent factory's hardcoded defaults.

settings.get('/api/settings/agents', async (c) => {
  const s = await getGlobalSettings()
  return c.json(s.agents ?? {})
})

settings.get('/api/settings/agents/:role', async (c) => {
  const role = c.req.param('role')
  const s = await getGlobalSettings()
  const cfg = s.agents?.[role]
  if (!cfg) {
    return c.json({ error: 'not_found', message: `No agent config for role "${role}"` }, 404)
  }
  return c.json(cfg)
})

settings.put('/api/settings/agents/:role', async (c) => {
  const role = c.req.param('role')
  const body = await c.req.json()
  const cfg = AgentConfigSchema.parse(body) as AgentConfig
  await updateGlobalSetting('agents', role, cfg)
  return c.json(cfg)
})

settings.delete('/api/settings/agents/:role', async (c) => {
  const role = c.req.param('role')
  await deleteGlobalSettingKey('agents', role)
  return c.json({ ok: true })
})

settings.get('/api/projects/:project/settings', async (c) => {
  const project = c.req.param('project')
  const s = await getProjectSettings(project)
  return c.json(s)
})

// ─── MCP presets ────────────────────────────────────────────────────────────
//
// 列出预配的第三方 MCP server 配置（paper-search-mcp / duckduckgo-mcp /
// arxiv-mcp）。前端可展示清单，用户选择后 PUT /api/settings/agents/:role
// 的 mcpServers 字段引用对应 preset。presets 是静态数据，不从文件读。

settings.get('/api/settings/mcp-presets', (c) => {
  return c.json(MCP_PRESETS)
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
