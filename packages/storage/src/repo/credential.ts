import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { createLogger } from '@open-scientist/logger'
import type { Credential, CredentialStore } from '@open-scientist/schema'
import { eq } from 'drizzle-orm'
import { getGlobalDb } from '../global-db.ts'
import { credentials } from '../schema/global.ts'

export type { Credential, CredentialStore }

const logger = createLogger('storage')

function getEncryptionKey(): string {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY
  if (!key) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be set before storing or reading credentials')
  }
  return key
}

function deriveKey(): Buffer {
  return scryptSync(getEncryptionKey(), 'open-scientist-salt', 32)
}

export function encrypt(text: string): string {
  const key = deriveKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(encrypted: string): string {
  const key = deriveKey()
  const [ivHex, dataHex] = encrypted.split(':')
  if (!ivHex || !dataHex) throw new Error('Invalid encrypted format')
  const iv = Buffer.from(ivHex, 'hex')
  const data = Buffer.from(dataHex, 'hex')
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

let modifyLock: Promise<unknown> = Promise.resolve()

export async function createCredentialStore(): Promise<CredentialStore> {
  const { db } = await getGlobalDb()

  return {
    async get(id) {
      const rows = db.select().from(credentials).where(eq(credentials.id, id)).all()
      if (rows.length === 0) return null
      const row = rows[0]!
      return {
        id: row.id,
        provider: row.provider,
        type: row.type,
        apiKey: decrypt(row.encryptedKey),
        ...(row.baseURL ? { baseURL: row.baseURL } : {}),
        ...(row.metadataJson
          ? { metadata: JSON.parse(row.metadataJson) as Record<string, unknown> }
          : {}),
      }
    },

    async list() {
      const rows = db.select().from(credentials).all()
      return rows.flatMap((r) => {
        try {
          return [
            {
              id: r.id,
              provider: r.provider,
              type: r.type,
              apiKey: decrypt(r.encryptedKey),
              ...(r.baseURL ? { baseURL: r.baseURL } : {}),
              ...(r.metadataJson
                ? { metadata: JSON.parse(r.metadataJson) as Record<string, unknown> }
                : {}),
            },
          ]
        } catch (error) {
          // A credential encrypted with a retired master key must not break
          // the whole settings page. Keep the row untouched so it can be
          // recovered or replaced explicitly, but omit it from usable entries.
          logger.warn(
            {
              credentialId: r.id,
              error: error instanceof Error ? error.message : String(error),
            },
            'credential list: skipped unreadable entry',
          )
          return []
        }
      })
    },

    async add({ id, provider, type, key, baseURL, metadata }) {
      // 串行 modify 防双刷（借鉴 Pi）
      const resolvedId = id ?? `${provider}-${Date.now()}`
      modifyLock = modifyLock.then(async () => {
        const now = new Date().toISOString()
        // Upsert by id: same id replaces (delete + insert) so the caller can
        // re-PUT a named credential without leaving stale rows.
        db.delete(credentials).where(eq(credentials.id, resolvedId)).run()
        db.insert(credentials)
          .values({
            id: resolvedId,
            provider,
            type,
            encryptedKey: encrypt(key),
            baseURL: baseURL ?? null,
            metadataJson: metadata ? JSON.stringify(metadata) : null,
            createdAt: now,
            updatedAt: now,
          })
          .run()
      })
      await modifyLock
      return resolvedId
    },

    async delete(id) {
      db.delete(credentials).where(eq(credentials.id, id)).run()
    },
  }
}
