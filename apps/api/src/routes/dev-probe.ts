// Temporary probe route to verify tournamentWorkflow stream flattening.
// Kept for ongoing observation after P0 runs route lands; not registered by
// default (see routes/index.ts).

import type { ModelArg } from '@open-scientist/config'
import { createCredentialStore } from '@open-scientist/storage'
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai'
import { Hono } from 'hono'

import { start as startRun } from '../lib/run-stream'

export const devProbe = new Hono()

// dev-probe 假设 DB 里已有一条 provider=openai 的 credential（带 baseURL）。
// 它从 credential 读 provider+apiKey+baseURL，model 名硬编码（便于快速验证）。
devProbe.post('/api/dev-probe/stream-test', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const seed =
    body.seed ?? 'Magnetic reconnection in nanoflares heats the corona via Alfvén wave dissipation'

  const store = await createCredentialStore()
  const list = await store.list()
  const cred = list.find((r) => r.provider === 'openai')
  if (!cred) return c.json({ error: 'no openai credential in store' }, 500)
  const full = await store.get(cred.id)
  if (!full) return c.json({ error: 'credential vanished' }, 500)

  const modelConfig: ModelArg = {
    provider: 'openai',
    model: 'llab/Qwen3-Next-80B-A3B-Instruct',
    ...(full.baseURL ? { baseURL: full.baseURL } : {}),
    apiKey: full.apiKey,
    thinkingLevel: 'medium',
  }

  const runId = `probe-${Date.now()}`
  const run = startRun({
    seed,
    projectId: 'probe-project',
    runId,
    modelConfig,
  })

  return createUIMessageStreamResponse({
    stream: run.getReadable({ startIndex: 0 }).pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform(chunk, controller) {
          controller.enqueue(chunk)
        },
      }),
    ),
    headers: { 'x-workflow-run-id': run.runId },
  })
})
