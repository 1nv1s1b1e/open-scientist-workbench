import { createOpenAI } from '@ai-sdk/openai'
import { createLogger } from '@open-scientist/logger'
import type { CredentialStore } from '@open-scientist/schema'
import type { LanguageModel } from 'ai'
import type { AgentRole } from './constants.ts'
import { DEFAULT_THINKING_LEVEL } from './constants.ts'
import type { ModelConfig } from './settings.ts'
import { getSettings } from './settings.ts'

const logger = createLogger('config')

export type { ModelConfig }

/** Thrown when a requested `modelAlias` is not in settings.modelAliases. */
export class ModelAliasNotFoundError extends Error {
  constructor(alias: string) {
    super(`Unknown modelAlias "${alias}". Define via PUT /api/settings/model-aliases/${alias}.`)
    this.name = 'ModelAliasNotFoundError'
  }
}

export interface ProviderFactory {
  create(config: ModelArg): LanguageModel
}

/**
 * Serializable model descriptor passed across workflow + step boundaries.
 *
 * Workflow args are serialized via structured clone, so they cannot carry a
 * `LanguageModel` (which has bound methods + SDK clients). Instead, callers
 * pass a plain-object `ModelArg`; the workflow reconstructs a `LanguageModel`
 * inside its body via `createModelFromConfig(modelConfig)`.
 *
 * `apiKey` + `baseURL` + `provider` are folded in here (resolved from the
 * credential referenced by `ModelConfig.credentialId`) so the workflow has
 * everything it needs in one serializable payload. The settings layer (which
 * never persists apiKeys) builds a `ModelArg` at runtime by combining a
 * credential-agnostic `ModelConfig` with a credential from `CredentialStore`.
 */
export interface ModelArg {
  provider: 'openai' | 'anthropic'
  model: string
  baseURL?: string
  thinkingLevel: string
  apiKey: string
}

class OpenAIFactory implements ProviderFactory {
  create(config: ModelArg): LanguageModel {
    logger.info(
      {
        provider: config.provider,
        model: config.model,
        baseURL: config.baseURL,
        apiKeyPrefix: config.apiKey?.slice(0, 8),
        thinkingLevel: config.thinkingLevel,
      },
      'OpenAIFactory.create: constructing language model',
    )
    const openai = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
    // 用 chat completions API（/v1/chat/completions）而非默认的 responses API（/v1/responses）。
    // 自建/第三方 OpenAI 兼容网关（vLLM、Qwen 等）普遍只完整支持 chat completions，
    // responses API 的 schema 校验（error.type、annotations 数组）常不匹配。
    const model = openai.chat(config.model)
    logger.info(
      { provider: config.provider, model: config.model },
      'OpenAIFactory.create: model constructed',
    )
    return model
  }
}

const factories: Record<string, ProviderFactory> = {
  openai: new OpenAIFactory(),
}

/**
 * Build a {@link ModelArg} from settings + credentials.
 *
 * Resolution: `settings.models[role] ?? settings.models.default` (or a named
 * alias when `modelAlias` is provided) → the {@link ModelConfig} carries a
 * `credentialId` → `credentials.get(credentialId)` returns the full endpoint
 * bundle `{provider, apiKey, baseURL?}`. `provider`/`baseURL`/`apiKey` all
 * come from the credential, so "same provider, different url+key" is simply
 * two distinct credential rows.
 */
export async function resolveModelArg(
  projectName: string | undefined,
  credentials: CredentialStore,
  options?: { role?: AgentRole; modelAlias?: string },
): Promise<ModelArg> {
  const role = options?.role ?? 'sisyphus'
  const modelAlias = options?.modelAlias
  const settings = await getSettings(projectName)

  let cfg: ModelConfig
  if (modelAlias) {
    const aliasCfg = settings.modelAliases?.[modelAlias]
    if (!aliasCfg) {
      throw new ModelAliasNotFoundError(modelAlias)
    }
    cfg = aliasCfg
  } else {
    const roleCfg = settings.models[role] ?? settings.models.default
    if (!roleCfg) {
      throw new Error(
        `No model config for role "${role}". Configure via PUT /api/settings/models/${role}.`,
      )
    }
    cfg = roleCfg
  }

  const cred = await credentials.get(cfg.credentialId)
  if (!cred) {
    throw new Error(
      `No credential found for id "${cfg.credentialId}". Add via POST /api/credentials.`,
    )
  }

  const provider = cred.provider as 'openai' | 'anthropic'
  const factory = factories[provider]
  if (!factory) throw new Error(`Unsupported provider: ${provider}`)

  return {
    provider,
    model: cfg.model,
    ...(cred.baseURL ? { baseURL: cred.baseURL } : {}),
    apiKey: cred.apiKey,
    thinkingLevel: cfg.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
  }
}

/**
 * Resolve a {@link LanguageModel} for an agent role (convenience wrapper around
 * {@link resolveModelArg} + {@link createModelFromConfig}).
 */
export async function getAgentModel(
  role: AgentRole,
  projectName: string | undefined,
  credentials: CredentialStore,
): Promise<LanguageModel> {
  logger.info({ role, projectName }, 'getAgentModel: start')
  const modelArg = await resolveModelArg(projectName, credentials, { role })
  logger.info(
    { role, projectName, provider: modelArg.provider, model: modelArg.model },
    'getAgentModel: model arg resolved',
  )
  return createModelFromConfig(modelArg)
}

// 便利函数：给定 ModelArg（含 apiKey）直接造 LanguageModel（不走 settings，给 /api/test-llm 用）
export function createModelFromConfig(config: ModelArg): LanguageModel {
  logger.info(
    {
      provider: config.provider,
      model: config.model,
      baseURL: config.baseURL,
      apiKeyPrefix: config.apiKey?.slice(0, 8),
    },
    'createModelFromConfig: start',
  )
  const factory = factories[config.provider]
  if (!factory) throw new Error(`Unsupported provider: ${config.provider}`)
  return factory.create(config)
}
