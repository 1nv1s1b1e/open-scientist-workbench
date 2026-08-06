import { createModelFromConfig } from '@open-scientist/config'
import {
  type TestLlmByCredentialRequest,
  TestLlmByCredentialRequestSchema,
  type TestLlmRequest,
  TestLlmRequestSchema,
  type TestLlmResponse,
} from '@open-scientist/schema'
import { createCredentialStore } from '@open-scientist/storage'
import { generateText } from 'ai'
import { Hono } from 'hono'

export const testLlm = new Hono()

// 依赖注入点：测试可替换 generateText 实现，避免 vi.doMock + resetModules。
// 生产环境使用从 'ai' 导入的真实 generateText。
let generateTextFn: typeof generateText = generateText
export function setGenerateTextFn(fn: typeof generateText): void {
  generateTextFn = fn
}

testLlm.post('/api/test-llm', async (c) => {
  const body = await c.req.json()
  const req = TestLlmRequestSchema.parse(body) as TestLlmRequest
  const start = Date.now()

  try {
    const model = createModelFromConfig({
      provider: req.provider,
      model: req.model,
      ...(req.baseURL ? { baseURL: req.baseURL } : {}),
      thinkingLevel: 'off',
      apiMode: 'chat',
      apiKey: req.apiKey,
    })
    const result = await generateTextFn({
      model,
      prompt: req.prompt,
      maxOutputTokens: req.maxTokens,
    })
    const durationMs = Date.now() - start
    const usage = result.usage
    const response: TestLlmResponse = {
      ok: true,
      text: result.text,
      usage: {
        promptTokens: usage.inputTokens ?? undefined,
        completionTokens: usage.outputTokens ?? undefined,
        totalTokens: usage.totalTokens ?? undefined,
      },
      model: result.response.modelId,
      durationMs,
    }
    return c.json(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: 'internal_error', message }, 500)
  }
})

// 用已存凭证测试：路径参数 :id = credential id，
// body 只需 { model, prompt?, maxTokens? }。
// apiKey/provider/baseURL 全从存储取，前端无需传 key。
testLlm.post('/api/test-llm/credential/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const req = TestLlmByCredentialRequestSchema.parse(body) as TestLlmByCredentialRequest
  const start = Date.now()

  try {
    const store = await createCredentialStore()
    const cred = await store.get(id)
    if (!cred) {
      return c.json({ error: 'not_found', message: `credential '${id}' not found` }, 404)
    }

    const model = createModelFromConfig({
      provider: cred.provider,
      model: req.model,
      ...(cred.baseURL ? { baseURL: cred.baseURL } : {}),
      thinkingLevel: 'off',
      apiMode: 'chat',
      apiKey: cred.apiKey,
    })
    const result = await generateTextFn({
      model,
      prompt: req.prompt,
      maxOutputTokens: req.maxTokens,
    })
    const durationMs = Date.now() - start
    const usage = result.usage
    const response: TestLlmResponse = {
      ok: true,
      text: result.text,
      usage: {
        promptTokens: usage.inputTokens ?? undefined,
        completionTokens: usage.outputTokens ?? undefined,
        totalTokens: usage.totalTokens ?? undefined,
      },
      model: result.response.modelId,
      durationMs,
    }
    return c.json(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: 'internal_error', message }, 500)
  }
})
