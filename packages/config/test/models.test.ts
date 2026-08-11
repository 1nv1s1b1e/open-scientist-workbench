import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Credential, CredentialStore } from '@open-scientist/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  applyQwenChatRequestCompatibility,
  ModelAliasNotFoundError,
  resolveModelArg,
} from '../src/models.ts'

const BASE_DIR_KEY = 'BASE_DIR'

let baseDir: string

beforeEach(async () => {
  delete process.env[BASE_DIR_KEY]
  baseDir = await mkdtemp(join(tmpdir(), 'os-models-'))
  process.env[BASE_DIR_KEY] = baseDir
})

afterEach(async () => {
  delete process.env[BASE_DIR_KEY]
  await rm(baseDir, { recursive: true, force: true })
})

async function writeGlobalSettings(data: Record<string, unknown>): Promise<void> {
  await writeFile(join(baseDir, 'settings.json'), JSON.stringify(data, null, 2), 'utf-8')
}

async function writeProjectSettings(
  projectName: string,
  data: Record<string, unknown>,
): Promise<void> {
  const dir = join(baseDir, 'projects', projectName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'settings.json'), JSON.stringify(data, null, 2), 'utf-8')
}

function createFakeCredentialStore(credentials: Map<string, Credential>): CredentialStore {
  return {
    async get(id: string): Promise<Credential | null> {
      return credentials.get(id) ?? null
    },
    async list(): Promise<Credential[]> {
      return []
    },
    async add(): Promise<string> {
      throw new Error('not implemented in fake')
    },
    async delete(): Promise<void> {
      throw new Error('not implemented in fake')
    },
  }
}

function makeCredential(id: string, overrides: Partial<Credential> = {}): Credential {
  return {
    id,
    provider: 'openai',
    type: 'api-key',
    apiKey: `key-${id}`,
    ...overrides,
  }
}

const FULL_TOURNAMENT = {
  maxRounds: 10,
  targetF1: 0.9,
  convergenceWindow: 3,
  convergenceThreshold: 0.005,
}

describe('Qwen chat reasoning compatibility', () => {
  it('explicitly disables Qwen thinking for off', () => {
    expect(applyQwenChatRequestCompatibility(
      { provider: 'openai', model: 'qwen3.5-plus', apiMode: 'chat', thinkingLevel: 'off' },
      { reasoning_effort: 'high', thinking_budget: 999, messages: [] },
    )).toEqual({ enable_thinking: false, messages: [] })
  })

  it('enables bounded native Qwen thinking for scientific agents', () => {
    expect(applyQwenChatRequestCompatibility(
      { provider: 'openai', model: 'qwen3.5-plus', apiMode: 'chat', thinkingLevel: 'high' },
      { reasoning_effort: 'high', messages: [] },
    )).toEqual({ enable_thinking: true, thinking_budget: 4096, messages: [] })
  })

  it('does not alter non-Qwen requests', () => {
    const body = { reasoning_effort: 'high', messages: [] }
    expect(applyQwenChatRequestCompatibility(
      { provider: 'openai', model: 'gpt-5', apiMode: 'chat', thinkingLevel: 'high' },
      body,
    )).toBe(body)
  })
})

describe('resolveModelArg', () => {
  it('resolves via role: settings.models[role] → credentialId → credential → ModelArg', async () => {
    await writeGlobalSettings({
      models: {
        sisyphus: { model: 'gpt-4o', credentialId: 'cred-a', thinkingLevel: 'high' },
      },
      tournament: FULL_TOURNAMENT,
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
    })
    const store = createFakeCredentialStore(
      new Map([['cred-a', makeCredential('cred-a', { baseURL: 'http://localhost:8000' })]]),
    )

    const arg = await resolveModelArg(undefined, store, { role: 'sisyphus' })
    expect(arg.provider).toBe('openai')
    expect(arg.model).toBe('gpt-4o')
    expect(arg.apiKey).toBe('key-cred-a')
    expect(arg.baseURL).toBe('http://localhost:8000')
    expect(arg.thinkingLevel).toBe('high')
  })

  it('falls back to settings.models.default when role is not found', async () => {
    await writeGlobalSettings({
      models: {
        default: { model: 'qwen-72b', credentialId: 'cred-b' },
      },
      tournament: FULL_TOURNAMENT,
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
    })
    const store = createFakeCredentialStore(new Map([['cred-b', makeCredential('cred-b')]]))

    const arg = await resolveModelArg(undefined, store, { role: 'librarian' })
    expect(arg.model).toBe('qwen-72b')
    expect(arg.apiKey).toBe('key-cred-b')
    expect(arg.thinkingLevel).toBe('medium')
  })

  it('throws when neither role nor default is configured', async () => {
    await writeGlobalSettings({
      models: {},
      tournament: FULL_TOURNAMENT,
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
    })
    const store = createFakeCredentialStore(new Map())

    await expect(resolveModelArg(undefined, store, { role: 'oracle' })).rejects.toThrow(
      'No model config for role "oracle"',
    )
  })

  it('resolves via modelAlias: settings.modelAliases[alias] → credentialId → ModelArg', async () => {
    await writeGlobalSettings({
      models: {},
      modelAliases: {
        fast: { model: 'gpt-4o-mini', credentialId: 'cred-c', thinkingLevel: 'low' },
      },
      tournament: FULL_TOURNAMENT,
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
    })
    const store = createFakeCredentialStore(new Map([['cred-c', makeCredential('cred-c')]]))

    const arg = await resolveModelArg(undefined, store, { modelAlias: 'fast' })
    expect(arg.model).toBe('gpt-4o-mini')
    expect(arg.apiKey).toBe('key-cred-c')
    expect(arg.thinkingLevel).toBe('low')
  })

  it('throws ModelAliasNotFoundError when alias is not configured', async () => {
    await writeGlobalSettings({
      models: {},
      tournament: FULL_TOURNAMENT,
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
    })
    const store = createFakeCredentialStore(new Map())

    await expect(resolveModelArg(undefined, store, { modelAlias: 'bogus' })).rejects.toThrow(
      ModelAliasNotFoundError,
    )
  })

  it('throws when credential is not found for credentialId', async () => {
    await writeGlobalSettings({
      models: {
        sisyphus: { model: 'gpt-4o', credentialId: 'missing-cred' },
      },
      tournament: FULL_TOURNAMENT,
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
    })
    const store = createFakeCredentialStore(new Map())

    await expect(resolveModelArg(undefined, store, { role: 'sisyphus' })).rejects.toThrow(
      'No credential found for id "missing-cred"',
    )
  })

  it('assembles provider/baseURL/apiKey from the credential', async () => {
    await writeGlobalSettings({
      models: {
        sisyphus: { model: 'deepseek-chat', credentialId: 'cred-d' },
      },
      tournament: FULL_TOURNAMENT,
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
    })
    const store = createFakeCredentialStore(
      new Map([
        [
          'cred-d',
          makeCredential('cred-d', {
            provider: 'openai',
            apiKey: 'sk-secret-key',
            baseURL: 'https://api.deepseek.com',
          }),
        ],
      ]),
    )

    const arg = await resolveModelArg(undefined, store, { role: 'sisyphus' })
    expect(arg.provider).toBe('openai')
    expect(arg.apiKey).toBe('sk-secret-key')
    expect(arg.baseURL).toBe('https://api.deepseek.com')
  })

  it('omits baseURL when the credential has none', async () => {
    await writeGlobalSettings({
      models: {
        sisyphus: { model: 'gpt-4o', credentialId: 'cred-e' },
      },
      tournament: FULL_TOURNAMENT,
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
    })
    const store = createFakeCredentialStore(
      new Map([['cred-e', makeCredential('cred-e', { baseURL: undefined })]]),
    )

    const arg = await resolveModelArg(undefined, store, { role: 'sisyphus' })
    expect(arg.baseURL).toBeUndefined()
  })

  it('resolves from project settings when projectName is given', async () => {
    await writeGlobalSettings({
      models: {
        sisyphus: { model: 'global-model', credentialId: 'cred-g' },
      },
      tournament: FULL_TOURNAMENT,
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
    })
    await writeProjectSettings('proj-override', {
      models: {
        sisyphus: { model: 'project-model', credentialId: 'cred-p' },
      },
    })
    const store = createFakeCredentialStore(
      new Map([
        ['cred-g', makeCredential('cred-g')],
        ['cred-p', makeCredential('cred-p')],
      ]),
    )

    const arg = await resolveModelArg('proj-override', store, { role: 'sisyphus' })
    expect(arg.model).toBe('project-model')
    expect(arg.apiKey).toBe('key-cred-p')
  })
})
