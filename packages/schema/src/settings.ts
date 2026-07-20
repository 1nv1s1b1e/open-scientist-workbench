import { z } from 'zod'

// 模型配置（settings per role / model alias）。
// 一个 ModelConfig 只描述模型行为（model + thinkingLevel），endpoint 的
// provider/baseURL/apiKey 全部由 credentialId 引用的 Credential 条目决定。
// 这样「同 provider 不同 url+key」组合就是不同的 credential 条目。
export const ModelConfigSchema = z.object({
  model: z.string().min(1),
  thinkingLevel: z
    .enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    .default('medium'),
  credentialId: z.string().min(1),
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
  modelAliases: z.record(z.string(), ModelConfigSchema).optional(),
  tournament: TournamentSettingsSchema,
  concurrency: ConcurrencySettingsSchema,
  steering: SteeringSettingsSchema,
})
export type GlobalSettings = z.infer<typeof GlobalSettingsSchema>

// 设置某个 role 的 model 配置
export const SetModelConfigRequestSchema = ModelConfigSchema
export type SetModelConfigRequest = z.infer<typeof SetModelConfigRequestSchema>

// Model alias —— 一个用户自定义的短名（如 "fast"/"smart"/"qwen-80b"）指向完整的 ModelConfig。
// 创建 run 时传 modelAlias 字段引用某个 alias。
export const ModelAliasSchema = ModelConfigSchema
export type ModelAlias = z.infer<typeof ModelAliasSchema>

export const SetModelAliasRequestSchema = ModelAliasSchema
export type SetModelAliasRequest = z.infer<typeof SetModelAliasRequestSchema>

// 凭证管理 —— endpoint bundle 形态：一个 credential = {id, provider, apiKey, baseURL?}。
// id 是命名实体（可用户指定，如 "qwen-gateway"），不再按 provider 唯一。
// 同 provider 不同 url+key = 不同 credential 条目。metadata 保留给 OAuth 后期用。
export const AddCredentialRequestSchema = z.object({
  id: z.string().min(1).optional(),
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
  baseURL: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type CredentialResponse = z.infer<typeof CredentialResponseSchema>

// LLM 连通测试（独立于 credential，前端直接传完整 endpoint 测试一次）
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

// ── Credential 存储接口 ──────────────────────────────────────────────
// 这三个接口定义 credential 存储层契约，由 storage 包实现，config 包消费。
// 放在 schema（零依赖）避免 config → storage 的循环依赖
// （storage → config 是运行时依赖，方向不可逆）。

/** 存储层内部记录（含加密的 key）。 */
export interface CredentialRecord {
  id: string
  provider: string
  type: 'api-key' | 'oauth-token'
  encryptedKey: string
  baseURL?: string
  metadata?: Record<string, unknown>
}

/** 解密后的 credential，供 config 层构造 ModelArg 用。 */
export interface Credential {
  id: string
  provider: string
  type: 'api-key' | 'oauth-token'
  apiKey: string
  baseURL?: string
  metadata?: Record<string, unknown>
}

/**
 * Credential 存储契约。
 * storage 包（`createCredentialStore`）实现此接口；
 * config 包（`resolveModelArg`）只依赖此类型，避免循环依赖。
 */
export interface CredentialStore {
  /** Resolve a credential by its id. Returns null if not found. */
  get(id: string): Promise<Credential | null>
  list(): Promise<CredentialRecord[]>
  add(params: {
    id?: string
    provider: string
    type: 'api-key' | 'oauth-token'
    key: string
    baseURL?: string
    metadata?: Record<string, unknown>
  }): Promise<string>
  delete(id: string): Promise<void>
}
