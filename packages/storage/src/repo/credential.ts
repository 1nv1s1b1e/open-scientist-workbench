import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getGlobalDb } from '../global-db.js'
import { credentials } from '../schema/global.js'

export interface CredentialRecord {
  id: string
  provider: string
  type: 'api-key' | 'oauth-token'
  encryptedKey: string
  metadata?: Record<string, unknown>
}

export interface CredentialStore {
  get(provider: string): Promise<{ key: string; type: string } | null>
  list(): Promise<CredentialRecord[]>
  add(
    provider: string,
    type: 'api-key' | 'oauth-token',
    key: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>
  delete(id: string): Promise<void>
}

const ENCRYPTION_KEY =
  process.env.CREDENTIAL_ENCRYPTION_KEY ?? 'open-scientist-default-key-change-me'

function deriveKey(): Buffer {
  return scryptSync(ENCRYPTION_KEY, 'open-scientist-salt', 32)
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
    async get(provider) {
      const rows = db.select().from(credentials).where(eq(credentials.provider, provider)).all()
      if (rows.length === 0) return null
      const row = rows[0]!
      return { key: decrypt(row.encryptedKey), type: row.type }
    },

    async list() {
      const rows = db.select().from(credentials).all()
      return rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        type: r.type,
        encryptedKey: r.encryptedKey,
        metadata: r.metadataJson
          ? (JSON.parse(r.metadataJson) as Record<string, unknown>)
          : undefined,
      }))
    },

    async add(provider, type, key, metadata) {
      // 串行 modify 防双刷（借鉴 Pi）
      modifyLock = modifyLock.then(async () => {
        const id = `${provider}-${Date.now()}`
        const now = new Date().toISOString()
        db.insert(credentials)
          .values({
            id,
            provider,
            type,
            encryptedKey: encrypt(key),
            metadataJson: metadata ? JSON.stringify(metadata) : null,
            createdAt: now,
            updatedAt: now,
          })
          .run()
      })
      await modifyLock
    },

    async delete(id) {
      db.delete(credentials).where(eq(credentials.id, id)).run()
    },
  }
}
