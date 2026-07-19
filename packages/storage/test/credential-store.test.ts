import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeGlobalDb, createCredentialStore, getGlobalDb } from '../src/index.js'

/**
 * CredentialStore integration tests.
 *
 * `getGlobalDb()` now caches by db path (derived from BASE_DIR), and `env` is
 * a Proxy that re-reads `process.env.BASE_DIR` on every access, so each test
 * just sets `process.env.BASE_DIR` at a fresh temp dir — no vi.resetModules().
 *
 * Note: the `add` implementation uses an insert (no upsert), so calling `add`
 * twice for the same provider creates **two** rows. `get(provider)` returns the
 * first row by `provider`. These tests pin that observed behaviour rather than
 * a hypothetical "overwrite" semantic.
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
    // Touch the global db so it gets initialized + cached for this BASE_DIR;
    // afterEach closes it via closeGlobalDb().
    await getGlobalDb()
  })

  afterEach(() => {
    closeGlobalDb()
    rmSync(baseDir, { recursive: true, force: true })
    delete process.env.BASE_DIR
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
