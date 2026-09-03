import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { FetchFunction, ProviderOptions } from '@ai-sdk/provider-utils'
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

export type Provider = 'openai' | 'anthropic'

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
  provider: Provider
  model: string
  baseURL?: string
  thinkingLevel: string
  /** OpenAI only: 'chat' = /v1/chat/completions, 'responses' = /v1/responses. Anthropic ignores this. */
  apiMode: 'chat' | 'responses'
  apiKey: string
}

export function applyQwenChatRequestCompatibility(
  config: Pick<ModelArg, 'provider' | 'model' | 'apiMode' | 'thinkingLevel'>,
  requestBody: Record<string, unknown>,
): Record<string, unknown> {
  if (config.provider !== 'openai' || config.apiMode !== 'chat' || !/^qwen/i.test(config.model))
    return requestBody
  const body = { ...requestBody }
  const thinkingBudget: Record<string, number> = {
    minimal: 512,
    low: 1024,
    medium: 2048,
    high: 4096,
    xhigh: 8192,
    max: 16384,
  }
  delete body.reasoning_effort
  const enabled = config.thinkingLevel !== 'off'
  body.enable_thinking = enabled
  if (enabled) {
    body.thinking_budget = thinkingBudget[config.thinkingLevel] ?? thinkingBudget.medium
  } else {
    delete body.thinking_budget
  }
  return body
}

function qwenCompatibilityFetch(config: ModelArg): FetchFunction | undefined {
  if (config.provider !== 'openai' || config.apiMode !== 'chat' || !/^qwen/i.test(config.model)) {
    return undefined
  }
  return async (input, init) => {
    if (typeof init?.body !== 'string') return globalThis.fetch(input, init)
    try {
      const parsedBody = JSON.parse(init.body) as Record<string, unknown>
      // Qwen hybrid models use native Chat-Completions fields rather than the
      // OpenAI provider's generic `reasoning_effort` option.  Always make the
      // mode explicit so a gateway default cannot silently turn reasoning on
      // or off.  A bounded budget keeps tool-using scientific workers from
      // spending an unbounded number of tokens before `submit_result`.
      const body = applyQwenChatRequestCompatibility(config, parsedBody)
      return globalThis.fetch(input, { ...init, body: JSON.stringify(body) })
    } catch {
      return globalThis.fetch(input, init)
    }
  }
}

/**
 * Provider-specific options derived from `thinkingLevel`. Passed to the
 * `ToolLoopAgent` constructor as `providerOptions` so every `streamText` /
 * `generateText` call inside the agent loop applies them.
 *
 * - **openai**: `reasoningEffort` ('minimal'..'max'). 'off' omits the optional field.
 * - **anthropic**: `thinking` (adaptive for newer models; 'off' omits the key).
 */
export function thinkingLevelToProviderOptions(
  provider: Provider,
  thinkingLevel: string,
): ProviderOptions {
  if (provider === 'openai') {
    // OpenAI-compatible third-party gateways often reject the optional
    // reasoning_effort field. Omitting it for "off" is semantically exact
    // and keeps standard chat-completions endpoints interoperable.
    if (thinkingLevel === 'off') return {}
    const effortMap: Record<string, string> = {
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    }
    return { openai: { reasoningEffort: effortMap[thinkingLevel] ?? 'medium' } }
  }
  // anthropic — adaptive thinking with effort; 'off' disables
  if (thinkingLevel === 'off') return {}
  const effortMap: Record<string, string> = {
    minimal: 'low',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'high',
    max: 'max',
  }
  return {
    anthropic: {
      thinking: { type: 'adaptive', effort: effortMap[thinkingLevel] ?? 'medium' },
    },
  }
}

/**
 * Construct a `LanguageModel` from a {@link ModelArg}.
 *
 * - `openai`: `createOpenAI` + `.chat()` (chat completions API) or `.responses()`
 *   (responses API). Third-party OpenAI-compatible gateways (vLLM, Qwen) only
 *   support chat completions — use `apiMode: 'chat'` for those.
 * - `anthropic`: `createAnthropic` + default model accessor.
 */
function createLanguageModel(config: ModelArg): LanguageModel {
  logger.info(
    {
      provider: config.provider,
      model: config.model,
      baseURL: config.baseURL,
      thinkingLevel: config.thinkingLevel,
      apiMode: config.apiMode,
    },
    'createLanguageModel: constructing language model',
  )

  if (config.provider === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    })
    const model = anthropic(config.model)
    logger.info(
      { provider: config.provider, model: config.model },
      'createLanguageModel: model constructed',
    )
    return model
  }

  // openai
  const compatibilityFetch = qwenCompatibilityFetch(config)
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    ...(compatibilityFetch ? { fetch: compatibilityFetch } : {}),
  })
  const model =
    config.apiMode === 'responses' ? openai.responses(config.model) : openai.chat(config.model)
  logger.info(
    { provider: config.provider, model: config.model, apiMode: config.apiMode },
    'createLanguageModel: model constructed',
  )
  return model
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

  return {
    provider: cred.provider,
    model: cfg.model,
    ...(cred.baseURL ? { baseURL: cred.baseURL } : {}),
    apiKey: cred.apiKey,
    thinkingLevel: cfg.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
    apiMode: cfg.apiMode ?? 'chat',
  }
}

export function createModelFromConfig(config: ModelArg): LanguageModel {
  return createLanguageModel(config)
}
