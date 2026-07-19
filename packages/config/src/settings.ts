import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  ConcurrencySettingsSchema,
  type GlobalSettings,
  GlobalSettingsSchema,
  type ModelConfig,
  ModelConfigSchema,
  SteeringSettingsSchema,
  TournamentSettingsSchema,
} from '@open-scientist/schema'
import { z } from 'zod'
import { getBaseDir, getProjectDir } from './paths.ts'

// 模型配置 + 凭证 schema 单一来源是 @open-scientist/schema。config 包仅
// re-export 给路由层使用，避免两处定义漂移。
export {
  ConcurrencySettingsSchema,
  type GlobalSettings,
  GlobalSettingsSchema,
  type ModelConfig,
  ModelConfigSchema,
  SteeringSettingsSchema,
  TournamentSettingsSchema,
}

// Per-project settings 是 GlobalSettings 的 partial overlay（deep merge in
// getSettings），加上若干 project-only 字段（mcp/skills/prompts）。这里只
// 做结构校验，不复用 schema 包的 GlobalSettingsSchema（否则会强制要求
// tournament/concurrency/steering 等必填字段）。
const ProjectSettingsSchema = GlobalSettingsSchema.partial().extend({
  mcp: z.object({ servers: z.array(z.unknown()) }).optional(),
  skills: z.object({ directories: z.array(z.string()) }).optional(),
  prompts: z.object({ dir: z.string() }).optional(),
})
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>

// 默认配置不含任何模型名/credentialId，必须通过 REST API 设置。
const DEFAULT_GLOBAL: GlobalSettings = {
  models: {},
  tournament: {
    maxRounds: 10,
    targetF1: 0.9,
    convergenceWindow: 3,
    convergenceThreshold: 0.005,
  },
  concurrency: { maxConcurrentRuns: 4 },
  steering: { mode: 'one-at-a-time' },
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}

export async function getGlobalSettings(): Promise<GlobalSettings> {
  const raw = await readJsonFile(`${getBaseDir()}/settings.json`, DEFAULT_GLOBAL)
  return GlobalSettingsSchema.parse({ ...DEFAULT_GLOBAL, ...raw })
}

export async function setGlobalSettings(partial: Partial<GlobalSettings>): Promise<void> {
  const current = await getGlobalSettings()
  const next = { ...current, ...partial }
  await writeJsonFile(`${getBaseDir()}/settings.json`, next)
}

export async function getProjectSettings(projectName: string): Promise<ProjectSettings> {
  const raw = await readJsonFile(`${getProjectDir(projectName)}/settings.json`, {})
  return ProjectSettingsSchema.parse(raw) as ProjectSettings
}

export async function setProjectSettings(
  projectName: string,
  partial: ProjectSettings,
): Promise<void> {
  const current = await getProjectSettings(projectName)
  const next = { ...current, ...partial }
  await writeJsonFile(`${getProjectDir(projectName)}/settings.json`, next)
}

export async function getSettings(projectName?: string): Promise<GlobalSettings & ProjectSettings> {
  const global = await getGlobalSettings()
  if (!projectName) return global
  const project = await getProjectSettings(projectName)
  return {
    ...global,
    ...project,
    models: { ...global.models, ...project.models },
    modelAliases: { ...(global.modelAliases ?? {}), ...(project.modelAliases ?? {}) },
    tournament: { ...global.tournament, ...project.tournament },
    concurrency: { ...global.concurrency, ...project.concurrency },
    steering: { ...global.steering, ...project.steering },
  }
}
