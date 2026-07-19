import { createOpenAI } from '@ai-sdk/openai'
import type { CredentialStore } from '@open-scientist/storage'
import type { LanguageModel } from 'ai'
import type { AgentRole } from './constants.js'
import { DEFAULT_THINKING_LEVEL } from './constants.js'
import type { ModelConfig, ModelConfigSchema } from './settings.js'
import { getSettings } from './settings.js'

export type { ModelConfig, ModelConfigSchema }

export interface ProviderFactory {
  create(config: ResolvedModelConfig, apiKey: string): LanguageModel
}

export interface ResolvedModelConfig {
  provider: 'openai' | 'anthropic'
  model: string
  baseURL?: string
  thinkingLevel: string
}

class OpenAIFactory implements ProviderFactory {
  create(config: ResolvedModelConfig, apiKey: string): LanguageModel {
    const openai = createOpenAI({ apiKey, baseURL: config.baseURL })
    // 用 chat completions API（/v1/chat/completions）而非默认的 responses API（/v1/responses）。
    // 自建/第三方 OpenAI 兼容网关（vLLM、Qwen 等）普遍只完整支持 chat completions，
    // responses API 的 schema 校验（error.type、annotations 数组）常不匹配。
    return openai.chat(config.model)
  }
}

const factories: Record<string, ProviderFactory> = {
  openai: new OpenAIFactory(),
}

export async function getAgentModel(
  role: AgentRole,
  projectName: string | undefined,
  credentials: CredentialStore,
  _sessionId?: string,
): Promise<LanguageModel> {
  const settings = await getSettings(projectName)
  const config = settings.models[role] ?? settings.models.default
  if (!config) {
    throw new Error(
      `No model config for role "${role}". Configure via PUT /api/settings or PUT /api/settings/models/{role}.`,
    )
  }
  const cred = await credentials.get(config.provider)
  if (!cred) {
    throw new Error(
      `No credential found for provider "${config.provider}". Add via POST /api/credentials.`,
    )
  }

  const factory = factories[config.provider]
  if (!factory) throw new Error(`Unsupported provider: ${config.provider}`)

  return factory.create(
    {
      provider: config.provider,
      model: config.model,
      baseURL: config.baseURL,
      thinkingLevel: config.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
    },
    cred.key,
  )
}

// 便利函数：给定 ModelConfig + apiKey 直接造 LanguageModel（不走 settings，给 /api/test-llm 用）
export function createModelFromConfig(config: ResolvedModelConfig, apiKey: string): LanguageModel {
  const factory = factories[config.provider]
  if (!factory) throw new Error(`Unsupported provider: ${config.provider}`)
  return factory.create(config, apiKey)
}
