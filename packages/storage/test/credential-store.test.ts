import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * CredentialStore integration tests.
 *
 * `getGlobalDb()` is a singleton cached in a module-level variable, and
 * `@open-scientist/config`'s `env` parses `BASE_DIR` once at module load. So
 * each test calls `vi.resetModules()` + dynamic `import()` with a fresh
 * `process.env.BASE_DIR` pointing at a temp dir, guaranteeing isolation.
 *
 * Note: the `add` implementation uses an insert (no upsert), so calling `add`
 * twice for the same provider creates **two** rows. `get(provider)` returns the
 * first row by `provider`. These tests pin that observed behaviour rather than
 * a hypothetical "overwrite" semantic.
 */

interface StorageModule {
  createCredentialStore: () => Promise<{
    get: (provider: string) => Promise<{ key: string; type: string } | null>
    list: () => Promise<
      Array<{
        id: string
        provider: string
        type: string
        encryptedKey: string
        metadata?: Record<string, unknown>
      }>
    >
    add: (
      provider: string,
      type: 'api-key' | 'oauth-token',
      key: string,
      metadata?: Record<string, unknown>,
    ) => Promise<void>
    delete: (id: string) => Promise<void>
  }>
  getGlobalDb: () => Promise<{
    sqlite: { close: () => void }
  }>
}

async function loadStorage(baseDir: string): Promise<StorageModule> {
  vi.resetModules()
  process.env.BASE_DIR = baseDir
  return (await import('../src/index.js')) as unknown as StorageModule
}

function makeBaseDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `os-storage-cred-${label}-`))
}

describe('credential store', () => {
  let baseDir: string
  let storage: StorageModule
  let store: Awaited<ReturnType<StorageModule['createCredentialStore']>>
  let globalSqlite: { close: () => void }

  beforeEach(async () => {
    baseDir = makeBaseDir('store')
    storage = await loadStorage(baseDir)
    store = await storage.createCredentialStore()
    globalSqlite = (await storage.getGlobalDb()).sqlite
  })

  afterEach(() => {
    globalSqlite.close()
    rmSync(baseDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('add → get round-trips the plaintext key', async () => {
    await store.add('openai', 'api-key', 'sk-secret-123')
    const got = await store.get('openai')
    expect(got).not.toBeNull()
    expect(got?.key).toBe('sk-secret-123')
    expect(got?.type).toBe('api-key')
  })

  it('get returns null for an unknown provider', async () => {
    expect(await store.get('ghost-provider')).toBeNull()
  })

  it('list returns all credentials without exposing plaintext keys', async () => {
    await store.add('openai', 'api-key', 'sk-1')
    await store.add('anthropic', 'api-key', 'sk-2', { baseURL: 'https://x.test' })
    const rows = await store.list()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.provider).sort()).toEqual(['anthropic', 'openai'])
    for (const r of rows) {
      // encryptedKey must never equal the plaintext, and must be the iv:hex format.
      expect(r.encryptedKey).not.toBe('sk-1')
      expect(r.encryptedKey).not.toBe('sk-2')
      expect(r.encryptedKey).toMatch(/^[0-9a-f]+:[0-9a-f]+$/)
    }
  })

  it('list round-trips metadata JSON (baseURL etc.)', async () => {
    await store.add('openai', 'api-key', 'sk-1', { baseURL: 'https://gw.test', org: 'acme' })
    const rows = await store.list()
    const row = rows.find((r) => r.provider === 'openai')
    expect(row?.metadata).toEqual({ baseURL: 'https://gw.test', org: 'acme' })
  })

  it('list returns metadata=undefined when none was provided', async () => {
    await store.add('openai', 'api-key', 'sk-1')
    const rows = await store.list()
    const row = rows.find((r) => r.provider === 'openai')
    expect(row?.metadata).toBeUndefined()
  })

  it('get decrypts correctly for oauth-token type', async () => {
    await store.add('github', 'oauth-token', 'gho_tok-xyz')
    const got = await store.get('github')
    expect(got?.key).toBe('gho_tok-xyz')
    expect(got?.type).toBe('oauth-token')
  })

  it('delete removes the credential by id', async () => {
    await store.add('openai', 'api-key', 'sk-1')
    const before = await store.list()
    expect(before).toHaveLength(1)
    await store.delete(before[0]!.id)
    const after = await store.list()
    expect(after).toEqual([])
    expect(await store.get('openai')).toBeNull()
  })

  it('delete on an unknown id is a no-op', async () => {
    await expect(store.delete('does-not-exist')).resolves.toBeUndefined()
  })

  it('concurrent adds serialize through modifyLock without throwing', async () => {
    // Fire 5 concurrent adds for distinct providers; the modifyLock chain
    // serializes them. We assert no rejection and that all 5 land.
    const providers = ['p1', 'p2', 'p3', 'p4', 'p5']
    await Promise.all(providers.map((p, i) => store.add(p, 'api-key', `key-${i}`)))
    const rows = await store.list()
    expect(rows.map((r) => r.provider).sort()).toEqual(providers)
    for (const p of providers) {
      const got = await store.get(p)
      expect(got).not.toBeNull()
    }
  })
})
