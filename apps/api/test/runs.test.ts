import type { ModelArg } from '@open-scientist/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

/**
 * Runs-route unit tests.
 *
 * The tournament workflow + RunRegistry (`../lib/run-stream`) + storage layer
 * are all mocked so no real LLM call, SQLite write, or workflow run is
 * triggered. Each test configures the mock return values, issues an
 * `app.request(...)` against the Hono app, and asserts on the Response.
 *
 * Mocking strategy:
 *   - `../lib/run-stream` → `start` + `getRun` are replaced with vi.fn()
 *     stubs. The `start` stub returns a fake `Run`-like object whose
 *     `getReadable()` yields a trivial chunk stream and whose `runId` is
 *     deterministic.
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

// resolveModelArg (config) is stubbed per-test; route wraps it as
// resolveRunModelArg. Throwing ModelAliasNotFoundError simulates alias miss.
let resolveModelArgResult: ModelArg
let resolveModelArgThrows: Error | null
let projectRow: { id: string; name: string } | null
let storageGetRunRow: Record<string, unknown> | null
let storageCreateRunResult: { id: string; status: string } | null
let updateRunStatusCalls: Array<{ projectName: string; runId: string; status: string }>

// run-stream stubs
let startCalls: Array<unknown[]>
let startRun: {
  runId: string
  cancel: () => Promise<void>
  getReadable: (opts?: { startIndex?: number }) => {
    pipeThrough: <T>(transform: TransformStream<unknown, T>) => ReadableStream<T>
    getTailIndex: () => Promise<number>
  }
}

// ─── Mocks (hoisted) ─────────────────────────────────────────────────────────

vi.mock('../src/lib/run-stream', () => ({
  start: vi.fn((...args: unknown[]) => {
    startCalls.push(args)
    return startRun
  }),
  getRun: vi.fn((runId: string) => {
    if (startRun === undefined) return undefined
    return {
      runId,
      cancel: startRun.cancel,
      getReadable: startRun.getReadable,
    }
  }),
}))

vi.mock('@open-scientist/storage', () => ({
  createCredentialStore: vi.fn(async () => ({
    get: vi.fn(),
    list: vi.fn(),
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
  completeRun: vi.fn(async () => {}),
}))

vi.mock('@open-scientist/config', async () => {
  // Import the real module to re-export everything EXCEPT resolveModelArg +
  // resolveAgentConfigs, which we replace so the route's resolveRunModelArg +
  // resolveRunAgentConfigs use our stubs instead of reading real settings +
  // credentials.
  const actual =
    await vi.importActual<typeof import('@open-scientist/config')>('@open-scientist/config')
  return {
    ...actual,
    resolveModelArg: vi.fn(async () => {
      if (resolveModelArgThrows) throw resolveModelArgThrows
      return resolveModelArgResult
    }),
    resolveAgentConfigs: vi.fn(async () => {
      if (resolveModelArgThrows) throw resolveModelArgThrows
      // Build a config map where every tournament role gets the stubbed
      // ModelArg. The route only reads .sisyphus.modelConfig for the legacy
      // modelConfig field, and the per-role entries are forwarded into
      // agentConfigs.
      const roles = ['sisyphus', 'librarian', 'looker', 'explore', 'oracle', 'prometheus'] as const
      const configs = {} as Record<string, { modelConfig: typeof resolveModelArgResult }>
      for (const role of roles) {
        configs[role] = { modelConfig: resolveModelArgResult }
      }
      return configs
    }),
    ModelAliasNotFoundError: actual.ModelAliasNotFoundError,
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

/** Build the fake Run object used by the run-stream mock. */
function makeFakeRun(runId: string, tailIndex = 0) {
  const readable = singleChunkStream()
  return {
    runId,
    cancel: vi.fn(async () => {}),
    result: Promise.resolve({
      runId,
      winningHypoId: '',
      bestF1: 0,
      totalRounds: 1,
      mhdConfigPath: null,
      proposalPath: null,
    }),
    getReadable: (_opts?: { startIndex?: number }) => ({
      pipeThrough: <T>(transform: TransformStream<unknown, T>) => readable.pipeThrough(transform),
      getTailIndex: async () => tailIndex,
    }),
  } as unknown as typeof startRun
}

// ─── App import (after mocks are in place) ───────────────────────────────────
import app from '../src/index'

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  startCalls = []
  updateRunStatusCalls = []
  storageGetRunRow = null
  storageCreateRunResult = null
  startRun = makeFakeRun('wrun_test-123', 5)
  resolveModelArgThrows = null
  // Default: sisyphus model resolved to an openai-compatible ModelArg.
  resolveModelArgResult = {
    provider: 'openai',
    model: 'gpt-4o',
    baseURL: 'http://gw.test/v1',
    apiKey: 'sk-test-key',
    thinkingLevel: 'medium',
    apiMode: 'chat',
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

    // start() was called once with a single ModelArg-bearing payload (the
    // RunRegistry's start takes the input object directly, not a
    // [workflowFn, [args]] tuple).
    expect(startCalls).toHaveLength(1)
    const input = startCalls[0]![0] as {
      seed: string
      projectId: string
      runId: string
      modelConfig: ModelArg
    }
    expect(input.seed).toBe('nanoflare reconnection heats the corona')
    expect(input.projectId).toBe('my-proj')
    expect(input.runId).toMatch(/^run-\d+-[0-9a-f]{8}$/)
    expect(input.modelConfig.apiKey).toBe('sk-test-key')
    expect(input.modelConfig.provider).toBe('openai')
    expect(input.modelConfig.model).toBe('gpt-4o')

    // createRun persisted with the run id + status running.
    expect(storageCreateRunResult).not.toBeNull()
    expect(storageCreateRunResult?.status).toBe('running')
  })

  it('forwards a structured phenomenon to the scientific workflow path', async () => {
    const phenomenon = {
      phenomenonId: 'ar-1-brightening',
      title: '活动区多波段短时增亮',
      description: '同一活动区在两个 EUV 波段出现时序不同的增亮。',
      activeRegion: 'AR-1',
      observations: [
        {
          sourceId: 'obs-171',
          kind: 'image',
          label: 'AIA 171',
          uri: 'fixture://ar-1/aia-171.fits',
          instrument: 'AIA',
          wavelengthOrBand: '171 Å',
        },
      ],
      requestedQuestion: '区分波动耗散和纳耀斑重联。',
    }
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: '请分析该现象', phenomenon, maxRounds: 2 }),
    })

    expect(res.status).toBe(200)
    const input = startCalls[0]![0] as {
      phenomenon?: { phenomenonId: string }
      maxRounds?: number
    }
    expect(input.phenomenon?.phenomenonId).toBe('ar-1-brightening')
    expect(input.maxRounds).toBe(2)
  })

  it('allows scientific mode to start without a seed field', async () => {
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phenomenon: {
          phenomenonId: 'ar-2',
          title: '活动区 EUV 增亮',
          description: '一个活动区在 EUV 图像中出现短时增亮。',
          observations: [{ sourceId: 'obs-193', kind: 'image', label: 'AIA 193', uri: 'fixture://ar-2/aia-193.fits' }],
        },
      }),
    })

    expect(res.status).toBe(200)
    const input = startCalls[0]![0] as { seed: string; phenomenon?: { phenomenonId: string } }
    expect(input.phenomenon?.phenomenonId).toBe('ar-2')
    expect(input.seed).toBe('活动区 EUV 增亮')
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

  it('returns 500 when no credential is configured for the referenced credentialId', async () => {
    resolveModelArgThrows = new Error('No credential found for id "cred-x".')
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
    resolveModelArgThrows = new Error('No model config for role "sisyphus".')
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'x' }),
    })
    expect(res.status).toBe(500)
    const body = await json(res)
    expect(body.error).toBe('model_config_error')
  })

  it('forwards credential baseURL + thinkingLevel from settings', async () => {
    resolveModelArgResult = {
      provider: 'openai',
      model: 'gpt-4o',
      baseURL: 'http://gw.test/v1',
      apiKey: 'sk-test-key',
      thinkingLevel: 'high',
      apiMode: 'chat',
    }
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'x' }),
    })
    expect(res.status).toBe(200)
    const input = startCalls[0]![0] as { modelConfig: ModelArg }
    expect(input.modelConfig.baseURL).toBe('http://gw.test/v1')
    expect(input.modelConfig.thinkingLevel).toBe('high')
  })

  it('omits baseURL when credential carries none', async () => {
    resolveModelArgResult = {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-test-key',
      thinkingLevel: 'medium',
      apiMode: 'chat',
    }
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'x' }),
    })
    expect(res.status).toBe(200)
    const input = startCalls[0]![0] as { modelConfig: ModelArg }
    expect(input.modelConfig.baseURL).toBeUndefined()
  })

  it('resolves modelAlias from settings.modelAliases when provided', async () => {
    resolveModelArgResult = {
      provider: 'openai',
      model: 'qwen-2.5-80b',
      baseURL: 'http://gw.qwen/v1',
      apiKey: 'sk-test-key',
      thinkingLevel: 'high',
      apiMode: 'chat',
    }
    const res = await app.request('/api/projects/my-proj/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'x', modelAlias: 'qwen-80b' }),
    })
    expect(res.status).toBe(200)
    const input = startCalls[0]![0] as { modelConfig: ModelArg }
    expect(input.modelConfig.model).toBe('qwen-2.5-80b')
    expect(input.modelConfig.baseURL).toBe('http://gw.qwen/v1')
    expect(input.modelConfig.thinkingLevel).toBe('high')
    expect(input.modelConfig.apiKey).toBe('sk-test-key')
  })

  it('returns 400 when modelAlias is not defined in settings', async () => {
    const { ModelAliasNotFoundError } = await import('@open-scientist/config')
    resolveModelArgThrows = new ModelAliasNotFoundError('no-such-alias')
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
    const input = startCalls[0]![0] as { modelConfig: ModelArg }
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

  it('returns 404 when the run is not in the registry (completed / unknown)', async () => {
    // Override the getRun mock to return undefined for this test only.
    const runStream = await import('../src/lib/run-stream')
    vi.mocked(runStream.getRun).mockReturnValueOnce(undefined)
    const res = await app.request('/api/projects/my-proj/runs/unknown/stream')
    expect(res.status).toBe(404)
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

  it('still marks stopped in storage when the run already evicted from registry', async () => {
    storageGetRunRow = {
      id: 'wrun_test-123',
      projectId: 'proj-uuid-1',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: null,
      currentRound: 1,
      bestF1: 0,
    }
    const runStream = await import('../src/lib/run-stream')
    vi.mocked(runStream.getRun).mockReturnValueOnce(undefined)
    const res = await app.request('/api/projects/my-proj/runs/wrun_test-123/stop', {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    expect(updateRunStatusCalls).toEqual([
      { projectName: 'my-proj', runId: 'wrun_test-123', status: 'stopped' },
    ])
  })
})
