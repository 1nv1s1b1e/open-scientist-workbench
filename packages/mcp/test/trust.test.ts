import type { ToolSet } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

/**
 * Mock the storage layer (getTrust/setTrust) and the `ai` SDK drift helpers
 * (fingerprintTools/detectToolDrift) so checkMcpTrust is exercised in
 * isolation. The spy instances live in vi.hoisted so they exist when the
 * (hoisted) vi.mock factories run.
 */
const spies = vi.hoisted(() => ({
  detectToolDrift: vi.fn(),
  fingerprintTools: vi.fn(),
  getTrust: vi.fn(),
  setTrust: vi.fn(),
}))

vi.mock('@open-scientist/storage', () => ({
  getTrust: (...args: unknown[]) => spies.getTrust(...args),
  setTrust: (...args: unknown[]) => spies.setTrust(...args),
}))

vi.mock('ai', () => ({
  detectToolDrift: (...args: unknown[]) => spies.detectToolDrift(...args),
  fingerprintTools: (...args: unknown[]) => spies.fingerprintTools(...args),
}))

// Static import — vi.mock is hoisted above this, so trust.js picks up the mocks.
import { checkMcpTrust, trustServer } from '../src/trust.ts'

const { getTrust, setTrust, fingerprintTools, detectToolDrift } = spies

const PROJECT = 'trust-test-proj'
const SERVER = 'helix-mcp'
const FINGERPRINT = '{"toolA":"hash-a"}'

function makeTools(): ToolSet {
  return {
    toolA: { description: 'a', inputSchema: { _type: 'object' } },
    toolB: { description: 'b', inputSchema: { _type: 'object' } },
  } as unknown as ToolSet
}

describe('checkMcpTrust', () => {
  beforeEach(() => {
    getTrust.mockReset()
    setTrust.mockReset()
    fingerprintTools.mockReset()
    detectToolDrift.mockReset()
  })

  it('first connect (getTrust → null): trusted=false, drifted=true, added=all tool names', async () => {
    getTrust.mockResolvedValue(null)
    setTrust.mockResolvedValue(undefined)

    const result = await checkMcpTrust(PROJECT, SERVER, FINGERPRINT, makeTools())

    expect(result).toEqual({
      trusted: false,
      drifted: true,
      added: ['toolA', 'toolB'],
      removed: [],
      changed: [],
    })
    expect(setTrust).toHaveBeenCalledWith(PROJECT, SERVER, FINGERPRINT, false)
    expect(fingerprintTools).not.toHaveBeenCalled()
    expect(detectToolDrift).not.toHaveBeenCalled()
  })

  it('untrusted existing (getTrust → {trusted:false}): trusted=false, drifted=false', async () => {
    getTrust.mockResolvedValue({
      projectName: PROJECT,
      serverName: SERVER,
      fingerprint: FINGERPRINT,
      trusted: false,
    })

    const result = await checkMcpTrust(PROJECT, SERVER, FINGERPRINT, makeTools())

    expect(result).toEqual({ trusted: false, drifted: false, added: [], removed: [], changed: [] })
    expect(setTrust).not.toHaveBeenCalled()
    expect(fingerprintTools).not.toHaveBeenCalled()
    expect(detectToolDrift).not.toHaveBeenCalled()
  })

  it('trusted + no drift: trusted=true, drifted=false', async () => {
    getTrust.mockResolvedValue({
      projectName: PROJECT,
      serverName: SERVER,
      fingerprint: FINGERPRINT,
      trusted: true,
    })
    fingerprintTools.mockResolvedValue({ toolA: 'hash-a', toolB: 'hash-b' })
    detectToolDrift.mockReturnValue({ added: [], removed: [], changed: [] })

    const result = await checkMcpTrust(PROJECT, SERVER, FINGERPRINT, makeTools())

    expect(result.trusted).toBe(true)
    expect(result.drifted).toBe(false)
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.changed).toEqual([])
    expect(fingerprintTools).toHaveBeenCalledTimes(1)
    expect(detectToolDrift).toHaveBeenCalledWith(
      { toolA: 'hash-a', toolB: 'hash-b' },
      JSON.parse(FINGERPRINT),
    )
  })

  it('trusted + added tools: drifted=true, trusted=false, added populated', async () => {
    getTrust.mockResolvedValue({
      projectName: PROJECT,
      serverName: SERVER,
      fingerprint: FINGERPRINT,
      trusted: true,
    })
    fingerprintTools.mockResolvedValue({ toolA: 'hash-a', toolB: 'hash-b', toolC: 'hash-c' })
    detectToolDrift.mockReturnValue({ added: ['toolC'], removed: [], changed: [] })

    const result = await checkMcpTrust(PROJECT, SERVER, FINGERPRINT, makeTools())

    expect(result.trusted).toBe(false)
    expect(result.drifted).toBe(true)
    expect(result.added).toEqual(['toolC'])
    expect(result.removed).toEqual([])
    expect(result.changed).toEqual([])
  })

  it('trusted + removed tools: drifted=true, removed populated', async () => {
    getTrust.mockResolvedValue({
      projectName: PROJECT,
      serverName: SERVER,
      fingerprint: FINGERPRINT,
      trusted: true,
    })
    fingerprintTools.mockResolvedValue({ toolA: 'hash-a' })
    detectToolDrift.mockReturnValue({ added: [], removed: ['toolB'], changed: [] })

    const result = await checkMcpTrust(PROJECT, SERVER, FINGERPRINT, makeTools())

    expect(result.drifted).toBe(true)
    expect(result.trusted).toBe(false)
    expect(result.removed).toEqual(['toolB'])
  })

  it('trusted + changed tools: drifted=true, changed populated', async () => {
    getTrust.mockResolvedValue({
      projectName: PROJECT,
      serverName: SERVER,
      fingerprint: FINGERPRINT,
      trusted: true,
    })
    fingerprintTools.mockResolvedValue({ toolA: 'hash-a-changed', toolB: 'hash-b' })
    detectToolDrift.mockReturnValue({ added: [], removed: [], changed: ['toolA'] })

    const result = await checkMcpTrust(PROJECT, SERVER, FINGERPRINT, makeTools())

    expect(result.drifted).toBe(true)
    expect(result.trusted).toBe(false)
    expect(result.changed).toEqual(['toolA'])
  })

  it('trustServer marks the server trusted via setTrust', async () => {
    setTrust.mockResolvedValue(undefined)

    await trustServer(PROJECT, SERVER, FINGERPRINT)

    expect(setTrust).toHaveBeenCalledWith(PROJECT, SERVER, FINGERPRINT, true)
  })

  it('drifted flag is true when ANY of added/removed/changed is non-empty', async () => {
    getTrust.mockResolvedValue({
      projectName: PROJECT,
      serverName: SERVER,
      fingerprint: FINGERPRINT,
      trusted: true,
    })
    fingerprintTools.mockResolvedValue({ toolA: 'hash-a', toolB: 'hash-b' })
    // All three drift dimensions populated.
    detectToolDrift.mockReturnValue({ added: ['x'], removed: ['y'], changed: ['z'] })

    const result = await checkMcpTrust(PROJECT, SERVER, FINGERPRINT, makeTools())

    expect(result.drifted).toBe(true)
    expect(result.trusted).toBe(false)
    expect(result.added).toEqual(['x'])
    expect(result.removed).toEqual(['y'])
    expect(result.changed).toEqual(['z'])
  })
})
