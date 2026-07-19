import { describe, expect, it } from 'vitest'
import { decrypt, encrypt } from '../src/repo/credential.js'

describe('credential crypto (encrypt/decrypt)', () => {
  it('round-trips a plaintext string', () => {
    const plaintext = 'sk-openai-abc-123-very-secret'
    const ciphertext = encrypt(plaintext)
    expect(decrypt(ciphertext)).toBe(plaintext)
  })

  it('round-trips an empty string', () => {
    expect(decrypt(encrypt(''))).toBe('')
  })

  it('round-trips unicode + long payloads', () => {
    const plaintext = '日冕加热之谜 corona ☀️ 🔥'.repeat(50)
    expect(decrypt(encrypt(plaintext))).toBe(plaintext)
  })

  it('produces different ciphertexts for different plaintexts', () => {
    const a = encrypt('key-one')
    const b = encrypt('key-two')
    expect(a).not.toBe(b)
  })

  it('produces a different ciphertext each call even for identical plaintext (random IV)', () => {
    const a = encrypt('same-secret')
    const b = encrypt('same-secret')
    expect(a).not.toBe(b)
    // both still decrypt to the same plaintext
    expect(decrypt(a)).toBe('same-secret')
    expect(decrypt(b)).toBe('same-secret')
  })

  it('emits the iv:ciphertext hex format', () => {
    const ciphertext = encrypt('x')
    expect(ciphertext).toMatch(/^[0-9a-f]+:[0-9a-f]+$/)
    const [ivHex, dataHex] = ciphertext.split(':')
    // AES-256-CBC uses a 16-byte IV → 32 hex chars.
    expect(ivHex).toHaveLength(32)
    expect(dataHex!.length).toBeGreaterThan(0)
  })

  it('throws on decrypt when the format has no colon separator', () => {
    expect(() => decrypt('not-a-valid-format')).toThrow(/Invalid encrypted format/)
  })

  it('throws on decrypt when the IV half is missing', () => {
    expect(() => decrypt(':deadbeef')).toThrow(/Invalid encrypted format/)
  })

  it('throws on decrypt when the data half is missing', () => {
    expect(() => decrypt('deadbeef:')).toThrow(/Invalid encrypted format/)
  })

  it('throws on decrypt when hex segments are not valid hex', () => {
    expect(() => decrypt('zzzz:deadbeef')).toThrow()
  })
})
