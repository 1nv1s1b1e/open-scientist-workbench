import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { closeGlobalDb, createCredentialStore, getGlobalDb } from '../src/index.ts'

/**
 * CredentialStore integration tests.
 *
 * `getGlobalDb()` caches by db path (derived from BASE_DIR), and `env` is
 * a Proxy that re-reads `process.env.BASE_DIR` on every access, so each test
 * just sets `process.env.BASE_DIR` at a fresh temp dir — no vi.resetModules().
 *
 * Credential model: each record is a named endpoint bundle
 * {id, provider, apiKey, baseURL?}. Id is user-supplied (or auto-generated
 * `${provider}-${ts}`). Same-provider + different-url/different-key combos are
 * distinct records with distinct ids. `add` upserts by id.
 */

function makeBaseDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `os-storage-cred-${label}-`))
}

describe('credential store', () => {
  let baseDir: string
  let store: Awaited<ReturnType<typeof createCredentialStore>>

  beforeEach(async () => {
    baseDir = makeBaseDir('store')
    process.env.BASE_DIR = baseDir
    store = await createCredentialStore()
    await getGlobalDb()
  })

  afterEach(() => {
    closeGlobalDb()
    rmSync(baseDir, { recursive: true, force: true })
    delete process.env.BASE_DIR
  })

  it('add → get round-trips the plaintext key + baseURL', async () => {
    const id = await store.add({
      id: 'openai-prod',
      provider: 'openai',
      type: 'api-key',
      key: 'sk-secret-123',
      baseURL: 'https://api.openai.com/v1',
    })
    expect(id).toBe('openai-prod')
    const got = await store.get('openai-prod')
    expect(got).not.toBeNull()
    expect(got?.apiKey).toBe('sk-secret-123')
    expect(got?.type).toBe('api-key')
    expect(got?.baseURL).toBe('https://api.openai.com/v1')
    expect(got?.provider).toBe('openai')
  })

  it('get returns null for an unknown id', async () => {
    expect(await store.get('ghost-id')).toBeNull()
  })

  it('list returns all credentials with decrypted keys', async () => {
    await store.add({
      id: 'openai-prod',
      provider: 'openai',
      type: 'api-key',
      key: 'sk-1',
      baseURL: 'https://a.test/v1',
    })
    await store.add({
      id: 'qwen-gw',
      provider: 'openai',
      type: 'api-key',
      key: 'sk-2',
      baseURL: 'https://b.test/v1',
    })
    const rows = await store.list()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.id).sort()).toEqual(['openai-prod', 'qwen-gw'])
    for (const r of rows) {
      // list() now returns decrypted credentials (same shape as get()).
      // No encryptedKey field — encryption is a storage-internal detail.
      expect(r.apiKey).toMatch(/^sk-[12]$/)
      expect((r as unknown as Record<string, unknown>).encryptedKey).toBeUndefined()
    }
  })

  it('allows two credentials with the same provider but different baseURL', async () => {
    await store.add({
      id: 'gw-a',
      provider: 'openai',
      type: 'api-key',
      key: 'sk-a',
      baseURL: 'https://a.test/v1',
    })
    await store.add({
      id: 'gw-b',
      provider: 'openai',
      type: 'api-key',
      key: 'sk-b',
      baseURL: 'https://b.test/v1',
    })
    const rows = await store.list()
    expect(rows).toHaveLength(2)
    expect(rows.filter((r) => r.provider === 'openai')).toHaveLength(2)
  })

  it('list round-trips metadata JSON', async () => {
    await store.add({
      id: 'openai-prod',
      provider: 'openai',
      type: 'api-key',
      key: 'sk-1',
      metadata: { org: 'acme' },
    })
    const rows = await store.list()
    const row = rows.find((r) => r.id === 'openai-prod')
    expect(row?.metadata).toEqual({ org: 'acme' })
  })

  it('list returns metadata=undefined and baseURL=undefined when none were provided', async () => {
    await store.add({
      id: 'bare',
      provider: 'openai',
      type: 'api-key',
      key: 'sk-1',
    })
    const rows = await store.list()
    const row = rows.find((r) => r.id === 'bare')
    expect(row?.metadata).toBeUndefined()
    expect(row?.baseURL).toBeUndefined()
  })

  it('get decrypts correctly for oauth-token type', async () => {
    await store.add({
      id: 'github',
      provider: 'anthropic',
      type: 'oauth-token',
      key: 'gho_tok-xyz',
    })
    const got = await store.get('github')
    expect(got?.apiKey).toBe('gho_tok-xyz')
    expect(got?.type).toBe('oauth-token')
  })

  it('delete removes the credential by id', async () => {
    await store.add({
      id: 'openai-prod',
      provider: 'openai',
      type: 'api-key',
      key: 'sk-1',
    })
    const before = await store.list()
    expect(before).toHaveLength(1)
    await store.delete('openai-prod')
    const after = await store.list()
    expect(after).toEqual([])
    expect(await store.get('openai-prod')).toBeNull()
  })

  it('delete on an unknown id is a no-op', async () => {
    await expect(store.delete('does-not-exist')).resolves.toBeUndefined()
  })

  it('add upserts by id (re-PUT replaces)', async () => {
    await store.add({
      id: 'openai-prod',
      provider: 'openai',
      type: 'api-key',
      key: 'sk-old',
      baseURL: 'https://old.test/v1',
    })
    await store.add({
      id: 'openai-prod',
      provider: 'openai',
      type: 'api-key',
      key: 'sk-new',
      baseURL: 'https://new.test/v1',
    })
    const rows = await store.list()
    expect(rows).toHaveLength(1)
    const got = await store.get('openai-prod')
    expect(got?.apiKey).toBe('sk-new')
    expect(got?.baseURL).toBe('https://new.test/v1')
  })

  it('auto-generates id when not supplied', async () => {
    const id = await store.add({
      provider: 'openai',
      type: 'api-key',
      key: 'sk-1',
    })
    expect(id).toMatch(/^openai-\d+$/)
    const got = await store.get(id)
    expect(got?.apiKey).toBe('sk-1')
  })

  it('concurrent adds serialize through modifyLock without throwing', async () => {
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5']
    await Promise.all(
      ids.map((id, i) => store.add({ id, provider: 'openai', type: 'api-key', key: `key-${i}` })),
    )
    const rows = await store.list()
    expect(rows.map((r) => r.id).sort()).toEqual(ids)
    for (const id of ids) {
      const got = await store.get(id)
      expect(got).not.toBeNull()
    }
  })
})
