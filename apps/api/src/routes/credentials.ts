import {
  type AddCredentialRequest,
  AddCredentialRequestSchema,
  type CredentialResponse,
} from '@open-scientist/schema'
import { createCredentialStore } from '@open-scientist/storage'
import { Hono } from 'hono'

export const credentials = new Hono()

function toResponse(rec: {
  id: string
  provider: string
  type: 'api-key' | 'oauth-token'
  baseURL?: string
  metadata?: Record<string, unknown>
}): CredentialResponse {
  return {
    id: rec.id,
    provider: rec.provider,
    type: rec.type,
    hasKey: true,
    ...(rec.baseURL ? { baseURL: rec.baseURL } : {}),
    ...(rec.metadata ? { metadata: rec.metadata } : {}),
  }
}

credentials.get('/api/credentials', async (c) => {
  const store = await createCredentialStore()
  const list = await store.list()
  return c.json(list.map(toResponse))
})

// Endpoint-bundle 形态：一个 credential = {id, provider, apiKey, baseURL?}。
// id 可用户指定（如 "qwen-gateway"），不传则 auto `${provider}-${ts}`。
// 同 provider 不同 url+key = 不同 credential 行（不再按 provider 去重）。
// 相同 id = upsert（delete + insert）。
credentials.post('/api/credentials', async (c) => {
  const body = await c.req.json()
  const req = AddCredentialRequestSchema.parse(body) as AddCredentialRequest
  const store = await createCredentialStore()

  const id = await store.add({
    ...(req.id ? { id: req.id } : {}),
    provider: req.provider,
    type: req.type,
    key: req.key,
    ...(req.baseURL ? { baseURL: req.baseURL } : {}),
    ...(req.metadata ? { metadata: req.metadata } : {}),
  })

  const added = await store.get(id)
  if (!added) {
    return c.json({ error: 'internal_error', message: 'credential add failed' }, 500)
  }
  return c.json(
    toResponse({
      id: added.id,
      provider: added.provider,
      type: added.type,
      ...(added.baseURL ? { baseURL: added.baseURL } : {}),
      ...(added.metadata ? { metadata: added.metadata } : {}),
    }),
    201,
  )
})

credentials.delete('/api/credentials/:id', async (c) => {
  const id = c.req.param('id')
  const store = await createCredentialStore()
  await store.delete(id)
  return c.json({ ok: true })
})
