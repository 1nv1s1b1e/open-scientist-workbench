import { z } from 'zod'

// Re-export ModelConfigSchema from config via schema-level mirror (zero-dep)
export const ModelConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).default('openai'),
  model: z.string().min(1),
  baseURL: z.string().url().optional(),
  thinkingLevel: z
    .enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    .default('medium'),
})
export type ModelConfig = z.infer<typeof ModelConfigSchema>

export const TournamentSettingsSchema = z.object({
  maxRounds: z.number().int().min(1).default(10),
  targetF1: z.number().min(0).max(1).default(0.9),
  convergenceWindow: z.number().int().min(1).default(3),
  convergenceThreshold: z.number().min(0).default(0.005),
})

export const ConcurrencySettingsSchema = z.object({
  maxConcurrentRuns: z.number().int().min(1).default(4),
})

export const SteeringSettingsSchema = z.object({
  mode: z.enum(['one-at-a-time', 'all']).default('one-at-a-time'),
})

export const GlobalSettingsSchema = z.object({
  models: z.record(z.string(), ModelConfigSchema).default({}),
  tournament: TournamentSettingsSchema,
  concurrency: ConcurrencySettingsSchema,
  steering: SteeringSettingsSchema,
})
export type GlobalSettings = z.infer<typeof GlobalSettingsSchema>

// 设置某个 role 的 model 配置
export const SetModelConfigRequestSchema = ModelConfigSchema
export type SetModelConfigRequest = z.infer<typeof SetModelConfigRequestSchema>

// 凭证管理
export const AddCredentialRequestSchema = z.object({
  provider: z.string().min(1),
  type: z.enum(['api-key', 'oauth-token']).default('api-key'),
  key: z.string().min(1),
  baseURL: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type AddCredentialRequest = z.infer<typeof AddCredentialRequestSchema>

export const CredentialResponseSchema = z.object({
  id: z.string(),
  provider: z.string(),
  type: z.enum(['api-key', 'oauth-token']),
  hasKey: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type CredentialResponse = z.infer<typeof CredentialResponseSchema>

// LLM 连通测试
export const TestLlmRequestSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).default('openai'),
  model: z.string().min(1),
  baseURL: z.string().url().optional(),
  apiKey: z.string().min(1),
  prompt: z.string().default('Say hi in 3 words.'),
  maxTokens: z.number().int().min(1).max(4096).default(50),
})
export type TestLlmRequest = z.infer<typeof TestLlmRequestSchema>

export const TestLlmResponseSchema = z.object({
  ok: z.boolean(),
  text: z.string().optional(),
  usage: z
    .object({
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
      totalTokens: z.number().optional(),
    })
    .optional(),
  model: z.string().optional(),
  error: z.string().optional(),
  durationMs: z.number(),
})
export type TestLlmResponse = z.infer<typeof TestLlmResponseSchema>
