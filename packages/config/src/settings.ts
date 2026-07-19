import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { getBaseDir, getProjectDir } from './paths.js'

export const ModelConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).default('openai'),
  model: z.string(),
  baseURL: z.string().url().optional(),
  thinkingLevel: z
    .enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    .default('medium'),
})
export type ModelConfig = z.infer<typeof ModelConfigSchema>

export const TournamentSettingsSchema = z.object({
  maxRounds: z.number().default(10),
  targetF1: z.number().default(0.9),
  convergenceWindow: z.number().default(3),
  convergenceThreshold: z.number().default(0.005),
})

export const ConcurrencySettingsSchema = z.object({
  maxConcurrentRuns: z.number().default(4),
})

export const SteeringSettingsSchema = z.object({
  mode: z.enum(['one-at-a-time', 'all']).default('one-at-a-time'),
})

export const GlobalSettingsSchema = z.object({
  models: z.record(z.string(), ModelConfigSchema),
  tournament: TournamentSettingsSchema,
  concurrency: ConcurrencySettingsSchema,
  steering: SteeringSettingsSchema,
})
export type GlobalSettings = z.infer<typeof GlobalSettingsSchema>

export type ProjectSettings = Partial<GlobalSettings> & {
  mcp?: { servers: unknown[] }
  skills?: { directories: string[] }
  prompts?: { dir: string }
}

// 默认配置不含任何模型名/网关地址，必须通过 REST API 设置
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
  return raw as ProjectSettings
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
    tournament: { ...global.tournament, ...project.tournament },
    concurrency: { ...global.concurrency, ...project.concurrency },
    steering: { ...global.steering, ...project.steering },
  }
}
