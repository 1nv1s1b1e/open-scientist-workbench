import { env } from '@open-scientist/config'
import { describe, expect, it } from 'vitest'
import {
  addCaptureInEdges,
  addHypothesis,
  addPaper,
  addSnapshot,
  ensureIndexes,
  getHypothesesByRound,
  getPaper,
  getSnapshot,
  searchHypotheses,
  searchPapers,
} from '../src/client.ts'

const HELIX_URL = env.HELIX_URL

async function isHelixUp(): Promise<boolean> {
  try {
    const res = await fetch(`${HELIX_URL}/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(3000),
    })
    return res.status === 400 || res.ok
  } catch {
    return false
  }
}

const helixUp = await isHelixUp()

const describeIf = (condition: boolean) =>
  condition ? describe : (name: string, fn: () => void) => describe.skip(name, fn)

describeIf(helixUp)('HelixDB SDK integration', () => {
  const prefix = `itest-${Date.now()}-`
  const title = `${prefix}Test Paper`
  const abstract = `${prefix}abstract for integration test`
  let paperId: number | null = null
  const roundId = 999_999

  it('ensureIndexes creates text + vector indexes', async () => {
    await expect(ensureIndexes()).resolves.toBeUndefined()
  })

  it('addPaper creates a Paper node', async () => {
    await addPaper({
      title,
      abstract,
      authors: ['Tester'],
      year: 2024,
      doi: '10.1/itest',
    })
  })

  it('searchPapers finds the created paper by title', async () => {
    const papers = await searchPapers(prefix, 10)
    expect(papers.length).toBeGreaterThan(0)
    const found = papers.find((p) => p.title === title)
    expect(found).toBeDefined()
    expect(found?.abstract).toBe(abstract)
    expect(found?.authors).toEqual(['Tester'])
    expect(found?.year).toBe(2024)
    paperId = found!.id
    expect(typeof paperId).toBe('number')
  })

  it('getPaper retrieves the paper by id', async () => {
    expect(paperId).not.toBeNull()
    const paper = await getPaper(paperId!)
    expect(paper).not.toBeNull()
    expect(paper?.id).toBe(paperId)
    expect(paper?.title).toBe(title)
    expect(paper?.doi).toBe('10.1/itest')
  })

  it('addHypothesis creates a Hypothesis node', async () => {
    await addHypothesis({
      statement: `${prefix}test hypothesis`,
      roundId,
      runId: 'itest-run',
      f1Score: 0.42,
      createdAt: new Date().toISOString(),
    })
  })

  let hypoId: number | null = null

  it('searchHypotheses finds the created hypothesis (反查拿 id)', async () => {
    const hypos = await searchHypotheses(`${prefix}test`, 10)
    expect(hypos.length).toBeGreaterThan(0)
    const found = hypos.find((h) => h.statement === `${prefix}test hypothesis`)
    expect(found).toBeDefined()
    expect(found?.f1Score).toBe(0.42)
    hypoId = found!.id
    expect(typeof hypoId).toBe('number')
  })

  let snapshotId: number | null = null

  it('addSnapshot creates a Snapshot node', async () => {
    await addSnapshot({
      roundId,
      runId: 'itest-run',
      hypothesisIds: [],
      createdAt: new Date().toISOString(),
    })
  })

  it('getSnapshot retrieves the snapshot id for the round', async () => {
    const snap = await getSnapshot(roundId)
    expect(snap).not.toBeNull()
    expect(snap?.roundId).toBe(roundId)
    snapshotId = snap!.id
    expect(typeof snapshotId).toBe('number')
  })

  it('addCaptureInEdges links hypothesis -> snapshot via CAPTURED_IN', async () => {
    expect(hypoId).not.toBeNull()
    expect(snapshotId).not.toBeNull()
    await addCaptureInEdges({
      snapshotId: snapshotId!,
      hypoIds: [hypoId!],
    })
  })

  it('getHypothesesByRound traverses Snapshot->CAPTURED_IN->Hypothesis', async () => {
    const hypos = await getHypothesesByRound(roundId)
    expect(Array.isArray(hypos)).toBe(true)
    expect(hypos.length).toBeGreaterThanOrEqual(1)
    const found = hypos.find((h) => h.id === hypoId)
    expect(found).toBeDefined()
    expect(found?.statement).toBe(`${prefix}test hypothesis`)
    expect(found?.f1Score).toBe(0.42)
  })
})
