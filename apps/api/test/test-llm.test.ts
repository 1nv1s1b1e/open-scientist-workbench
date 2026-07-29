import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeGlobalDb } from '@open-scientist/storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import app from '../src/index.js'
import { setGenerateTextFn } from '../src/routes/test-llm.js'

let tmp: string

// Hono's `app.request` returns a fetch Response; `.json()` is typed `unknown`.
async function json(res: Response): Promise<any> {
  return await res.json()
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'os-api-testllm-'))
  process.env.BASE_DIR = tmp
})

afterEach(() => {
  closeGlobalDb()
  delete process.env.BASE_DIR
  rmSync(tmp, { recursive: true, force: true })
  setGenerateTextFn(vi.fn() as never) // 重置为无操作 stub，下个 test 显式设置
  vi.restoreAllMocks()
})

describe('POST /api/test-llm', () => {
  it('returns ok:true with text/usage/model/durationMs on success', async () => {
    setGenerateTextFn(
      vi.fn(async () => ({
        text: 'hello there',
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        response: { modelId: 'gpt-4o' },
      })) as never,
    )

    const res = await app.request('/api/test-llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
        prompt: 'Say hi',
        maxTokens: 10,
      }),
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.ok).toBe(true)
    expect(body.text).toBe('hello there')
    expect(body.usage.promptTokens).toBe(5)
    expect(body.usage.completionTokens).toBe(3)
    expect(body.model).toBe('gpt-4o')
    expect(typeof body.durationMs).toBe('number')
  })

  it('returns 500 with internal_error when generateText throws', async () => {
    setGenerateTextFn(
      vi.fn(async () => {
        throw new Error('connection refused')
      }) as never,
    )

    const res = await app.request('/api/test-llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      }),
    })
    // LLM call errors return 500 internal_error (matches the rest of the API).
    expect(res.status).toBe(500)
    const body = await json(res)
    expect(body.error).toBe('internal_error')
    expect(body.message).toContain('connection refused')
  })

  it('rejects a request missing apiKey → schema throw → 400', async () => {
    // No generateText stub needed — the route should throw before reaching it.
    const res = await app.request('/api/test-llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        model: 'gpt-4o',
        // apiKey intentionally omitted
      }),
    })
    // TestLlmRequestSchema.parse throws → app.onError → 400 bad_request.
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toBe('bad_request')
  })

  it('rejects an invalid provider enum → schema throw → 400', async () => {
    const res = await app.request('/api/test-llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'gemini',
        model: 'gemini-pro',
        apiKey: 'x',
      }),
    })
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toBe('bad_request')
  })
})
