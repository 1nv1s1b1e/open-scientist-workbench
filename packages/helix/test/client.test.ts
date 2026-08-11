import { afterEach, describe, expect, it } from 'vite-plus/test'
import type { Client } from '@helix-db/helix-db'
import {
  addEvidence,
  addHypothesis,
  addPaper,
  getEvidenceByHypothesis,
  getHypothesis,
  getPaper,
  safeBigInt,
  searchPapers,
  setHelixClient,
  unwrap,
  type ReadContainer,
} from '../src/client.ts'

interface FakeResult {
  [key: string]: unknown
}

interface FakeClient extends Client {
  __calls: unknown[][]
  __results: FakeResult | FakeResult[]
}

function createFakeClient(results: FakeResult | FakeResult[]): FakeClient {
  const calls: unknown[][] = []
  const getNext = (() => {
    const arr = Array.isArray(results) ? results : [results]
    let i = 0
    return () => arr[Math.min(i++, arr.length - 1)]!
  })()
  const fake = {
    __calls: calls,
    __results: results,
    query: () => ({
      dynamic: (req: unknown) => {
        calls.push([req])
        return {
          send: async () => getNext(),
        }
      },
    }),
  }
  return fake as unknown as FakeClient
}

interface DynamicReq {
  queryName: string | null
}

function createCapturingClient(): { client: Client; getCaptured: () => DynamicReq | null } {
  let captured: DynamicReq | null = null
  const client = {
    query: () => ({
      dynamic: (req: DynamicReq) => {
        captured = req
        return { send: async () => ({}) }
      },
    }),
  } as unknown as Client
  return { client, getCaptured: () => captured }
}

describe('helix client pure logic (no live DB)', () => {
  afterEach(() => {
    setHelixClient(null)
  })

  describe('safeBigInt', () => {
    it('converts numeric strings', () => {
      expect(safeBigInt('42')).toBe(42n)
      expect(safeBigInt('0')).toBe(0n)
    })

    it('converts numbers', () => {
      expect(safeBigInt(42)).toBe(42n)
      expect(safeBigInt(0)).toBe(0n)
    })

    it('passes through bigint', () => {
      expect(safeBigInt(42n)).toBe(42n)
    })

    it('returns null for non-numeric strings (e.g. hypothesis ids)', () => {
      expect(safeBigInt('hypothesis-ac-phasemixing')).toBeNull()
      expect(safeBigInt('abc')).toBeNull()
      expect(safeBigInt('12abc')).toBeNull()
      expect(safeBigInt('')).toBeNull()
    })

    it('handles whitespace-padded numeric strings', () => {
      expect(safeBigInt('  42  ')).toBe(42n)
    })
  })

  describe('unwrap', () => {
    it('extracts properties array from a container', () => {
      const container: ReadContainer<{ id: number }> = { properties: [{ id: 1 }, { id: 2 }] }
      expect(unwrap(container)).toEqual([{ id: 1 }, { id: 2 }])
    })

    it('returns empty array when properties is missing', () => {
      expect(unwrap({ ids: [1, 2] })).toEqual([])
    })

    it('returns empty array when properties is undefined', () => {
      expect(unwrap({ properties: undefined })).toEqual([])
    })

    it('returns empty array for undefined container', () => {
      expect(unwrap(undefined)).toEqual([])
    })
  })

  describe('addPaper embedding branching', () => {
    it('calls addPaperWithEmbedding when embedding is a non-empty array', async () => {
      const { client, getCaptured } = createCapturingClient()
      setHelixClient(client)

      await addPaper({
        title: 'Test',
        abstract: 'Abstract',
        authors: ['Author'],
        year: 2024,
        embedding: [0.1, 0.2, 0.3],
      })

      expect(getCaptured()?.queryName).toBe('addPaperWithEmbedding')
    })

    it('calls addPaper (no embedding) when embedding is null or empty', async () => {
      const { client, getCaptured } = createCapturingClient()
      setHelixClient(client)

      await addPaper({
        title: 'Test',
        abstract: 'Abstract',
        authors: ['Author'],
        year: 2024,
        embedding: null,
      })

      expect(getCaptured()?.queryName).toBe('addPaper')

      await addPaper({
        title: 'Test2',
        abstract: 'Abstract',
        authors: ['Author'],
        year: 2024,
        embedding: [],
      })
      expect(getCaptured()?.queryName).toBe('addPaper')
    })
  })

  describe('addHypothesis embedding branching', () => {
    it('calls addHypothesisWithEmbedding when embedding provided', async () => {
      const { client, getCaptured } = createCapturingClient()
      setHelixClient(client)

      await addHypothesis({
        statement: 'Reconnection heats the corona',
        roundId: 1,
        runId: 'run-1',
        f1Score: 0.5,
        createdAt: '2024-01-01T00:00:00Z',
        embedding: [1, 2],
      })

      expect(getCaptured()?.queryName).toBe('addHypothesisWithEmbedding')
    })

    it('calls addHypothesis when no embedding', async () => {
      const { client, getCaptured } = createCapturingClient()
      setHelixClient(client)

      await addHypothesis({
        statement: 'Wave heating',
        roundId: 1,
        runId: 'run-1',
        f1Score: 0.3,
        createdAt: '2024-01-01T00:00:00Z',
      })

      expect(getCaptured()?.queryName).toBe('addHypothesis')
    })

    it('uses the context query when scientific hypothesis metadata is provided', async () => {
      const { client, getCaptured } = createCapturingClient()
      setHelixClient(client)

      await addHypothesis({
        statement: 'Wave heating',
        roundId: 1,
        runId: 'run-1',
        f1Score: 0.3,
        createdAt: '2024-01-01T00:00:00Z',
        contextJson: '{"mechanism":"alfven-wave-dissipation"}',
      })

      expect(getCaptured()?.queryName).toBe('addHypothesisWithContext')
    })
  })

  describe('addEvidence', () => {
    it('routes support type to addSupportingEvidence', async () => {
      const { client, getCaptured } = createCapturingClient()
      setHelixClient(client)

      await addEvidence({
        hypoId: '123',
        type: 'support',
        content: 'Evidence',
        f1Score: 0.8,
        fitsPaths: ['/path/to.fits'],
        createdAt: '2024-01-01T00:00:00Z',
      })

      expect(getCaptured()?.queryName).toBe('addSupportingEvidence')
    })

    it('routes contradict type to addContradictingEvidence', async () => {
      const { client, getCaptured } = createCapturingClient()
      setHelixClient(client)

      await addEvidence({
        hypoId: 456,
        type: 'contradict',
        content: 'Contradiction',
        f1Score: 0.2,
        fitsPaths: [],
        createdAt: '2024-01-01T00:00:00Z',
      })

      expect(getCaptured()?.queryName).toBe('addContradictingEvidence')
    })

    it('throws on non-numeric hypoId', async () => {
      const fake = createFakeClient({})
      setHelixClient(fake)
      await expect(
        addEvidence({
          hypoId: 'hypothesis-abc',
          type: 'support',
          content: 'x',
          f1Score: 0,
          fitsPaths: [],
          createdAt: '2024-01-01T00:00:00Z',
        }),
      ).rejects.toThrow('non-numeric hypoId')
    })
  })

  describe('read functions via injected client', () => {
    it('searchPapers combines title and annotation matches without duplicates', async () => {
      const fake = createFakeClient([
        { papers: { properties: [{ id: 1, title: 'Title match', authors: [], year: 2024 }] } },
        {
          papers: {
            properties: [
              { id: 1, title: 'Title match', authors: [], year: 2024 },
              { id: 2, title: 'Annotation match', authors: [], year: 2023 },
            ],
          },
        },
      ])
      setHelixClient(fake)
      const papers = await searchPapers('reconnection', 5)
      expect(papers).toHaveLength(2)
      expect(papers.map((paper) => paper.title)).toEqual(['Title match', 'Annotation match'])
      expect(fake.__calls).toHaveLength(2)
    })

    it('getPaper returns null for non-numeric id (safeBigInt guard)', async () => {
      const fake = createFakeClient({})
      setHelixClient(fake)
      const paper = await getPaper('not-a-number')
      expect(paper).toBeNull()
    })

    it('getHypothesis returns null for non-numeric id', async () => {
      const fake = createFakeClient({})
      setHelixClient(fake)
      const hypo = await getHypothesis('hypothesis-xyz')
      expect(hypo).toBeNull()
    })

    it('getEvidenceByHypothesis merges support + contradict arrays', async () => {
      const fake = createFakeClient({
        support: { properties: [{ id: 1, type: 'support', content: 'S1' }] },
        contradict: { properties: [{ id: 2, type: 'contradict', content: 'C1' }] },
      })
      setHelixClient(fake)
      const evidence = await getEvidenceByHypothesis('10')
      expect(evidence).toHaveLength(2)
      expect(evidence.map((e) => e.type)).toEqual(['support', 'contradict'])
    })

    it('getEvidenceByHypothesis returns empty array for non-numeric id', async () => {
      const fake = createFakeClient({})
      setHelixClient(fake)
      const evidence = await getEvidenceByHypothesis('abc')
      expect(evidence).toEqual([])
    })
  })
})
