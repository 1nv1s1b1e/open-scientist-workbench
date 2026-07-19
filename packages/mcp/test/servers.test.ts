import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFitsServer, createHelixServer, createSandboxServer } from '../src/index.ts'

// ------------------------------------------------------------
// Helpers：用 in-memory transport 连 client ↔ server，避免 stdio
// ------------------------------------------------------------

async function connect(server: Server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} })
  await client.connect(clientTransport)
  return client
}

async function listToolNames(client: Client): Promise<string[]> {
  const res = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
  return (res.tools ?? []).map((t) => t.name)
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  return client.request(
    { method: 'tools/call', params: { name, arguments: args } },
    CallToolResultSchema,
  )
}

// ------------------------------------------------------------
// helix-server：mock helix 模块，验证 wiring 不触发真实 HelixDB
// ------------------------------------------------------------

vi.mock('@open-scientist/helix', () => ({
  addCritique: vi.fn().mockResolvedValue(undefined),
  addEvidence: vi.fn().mockResolvedValue(undefined),
  addHypothesis: vi.fn().mockResolvedValue(undefined),
  addMutationLink: vi.fn().mockResolvedValue(undefined),
  addSnapshot: vi.fn().mockResolvedValue(undefined),
  getCritiquesByHypothesis: vi.fn().mockResolvedValue([{ id: 'c1' }]),
  getEvolutionChain: vi.fn().mockResolvedValue([{ id: 'h1' }]),
  getEvidenceByHypothesis: vi.fn().mockResolvedValue([{ id: 'e1' }]),
  getHypothesis: vi.fn().mockResolvedValue({ id: '42', statement: 'coronal heating' }),
  getLeaderboard: vi.fn().mockResolvedValue([{ id: 'h1' }]),
  getRelatedConcepts: vi.fn().mockResolvedValue([{ id: 'k1' }]),
  searchHypotheses: vi.fn().mockResolvedValue([{ id: 'h1' }]),
  searchPapers: vi.fn().mockResolvedValue([{ id: 'p1', title: 'nano-flares' }]),
}))

describe('helix-mcp server', () => {
  it('exposes 13 tools', async () => {
    const server = createHelixServer()
    const client = await connect(server)
    const names = await listToolNames(client)
    expect(names).toEqual([
      'search_papers',
      'search_hypotheses',
      'get_hypothesis',
      'get_evidence_by_hypothesis',
      'get_critiques_by_hypothesis',
      'get_related_concepts',
      'get_leaderboard',
      'get_evolution_chain',
      'add_hypothesis',
      'add_evidence',
      'add_critique',
      'add_mutation_link',
      'add_snapshot',
    ])
    await client.close()
  })

  it('search_papers returns JSON text content', async () => {
    const server = createHelixServer()
    const client = await connect(server)
    const res = await callTool(client, 'search_papers', { query: 'coronal heating' })
    expect(res.isError).toBeFalsy()
    expect(res.content).toHaveLength(1)
    expect(res.content?.[0]?.type).toBe('text')
    const parsed = JSON.parse(res.content?.[0]?.text ?? '{}')
    expect(parsed).toEqual([{ id: 'p1', title: 'nano-flares' }])
    await client.close()
  })

  it('add_evidence validates type enum', async () => {
    const server = createHelixServer()
    const client = await connect(server)
    const res = await callTool(client, 'add_evidence', {
      hypoId: 'h1',
      type: 'bogus',
      content: 'x',
      f1Score: 0.5,
      fitsPaths: [],
      createdAt: '2026-01-01T00:00:00Z',
    })
    expect(res.isError).toBe(true)
    expect(res.content?.[0]?.text).toContain('must be one of')
    await client.close()
  })
})

// ------------------------------------------------------------
// fits-server
// ------------------------------------------------------------

describe('fits-mcp server', () => {
  it('exposes 3 tools', async () => {
    const server = createFitsServer()
    const client = await connect(server)
    const names = await listToolNames(client)
    expect(names).toEqual(['align_fits', 'list_fits_files', 'read_fits_header'])
    await client.close()
  })

  it('align_fits returns astropy install stub', async () => {
    const server = createFitsServer()
    const client = await connect(server)
    const res = await callTool(client, 'align_fits', {
      hypoId: 'h1',
      activeRegion: 'AR13664',
      timestamp: '2024-05-14T00:00:00Z',
      wavelength: '171A',
    })
    expect(res.isError).toBeFalsy()
    const parsed = JSON.parse(res.content?.[0]?.text ?? '{}')
    expect(parsed.stub).toBe(true)
    expect(parsed.message).toContain('astropy')
    await client.close()
  })
})

// ------------------------------------------------------------
// sandbox-server
// ------------------------------------------------------------

describe('sandbox-mcp server', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes 4 tools', async () => {
    const server = createSandboxServer()
    const client = await connect(server)
    const names = await listToolNames(client)
    expect(names).toEqual(['bash', 'read_file', 'write_file', 'list_dir'])
    await client.close()
  })

  it('bash runs echo and returns stdout', async () => {
    const server = createSandboxServer()
    const client = await connect(server)
    const res = await callTool(client, 'bash', { command: 'echo hello-mcp' })
    expect(res.isError).toBeFalsy()
    const parsed = JSON.parse(res.content?.[0]?.text ?? '{}')
    expect(parsed.exitCode).toBe(0)
    expect(parsed.stdout.trim()).toBe('hello-mcp')
    await client.close()
  })

  it('write_file + read_file round-trip', async () => {
    const server = createSandboxServer()
    const client = await connect(server)
    const path = `/tmp/mcp-test-${Date.now()}.txt`
    const writeRes = await callTool(client, 'write_file', { path, content: 'hi' })
    expect(writeRes.isError).toBeFalsy()
    const readRes = await callTool(client, 'read_file', { path })
    expect(readRes.isError).toBeFalsy()
    const parsed = JSON.parse(readRes.content?.[0]?.text ?? '{}')
    expect(parsed.content).toBe('hi')
    await client.close()
  })
})
