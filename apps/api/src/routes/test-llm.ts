import { createModelFromConfig } from '@open-scientist/config'
import {
  type TestLlmRequest,
  TestLlmRequestSchema,
  type TestLlmResponse,
} from '@open-scientist/schema'
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
    const durationMs = Date.now() - start
    const message = err instanceof Error ? err.message : String(err)
    const response: TestLlmResponse = {
      ok: false,
      error: message,
      durationMs,
    }
    return c.json(response)
  }
})
