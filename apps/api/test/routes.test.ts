import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Each test runs in a fresh module graph (vi.resetModules) so the config
 * package's module-scope `env` constant (captured at import time from
 * process.env.BASE_DIR) points at a unique temp dir. This also resets the
 * global-db singleton, so each test gets a clean SQLite credential store.
 */
let tmp: string
let app: Hono

// Hono's `app.request` returns a fetch Response; `.json()` is typed `unknown`.
// The test bodies assert on a mix of object + array shapes, so the helper
// returns a permissive record and each test narrows with `as` where needed.
// biome-ignore lint/suspicious/noExplicitAny: test-only response shape is intentionally loose
async function json(res: Response): Promise<any> {
  return await res.json()
}

async function loadApp(baseDir: string): Promise<typeof import('../src/index.js')> {
  process.env.BASE_DIR = baseDir
  vi.resetModules()
  return import('../src/index.js')
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'os-api-routes-'))
  app = (await loadApp(tmp)).default
})

afterEach(() => {
  delete process.env.BASE_DIR
  rmSync(tmp, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('GET /api/health', () => {
  it('returns 200 with status + baseDir', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.status).toBe('ok')
    expect(body.baseDir).toBe(tmp)
    expect(typeof body.timestamp).toBe('string')
  })
})

describe('GET /api/settings', () => {
  it('returns default settings on a fresh BASE_DIR', async () => {
    const res = await app.request('/api/settings')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.models).toEqual({})
    expect(body.tournament.maxRounds).toBe(10)
    expect(body.tournament.targetF1).toBe(0.9)
    expect(body.concurrency.maxConcurrentRuns).toBe(4)
    expect(body.steering.mode).toBe('one-at-a-time')
  })
})

describe('PUT /api/settings', () => {
  it('overwrites the global settings', async () => {
    const payload = {
      models: { default: { provider: 'openai', model: 'gpt-4o' } },
      tournament: {
        maxRounds: 5,
        targetF1: 0.95,
        convergenceWindow: 2,
        convergenceThreshold: 0.01,
      },
      concurrency: { maxConcurrentRuns: 2 },
      steering: { mode: 'all' },
    }
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.models.default.model).toBe('gpt-4o')
    expect(body.tournament.maxRounds).toBe(5)
    expect(body.steering.mode).toBe('all')
  })
})

describe('PATCH /api/settings', () => {
  it('deep-merges a partial patch into current settings', async () => {
    // Seed with a full settings object first.
    await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        models: { default: { provider: 'openai', model: 'gpt-4o' } },
        tournament: {
          maxRounds: 10,
          targetF1: 0.9,
          convergenceWindow: 3,
          convergenceThreshold: 0.005,
        },
        concurrency: { maxConcurrentRuns: 4 },
        steering: { mode: 'one-at-a-time' },
      }),
    })

    // Patch only the tournament block.
    const res = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tournament: { targetF1: 0.88 } }),
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    // Patched field applied.
    expect(body.tournament.targetF1).toBe(0.88)
    // Untouched nested fields retained.
    expect(body.tournament.maxRounds).toBe(10)
    expect(body.models.default.model).toBe('gpt-4o')
    expect(body.steering.mode).toBe('one-at-a-time')
  })
})

describe('GET / PUT / DELETE /api/settings/models/:role', () => {
  it('PUT sets the model config for a role', async () => {
    const res = await app.request('/api/settings/models/oracle', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4o', thinkingLevel: 'high' }),
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.model).toBe('gpt-4o')
    expect(body.thinkingLevel).toBe('high')
  })

  it('GET returns 404 for an unknown role', async () => {
    const res = await app.request('/api/settings/models/nonexistent')
    expect(res.status).toBe(404)
  })

  it('GET returns the config after PUT', async () => {
    await app.request('/api/settings/models/librarian', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', model: 'claude-3-5-sonnet' }),
    })
    const res = await app.request('/api/settings/models/librarian')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.provider).toBe('anthropic')
    expect(body.model).toBe('claude-3-5-sonnet')
  })

  it('DELETE removes the model config for a role', async () => {
    await app.request('/api/settings/models/explore', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4o-mini' }),
    })
    const del = await app.request('/api/settings/models/explore', { method: 'DELETE' })
    expect(del.status).toBe(200)
    const body = await json(del)
    expect(body.ok).toBe(true)

    const get = await app.request('/api/settings/models/explore')
    expect(get.status).toBe(404)
  })
})

describe('POST /api/projects', () => {
  it('creates a project with a valid name → 201', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'my-proj' }),
    })
    expect(res.status).toBe(201)
    const body = await json(res)
    expect(body.name).toBe('my-proj')
    expect(body.id).toBeTruthy()
  })

  it('rejects an empty name → 400 (schema throw → 500 via onError)', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    // Zod throw is caught by app.onError → 500 (no schema-validation middleware).
    expect(res.status).toBe(500)
  })
})

describe('GET /api/projects', () => {
  it('lists projects that have been created', async () => {
    await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'proj-a' }),
    })
    await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'proj-b' }),
    })

    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    const body = await json(res)
    const names = body.map((p: { name: string }) => p.name)
    expect(names).toContain('proj-a')
    expect(names).toContain('proj-b')
  })

  it('returns empty array when no projects exist', async () => {
    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual([])
  })
})

describe('GET /api/projects/:project', () => {
  it('returns 200 + project row when it exists', async () => {
    await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'exists-proj' }),
    })
    const res = await app.request('/api/projects/exists-proj')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.name).toBe('exists-proj')
  })

  it('returns 404 when the project does not exist', async () => {
    const res = await app.request('/api/projects/no-such-project')
    expect(res.status).toBe(404)
  })
})

describe('POST/GET/DELETE /api/credentials', () => {
  it('POST adds a credential → 201', async () => {
    const res = await app.request('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', type: 'api-key', key: 'sk-test' }),
    })
    expect(res.status).toBe(201)
    const body = await json(res)
    expect(body.provider).toBe('openai')
    expect(body.hasKey).toBe(true)
    expect(body.id).toBeTruthy()
  })

  it('GET lists credentials after add', async () => {
    await app.request('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', type: 'api-key', key: 'sk-a' }),
    })
    const res = await app.request('/api/credentials')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toHaveLength(1)
    expect(body[0].provider).toBe('openai')
  })

  it('DELETE removes a credential → 200', async () => {
    const add = await app.request('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', type: 'api-key', key: 'sk-del' }),
    })
    const added = await json(add)
    const del = await app.request(`/api/credentials/${added.id}`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect(await json(del)).toEqual({ ok: true })

    const list = await app.request('/api/credentials')
    expect(await list.json()).toEqual([])
  })
})

describe('404 + notFound handler', () => {
  it('unknown route → 404 with error body', async () => {
    const res = await app.request('/api/does-not-exist')
    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body.error).toBe('not_found')
  })
})
