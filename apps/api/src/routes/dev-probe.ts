// Temporary probe route to verify tournamentWorkflow stream flattening.
// Kept for ongoing observation after P0 runs route lands; not registered by
// default (see routes/index.ts).

import { createModelCallToUIChunkTransform } from '@ai-sdk/workflow'
import { tournamentWorkflow } from '@open-scientist/agents'
import type { ModelArg } from '@open-scientist/config'
import { createCredentialStore } from '@open-scientist/storage'
import { createUIMessageStreamResponse } from 'ai'
import { Hono } from 'hono'
import { start } from 'workflow/api'

export const devProbe = new Hono()

devProbe.post('/api/dev-probe/stream-test', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const seed =
    body.seed ?? 'Magnetic reconnection in nanoflares heats the corona via Alfvén wave dissipation'

  const store = await createCredentialStore()
  const cred = await store.get('openai')
  if (!cred) return c.json({ error: 'no openai credential' }, 500)

  const modelConfig: ModelArg = {
    provider: 'openai',
    model: 'llab/Qwen3-Next-80B-A3B-Instruct',
    baseURL: 'http://<internal-llm-host>:8084/v1',
    apiKey: cred.key,
    thinkingLevel: 'medium',
  }

  const runId = `probe-${Date.now()}`
  const run = await start(tournamentWorkflow, [
    {
      seed,
      projectId: 'probe-project',
      runId,
      modelConfig,
    },
  ])

  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { 'x-workflow-run-id': run.runId },
  })
})
