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
  metadata?: Record<string, unknown>
}): CredentialResponse {
  return {
    id: rec.id,
    provider: rec.provider,
    type: rec.type,
    hasKey: true,
    ...(rec.metadata ? { metadata: rec.metadata } : {}),
  }
}

credentials.get('/api/credentials', async (c) => {
  const store = await createCredentialStore()
  const list = await store.list()
  return c.json(list.map(toResponse))
})

credentials.post('/api/credentials', async (c) => {
  const body = await c.req.json()
  const req = AddCredentialRequestSchema.parse(body) as AddCredentialRequest
  const store = await createCredentialStore()

  const existing = await store.list()
  for (const rec of existing) {
    if (rec.provider === req.provider) {
      await store.delete(rec.id)
    }
  }

  // metadata 直接透传。credential 不再特指 baseURL（baseURL 唯一来源是 settings）。
  // 现有 DB 记录里的 metadata.baseURL 兼容读取但不依赖。
  await store.add(req.provider, req.type, req.key, req.metadata)

  const updated = await store.list()
  const added = updated.find((r) => r.provider === req.provider)
  if (!added) {
    return c.json({ error: 'internal_error', message: 'credential add failed' }, 500)
  }
  return c.json(
    toResponse({
      id: added.id,
      provider: added.provider,
      type: added.type,
      metadata: added.metadata,
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
