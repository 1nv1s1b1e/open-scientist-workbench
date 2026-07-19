import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RoundSnapshot } from '../src/sisyphus/steps/index.ts'
import { snapshotStep } from '../src/sisyphus/steps/index.ts'

function makeSnapshot(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    round: 1,
    runId: 'run-1',
    projectId: 'snap-test-proj',
    bestF1: 0.5,
    leadingHypoId: 'h1',
    survivingCount: 3,
    hypotheses: [
      {
        id: 'h1',
        statement: 'AC wave heating',
        f1: 0.5,
        status: 'evaluated',
        parentId: null,
        round: 1,
      },
    ],
    convergenceHistory: [{ round: 1, bestF1: 0.5, count: 3 }],
    capturedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('snapshotStep', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'os-snapshot-'))
    process.env.BASE_DIR = tmp
  })

  afterEach(() => {
    delete process.env.BASE_DIR
    rmSync(tmp, { recursive: true, force: true })
  })

  it('writes snapshot.json under <BASE_DIR>/projects/<project>/rounds/<round>/', async () => {
    const snap = makeSnapshot()
    const { path } = await snapshotStep(snap)

    expect(path).toContain('snap-test-proj')
    expect(path).toContain(join('rounds', '1'))
    expect(path.endsWith('snapshot.json')).toBe(true)

    const written = JSON.parse(await readFile(path, 'utf-8'))
    expect(written).toEqual(snap)
  })

  it('round-trips JSON.stringify → parse preserving all fields', async () => {
    const snap = makeSnapshot({
      round: 7,
      bestF1: 0.88,
      leadingHypoId: 'h-winner',
      survivingCount: 2,
      convergenceHistory: [
        { round: 1, bestF1: 0.2, count: 6 },
        { round: 7, bestF1: 0.88, count: 2 },
      ],
    })
    const { path } = await snapshotStep(snap)
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw) as RoundSnapshot

    expect(parsed.round).toBe(7)
    expect(parsed.bestF1).toBe(0.88)
    expect(parsed.leadingHypoId).toBe('h-winner')
    expect(parsed.survivingCount).toBe(2)
    expect(parsed.convergenceHistory).toHaveLength(2)
    expect(parsed.hypotheses).toEqual(snap.hypotheses)
    // Full structural equality — the snapshot is persisted verbatim.
    expect(parsed).toEqual(snap)
  })

  it('overwrites on repeated write to the same round (no error)', async () => {
    const first = makeSnapshot({ bestF1: 0.3, capturedAt: '2026-01-01T00:00:00Z' })
    const { path: path1 } = await snapshotStep(first)

    const second = makeSnapshot({ bestF1: 0.9, capturedAt: '2026-01-02T00:00:00Z' })
    const { path: path2 } = await snapshotStep(second)

    expect(path1).toBe(path2)
    const written = JSON.parse(await readFile(path2, 'utf-8'))
    expect(written.bestF1).toBe(0.9)
    expect(written.capturedAt).toBe('2026-01-02T00:00:00Z')
  })
})
