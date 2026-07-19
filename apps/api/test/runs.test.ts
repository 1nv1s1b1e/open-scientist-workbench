import type { ModelArg } from '@open-scientist/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Runs-route unit tests.
 *
 * The tournament workflow + workflow runtime (`workflow/api`) + storage layer
 * are all mocked so no real LLM call, SQLite write, or workflow run is
 * triggered. Each test configures the mock return values, issues an
 * `app.request(...)` against the Hono app, and asserts on the Response.
 *
 * Mocking strategy:
 *   - `workflow/api` → `start` + `getRun` are replaced with vi.fn() stubs. The
 *     `start` stub returns a fake `Run`-like object whose `readable` is a
 *     ReadableStream of one trivial chunk and whose `runId` is deterministic.
 *   - `@open-scientist/storage` → `createCredentialStore`, `getProject`,
 *     `createRun`, `getRun` (storage), `updateRunStatus` are stubbed.
 *   - `@open-scientist/config` → `getSettings` is stubbed to return a model
 *     config (or empty, to exercise the no-config error path).
 *
 * Mocks MUST be declared at top level (hoisted by vitest) so the module under
 * test picks them up at import time. The factory closures reference test-side
 * state via `let` bindings mutated per-test.
 */

// ─── Test-side mutable state (mutated per test, read by mock factories) ──────

let credentialGet: (provider: string) => Promise<{ key: string; type: string } | null>
let credentialList: () => Promise<
  Array<{ id: string; provider: string; metadata?: Record<string, unknown> }>
>
let settingsValue: {
  models: Record<string, unknown>
  modelAliases?: Record<string, unknown>
} | null
let projectRow: { id: string; name: string } | null
let storageGetRunRow: Record<string, unknown> | null
let storageCreateRunResult: { id: string; status: string } | null
let updateRunStatusCalls: Array<{ projectName: string; runId: string; status: string }>

// workflow/api stubs
let startCalls: Array<unknown[]>
let startRun: {
  runId: string
  readable: ReadableStream
  cancel: () => Promise<void>
  getReadable: (opts?: { startIndex?: number }) => {
    pipeThrough: <T>(transform: TransformStream<unknown, T>) => ReadableStream<T>
    getTailIndex: () => Promise<number>
  }
}

// ─── Mocks (hoisted) ─────────────────────────────────────────────────────────

vi.mock('workflow/api', () => ({
  start: vi.fn(async (...args: unknown[]) => {
    startCalls.push(args)
    return startRun
  }),
  getRun: vi.fn((runId: string) => ({
    runId,
    readable: startRun.readable,
    cancel: startRun.cancel,
    getReadable: startRun.getReadable,
  })),
}))

vi.mock('@open-scientist/storage', () => ({
  createCredentialStore: vi.fn(async () => ({
    get: (provider: string) => credentialGet(provider),
    list: () => credentialList(),
    add: vi.fn(),
    delete: vi.fn(),
  })),
  getProject: vi.fn(async (name: string) => projectRow && { ...projectRow, name }),
  createRun: vi.fn(async (_projectName: string, _projectId: string, options?: { id?: string }) => {
    const id = options?.id ?? 'auto-uuid'
    storageCreateRunResult = { id, status: 'running' }
    return storageCreateRunResult
  }),
  getRun: vi.fn(async (_projectName: string, _runId: string) => storageGetRunRow),
  updateRunStatus: vi.fn(async (projectName: string, runId: string, status: string) => {
    updateRunStatusCalls.push({ projectName, runId, status })
  }),
}))

vi.mock('@open-scientist/config', async () => {
  // Import the real module to re-export everything EXCEPT getSettings, which
  // we replace. This keeps DEFAULT_THINKING_LEVEL + constants available.
  const actual =
    await vi.importActual<typeof import('@open-scientist/config')>('@open-scientist/config')
  return {
    ...actual,
    getSettings: vi.fn(async () => settingsValue ?? { models: {} }),
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** A one-chunk ReadableStream that emits a start chunk then closes. */
function singleChunkStream(): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'start' })
      controller.close()
    },
  })
}

/** Build the fake Run object used by the workflow/api mock. */
function makeFakeRun(runId: string, tailIndex = 0) {
  const readable = singleChunkStream()
  return {
    runId,
    readable,
    cancel: vi.fn(async () => {}),
    getReadable: (_opts?: { startIndex?: number }) => ({
      pipeThrough: <T>(transform: TransformStream<unknown, T>) => readable.pipeThrough(transform),
      getTailIndex: async () => tailIndex,
    }),
  } as unknown as typeof startRun
}

// ─── App import (after mocks are in place) ───────────────────────────────────
// biome-ignore lint/correctness/noUnusedImports: re-import for type only
import type { Hono } from 'hono'
import app from '../src/index.js'

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  startCalls = []
  updateRunStatusCalls = []
  storageGetRunRow = null
  storageCreateRunResult = null
  startRun = makeFakeRun('wrun_test-123', 5)

  // Default: an openai credential + a sisyphus model config.
  // credential metadata is no longer read for baseURL (settings is the sole
  // source); keeping an arbitrary metadata field verifies transparent passthrough.
  credentialGet = async (_provider: string) => ({ key: 'sk-test-key', type: 'api-key' })
  credentialList = async () => [{ id: 'cred-1', provider: 'openai', metadata: { org: 'acme' } }]
  settingsValue = {
    models: {
      sisyphus: { provider: 'openai', model: 'gpt-4o', thinkingLevel: 'medium' },
    },
  }
  projectRow = { id: 'proj-uuid-1', name: 'my-proj' }
})

afterEach(() => {
  vi.clearAllMocks()
})

// ─── Tests ───────────────────────────────────────────────────────────────────

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe('POST /api/projects/:name/runs', () => {
  it('starts a run and returns an SSE stream + x-workflow-run-id header', async () => {
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'nanoflare reconnection heats the corona' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('x-workflow-run-id')).toBe('wrun_test-123')
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    // start() was called once with the tournament workflow + a ModelArg payload.
    expect(startCalls).toHaveLength(1)
    const [workflowFn, args] = startCalls[0]! as [unknown, unknown[]]
    expect(typeof workflowFn).toBe('function')
    const input = args[0] as {
      seed: string
      projectId: string
      runId: string
      modelConfig: ModelArg
    }
    expect(input.seed).toBe('nanoflare reconnection heats the corona')
    expect(input.projectId).toBe('my-proj')
    expect(input.runId).toMatch(/^run-\d+$/)
    expect(input.modelConfig.apiKey).toBe('sk-test-key')
    expect(input.modelConfig.provider).toBe('openai')
    expect(input.modelConfig.model).toBe('gpt-4o')

    // createRun persisted with the SDK run id + status running.
    expect(storageCreateRunResult).not.toBeNull()
    expect(storageCreateRunResult?.id).toBe('wrun_test-123')
    expect(storageCreateRunResult?.status).toBe('running')
  })

  it('returns 400 when seed is missing', async () => {
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toBe('bad_request')
  })

  it('returns 404 when the project does not exist', async () => {
    projectRow = null
    const res = await app.request('/api/projects/ghost/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'x' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 500 when no openai credential is configured', async () => {
    credentialGet = async () => null
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'x' }),
    })
    expect(res.status).toBe(500)
    const body = await json(res)
    expect(body.error).toBe('model_config_error')
    expect(String(body.message)).toContain('credential')
  })

  it('returns 500 when no model config is set for sisyphus or default', async () => {
    settingsValue = { models: {} }
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'x' }),
    })
    expect(res.status).toBe(500)
    const body = await json(res)
    expect(body.error).toBe('model_config_error')
  })

  it('forwards settings baseURL when set (no credential fallback)', async () => {
    settingsValue = {
      models: {
        sisyphus: {
          provider: 'openai',
          model: 'gpt-4o',
          baseURL: 'http://gw.test/v1',
          thinkingLevel: 'high',
        },
      },
    }
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'x' }),
    })
    expect(res.status).toBe(200)
    const input = (startCalls[0]![1] as unknown[])[0] as { modelConfig: ModelArg }
    expect(input.modelConfig.baseURL).toBe('http://gw.test/v1')
    expect(input.modelConfig.thinkingLevel).toBe('high')
  })

  it('omits baseURL when settings carry none (no credential fallback)', async () => {
    // credential metadata.baseURL is no longer read — settings is the sole source.
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'x' }),
    })
    expect(res.status).toBe(200)
    const input = (startCalls[0]![1] as unknown[])[0] as { modelConfig: ModelArg }
    expect(input.modelConfig.baseURL).toBeUndefined()
  })

  it('resolves modelAlias from settings.modelAliases when provided', async () => {
    settingsValue = {
      models: {
        sisyphus: { provider: 'openai', model: 'gpt-4o', thinkingLevel: 'medium' },
      },
      modelAliases: {
        'qwen-80b': {
          provider: 'openai',
          model: 'qwen-2.5-80b',
          baseURL: 'http://gw.qwen/v1',
          thinkingLevel: 'high',
        },
      },
    }
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'x', modelAlias: 'qwen-80b' }),
    })
    expect(res.status).toBe(200)
    const input = (startCalls[0]![1] as unknown[])[0] as { modelConfig: ModelArg }
    expect(input.modelConfig.model).toBe('qwen-2.5-80b')
    expect(input.modelConfig.baseURL).toBe('http://gw.qwen/v1')
    expect(input.modelConfig.thinkingLevel).toBe('high')
    expect(input.modelConfig.apiKey).toBe('sk-test-key')
  })

  it('returns 400 when modelAlias is not defined in settings', async () => {
    settingsValue = {
      models: {
        sisyphus: { provider: 'openai', model: 'gpt-4o', thinkingLevel: 'medium' },
      },
      modelAliases: {},
    }
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'x', modelAlias: 'no-such-alias' }),
    })
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toBe('bad_request')
    expect(String(body.message)).toContain('no-such-alias')
  })

  it('ignores empty modelAlias and falls back to settings.models.sisyphus', async () => {
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'x', modelAlias: '' }),
    })
    expect(res.status).toBe(200)
    const input = (startCalls[0]![1] as unknown[])[0] as { modelConfig: ModelArg }
    expect(input.modelConfig.model).toBe('gpt-4o')
  })
})

describe('GET /api/projects/:name/runs/:runId/stream', () => {
  it('returns an SSE stream and echoes the run id header', async () => {
    const res = await app.request('/api/projects/my-proj/runs/wrun_test-123/stream')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-workflow-run-id')).toBe('wrun_test-123')
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('returns the tail-index header when startIndex is negative', async () => {
    const res = await app.request('/api/projects/my-proj/runs/wrun_test-123/stream?startIndex=-3')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-workflow-stream-tail-index')).toBe('5')
  })

  it('omits the tail-index header when startIndex >= 0', async () => {
    const res = await app.request('/api/projects/my-proj/runs/wrun_test-123/stream?startIndex=2')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-workflow-stream-tail-index')).toBeNull()
  })

  it('returns 400 when startIndex is not an integer', async () => {
    const res = await app.request('/api/projects/my-proj/runs/wrun_test-123/stream?startIndex=abc')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/projects/:name/runs/:runId', () => {
  it('returns the run record when it exists', async () => {
    storageGetRunRow = {
      id: 'wrun_test-123',
      projectId: 'proj-uuid-1',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: null,
      currentRound: 2,
      bestF1: 0.74,
    }
    const res = await app.request('/api/projects/my-proj/runs/wrun_test-123')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.runId).toBe('wrun_test-123')
    expect(body.status).toBe('running')
    expect(body.currentRound).toBe(2)
    expect(body.bestF1).toBe(0.74)
  })

  it('returns 404 when the run is not in the project db', async () => {
    storageGetRunRow = null
    const res = await app.request('/api/projects/my-proj/runs/unknown')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/projects/:name/runs/:runId/stop', () => {
  it('cancels the workflow run and marks it stopped in storage', async () => {
    storageGetRunRow = {
      id: 'wrun_test-123',
      projectId: 'proj-uuid-1',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: null,
      currentRound: 1,
      bestF1: 0,
    }
    const res = await app.request('/api/projects/my-proj/runs/wrun_test-123/stop', {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.ok).toBe(true)
    expect(body.status).toBe('stopped')

    // cancel() on the fake run was invoked.
    expect(startRun.cancel).toHaveBeenCalledTimes(1)
    // storage updateRunStatus was called with 'stopped'.
    expect(updateRunStatusCalls).toEqual([
      { projectName: 'my-proj', runId: 'wrun_test-123', status: 'stopped' },
    ])
  })

  it('returns 404 when the run is not found', async () => {
    storageGetRunRow = null
    const res = await app.request('/api/projects/my-proj/runs/unknown/stop', {
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })
})
