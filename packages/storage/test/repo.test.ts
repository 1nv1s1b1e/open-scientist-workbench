import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Project-repo integration tests.
 *
 * Each `describe` block (and several individual `it`s) get a fresh BASE_DIR so
 * the module-level `createProjectDb` cache (keyed by projectName) and the
 * per-project SQLite files never leak state between tests.
 *
 * `vi.resetModules()` + dynamic `import()` is required because:
 *  - `createProjectDb` caches `ProjectDb` instances in a module-level Map.
 *  - `@open-scientist/config`'s `env` is parsed once at module load and caches
 *    `BASE_DIR`. Setting `process.env.BASE_DIR` then re-importing picks it up.
 */

interface StorageModule {
  createProjectDb: (projectName: string) => {
    sqlite: { close: () => void; prepare: (sql: string) => { all: () => unknown[] } }
  }
  closeProjectDb: (projectName: string) => void
  createProject: (
    name: string,
    config?: Record<string, unknown>,
  ) => Promise<{
    id: string
    name: string
    createdAt: string
    config: Record<string, unknown> | null
  }>
  getProject: (name: string) => Promise<{
    id: string
    name: string
    createdAt: string
    configJson: string | null
  } | null>
  deleteProject: (name: string) => Promise<unknown>
  createRun: (
    projectName: string,
    projectId: string,
  ) => Promise<{
    id: string
    projectId: string
    status: string
    startedAt: string
  }>
  getRun: (projectName: string, runId: string) => Promise<Record<string, unknown> | null>
  listRuns: (projectName: string) => Promise<unknown[]>
  updateRunStatus: (
    projectName: string,
    runId: string,
    status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'stopped',
  ) => Promise<void>
  saveResumeState: (projectName: string, runId: string, blob: string) => Promise<void>
  updateRound: (projectName: string, runId: string, round: number, bestF1: number) => Promise<void>
  appendMessage: (
    projectName: string,
    runId: string,
    role: 'user' | 'assistant' | 'system' | 'tool',
    parts: unknown[],
  ) => Promise<{ id: string; runId: string; role: string; parts: unknown[]; createdAt: string }>
  listMessages: (projectName: string, runId: string) => Promise<unknown[]>
  createHypothesis: (
    projectName: string,
    projectId: string,
    runId: string,
    data: {
      statement: string
      pythonCode: string
      round: number
      parentId?: string | null
    },
  ) => Promise<{
    id: string
    statement: string
    pythonCode: string
    round: number
    parentId?: string | null
    status: string
    createdAt: string
    f1: number | null
  }>
  getHypothesis: (projectName: string, hypoId: string) => Promise<Record<string, unknown> | null>
  listHypothesesByRun: (projectName: string, runId: string) => Promise<unknown[]>
  updateHypothesisStatus: (
    projectName: string,
    hypoId: string,
    status: string,
    f1?: number,
  ) => Promise<void>
  addEvidence: (
    projectName: string,
    hypoId: string,
    data: {
      fitsPaths: string[]
      videoClipPath?: string | null
      metadata: Record<string, unknown>
    },
  ) => Promise<{ id: string; hypoId: string; fitsPaths: string[]; createdAt: string }>
  getEvidence: (projectName: string, hypoId: string) => Promise<Record<string, unknown> | null>
  addCritique: (
    projectName: string,
    hypoId: string,
    data: { critiqueText: string; rationale: string; round: number },
  ) => Promise<{ id: string; hypoId: string; critiqueText: string; createdAt: string }>
  listCritiques: (projectName: string, hypoId: string) => Promise<unknown[]>
  addMutation: (
    projectName: string,
    parentHypoId: string,
    childHypoId: string,
    data: { mutationRationale: string; round: number },
  ) => Promise<{ id: string; parentHypoId: string; childHypoId: string; createdAt: string }>
  addPlan: (
    projectName: string,
    runId: string,
    data: {
      round: number
      searchParams: Record<string, unknown>
      mhdCfgPath?: string | null
      observationProposal?: string | null
    },
  ) => Promise<{ id: string; runId: string; round: number; createdAt: string }>
  listPlans: (projectName: string, runId: string) => Promise<unknown[]>
}

async function loadStorage(baseDir: string): Promise<StorageModule> {
  vi.resetModules()
  process.env.BASE_DIR = baseDir
  return (await import('../src/index.js')) as unknown as StorageModule
}

function makeBaseDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `os-storage-${label}-`))
}

describe('project repo', () => {
  let baseDir: string
  let storage: StorageModule

  beforeEach(async () => {
    baseDir = makeBaseDir('project')
    storage = await loadStorage(baseDir)
  })

  afterEach(() => {
    storage.closeProjectDb('proj-a')
    storage.closeProjectDb('proj-b')
    rmSync(baseDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('createProject inserts a row and returns id+name', async () => {
    const created = await storage.createProject('proj-a', { theme: 'corona' })
    expect(created).toMatchObject({ name: 'proj-a' })
    expect((created as { id: string }).id).toBeTruthy()
  })

  it('getProject round-trips the row including configJson', async () => {
    await storage.createProject('proj-a', { theme: 'corona', rounds: 3 })
    const got = await storage.getProject('proj-a')
    expect(got).not.toBeNull()
    expect((got as { name: string }).name).toBe('proj-a')
    // configJson is stored raw; the repo returns the row as-is.
    expect((got as { configJson: string | null }).configJson).toContain('corona')
  })

  it('getProject returns null for unknown project', async () => {
    expect(await storage.getProject('does-not-exist')).toBeNull()
  })

  it('deleteProject removes the row', async () => {
    await storage.createProject('proj-a')
    expect(await storage.getProject('proj-a')).not.toBeNull()
    await storage.deleteProject('proj-a')
    expect(await storage.getProject('proj-a')).toBeNull()
  })

  it('deleteProject on a missing project is a no-op (no throw)', async () => {
    await expect(storage.deleteProject('ghost')).resolves.toBeUndefined()
  })
})

describe('run repo', () => {
  let baseDir: string
  let storage: StorageModule
  let projectId: string

  beforeEach(async () => {
    baseDir = makeBaseDir('run')
    storage = await loadStorage(baseDir)
    projectId = (await storage.createProject('proj-a')).id as string
  })

  afterEach(() => {
    storage.closeProjectDb('proj-a')
    rmSync(baseDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('createRun seeds status=pending + startedAt', async () => {
    const run = await storage.createRun('proj-a', projectId)
    expect(run.status).toBe('pending')
    expect(run.projectId).toBe(projectId)
    expect(run.startedAt).toBeTruthy()
  })

  it('getRun round-trips by id', async () => {
    const run = await storage.createRun('proj-a', projectId)
    const got = await storage.getRun('proj-a', run.id)
    expect(got).not.toBeNull()
    expect((got as { id: string }).id).toBe(run.id)
    expect((got as { currentRound: number }).currentRound).toBe(0)
    expect((got as { bestF1: number }).bestF1).toBe(0)
  })

  it('getRun returns null for unknown run', async () => {
    expect(await storage.getRun('proj-a', randomUUID())).toBeNull()
  })

  it('listRuns returns all runs for the project', async () => {
    await storage.createRun('proj-a', projectId)
    await storage.createRun('proj-a', projectId)
    const runs = await storage.listRuns('proj-a')
    expect(runs).toHaveLength(2)
  })

  it('updateRunStatus to running leaves endedAt null', async () => {
    const run = await storage.createRun('proj-a', projectId)
    await storage.updateRunStatus('proj-a', run.id, 'running')
    const got = await storage.getRun('proj-a', run.id)
    expect((got as { status: string }).status).toBe('running')
    expect((got as { endedAt: string | null }).endedAt).toBeNull()
  })

  it('updateRunStatus to completed sets endedAt', async () => {
    const run = await storage.createRun('proj-a', projectId)
    await storage.updateRunStatus('proj-a', run.id, 'completed')
    const got = await storage.getRun('proj-a', run.id)
    expect((got as { status: string }).status).toBe('completed')
    expect((got as { endedAt: string | null }).endedAt).not.toBeNull()
  })

  it('updateRunStatus to failed and stopped also set endedAt', async () => {
    for (const status of ['failed', 'stopped'] as const) {
      const run = await storage.createRun('proj-a', projectId)
      await storage.updateRunStatus('proj-a', run.id, status)
      const got = await storage.getRun('proj-a', run.id)
      expect((got as { endedAt: string | null }).endedAt).not.toBeNull()
    }
  })

  it('saveResumeState stores the blob', async () => {
    const run = await storage.createRun('proj-a', projectId)
    await storage.saveResumeState('proj-a', run.id, 'opaque-state-blob')
    const got = await storage.getRun('proj-a', run.id)
    expect((got as { resumeStateBlob: string | null }).resumeStateBlob).toBe('opaque-state-blob')
  })

  it('updateRound bumps currentRound + bestF1', async () => {
    const run = await storage.createRun('proj-a', projectId)
    await storage.updateRound('proj-a', run.id, 5, 0.82)
    const got = await storage.getRun('proj-a', run.id)
    expect((got as { currentRound: number }).currentRound).toBe(5)
    expect((got as { bestF1: number }).bestF1).toBeCloseTo(0.82)
  })
})

describe('message repo', () => {
  let baseDir: string
  let storage: StorageModule
  let runId: string

  beforeEach(async () => {
    baseDir = makeBaseDir('message')
    storage = await loadStorage(baseDir)
    const projectId = (await storage.createProject('proj-a')).id as string
    runId = (await storage.createRun('proj-a', projectId)).id
  })

  afterEach(() => {
    storage.closeProjectDb('proj-a')
    rmSync(baseDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('appendMessage returns the parts array (parsed back)', async () => {
    const msg = await storage.appendMessage('proj-a', runId, 'user', [
      { type: 'text', text: 'hello' },
    ])
    expect(msg.role).toBe('user')
    expect(msg.parts).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('listMessages returns messages filtered by runId in insertion order', async () => {
    await storage.appendMessage('proj-a', runId, 'user', [{ text: 'a' }])
    await storage.appendMessage('proj-a', runId, 'assistant', [{ text: 'b' }])
    const msgs = await storage.listMessages('proj-a', runId)
    expect(msgs).toHaveLength(2)
    expect((msgs[0] as { role: string }).role).toBe('user')
    expect((msgs[1] as { role: string }).role).toBe('assistant')
  })

  it('listMessages excludes messages from other runs', async () => {
    await storage.appendMessage('proj-a', runId, 'system', [])
    const projectId = ((await storage.getProject('proj-a')) as { id: string }).id
    const otherRun = await storage.createRun('proj-a', projectId)
    await storage.appendMessage('proj-a', otherRun.id, 'user', [{ x: 1 }])
    const msgs = await storage.listMessages('proj-a', runId)
    expect(msgs).toHaveLength(1)
  })

  it('listMessages returns [] for a run with no messages', async () => {
    expect(await storage.listMessages('proj-a', randomUUID())).toEqual([])
  })
})

describe('hypothesis repo', () => {
  let baseDir: string
  let storage: StorageModule
  let projectId: string
  let runId: string

  beforeEach(async () => {
    baseDir = makeBaseDir('hypothesis')
    storage = await loadStorage(baseDir)
    projectId = (await storage.createProject('proj-a')).id as string
    runId = (await storage.createRun('proj-a', projectId)).id
  })

  afterEach(() => {
    storage.closeProjectDb('proj-a')
    rmSync(baseDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('createHypothesis seeds status=candidate + f1=null', async () => {
    const h = await storage.createHypothesis('proj-a', projectId, runId, {
      statement: 'nano-flares heat the corona',
      pythonCode: 'print(1)',
      round: 1,
    })
    expect(h.status).toBe('candidate')
    expect(h.f1).toBeNull()
    // parentId omitted in input → absent from the returned object (undefined),
    // but persisted as NULL in the DB (verified by getHypothesis below).
    expect(h.round).toBe(1)
    const got = await storage.getHypothesis('proj-a', h.id)
    expect((got as { parentId: string | null }).parentId).toBeNull()
  })

  it('createHypothesis stores parentId when provided', async () => {
    const parent = await storage.createHypothesis('proj-a', projectId, runId, {
      statement: 'parent',
      pythonCode: '',
      round: 1,
    })
    const child = await storage.createHypothesis('proj-a', projectId, runId, {
      statement: 'child',
      pythonCode: '',
      round: 2,
      parentId: parent.id,
    })
    expect(child.parentId).toBe(parent.id)
  })

  it('getHypothesis round-trips by id', async () => {
    const h = await storage.createHypothesis('proj-a', projectId, runId, {
      statement: 'wave heating',
      pythonCode: 'x=1',
      round: 3,
    })
    const got = await storage.getHypothesis('proj-a', h.id)
    expect(got).not.toBeNull()
    expect((got as { statement: string }).statement).toBe('wave heating')
    expect((got as { pythonCode: string }).pythonCode).toBe('x=1')
    expect((got as { round: number }).round).toBe(3)
  })

  it('getHypothesis returns null for unknown id', async () => {
    expect(await storage.getHypothesis('proj-a', randomUUID())).toBeNull()
  })

  it('listHypothesesByRun filters by runId', async () => {
    await storage.createHypothesis('proj-a', projectId, runId, {
      statement: 'a',
      pythonCode: '',
      round: 1,
    })
    await storage.createHypothesis('proj-a', projectId, runId, {
      statement: 'b',
      pythonCode: '',
      round: 1,
    })
    expect(await storage.listHypothesesByRun('proj-a', runId)).toHaveLength(2)
  })

  it('listHypothesesByRun returns [] for a run with no hypotheses', async () => {
    expect(await storage.listHypothesesByRun('proj-a', randomUUID())).toEqual([])
  })

  it('updateHypothesisStatus transitions candidate → evaluated', async () => {
    const h = await storage.createHypothesis('proj-a', projectId, runId, {
      statement: 's',
      pythonCode: '',
      round: 1,
    })
    await storage.updateHypothesisStatus('proj-a', h.id, 'evaluated', 0.75)
    const got = await storage.getHypothesis('proj-a', h.id)
    expect((got as { status: string }).status).toBe('evaluated')
    expect((got as { f1: number }).f1).toBeCloseTo(0.75)
  })

  it('updateHypothesisStatus sets winner without touching f1 when omitted', async () => {
    const h = await storage.createHypothesis('proj-a', projectId, runId, {
      statement: 's',
      pythonCode: '',
      round: 1,
    })
    await storage.updateHypothesisStatus('proj-a', h.id, 'evaluated', 0.9)
    await storage.updateHypothesisStatus('proj-a', h.id, 'winner')
    const got = await storage.getHypothesis('proj-a', h.id)
    expect((got as { status: string }).status).toBe('winner')
    expect((got as { f1: number }).f1).toBeCloseTo(0.9)
  })

  it('updateHypothesisStatus can move to eliminated', async () => {
    const h = await storage.createHypothesis('proj-a', projectId, runId, {
      statement: 's',
      pythonCode: '',
      round: 1,
    })
    await storage.updateHypothesisStatus('proj-a', h.id, 'eliminated')
    const got = await storage.getHypothesis('proj-a', h.id)
    expect((got as { status: string }).status).toBe('eliminated')
  })
})

describe('evidence repo', () => {
  let baseDir: string
  let storage: StorageModule
  let hypoId: string

  beforeEach(async () => {
    baseDir = makeBaseDir('evidence')
    storage = await loadStorage(baseDir)
    const projectId = (await storage.createProject('proj-a')).id as string
    const runId = (await storage.createRun('proj-a', projectId)).id
    hypoId = (
      await storage.createHypothesis('proj-a', projectId, runId, {
        statement: 's',
        pythonCode: '',
        round: 1,
      })
    ).id
  })

  afterEach(() => {
    storage.closeProjectDb('proj-a')
    rmSync(baseDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('addEvidence returns the normalized payload', async () => {
    const ev = await storage.addEvidence('proj-a', hypoId, {
      fitsPaths: ['/a.fits', '/b.fits'],
      videoClipPath: '/clip.mp4',
      metadata: { region: 'AR13664' },
    })
    expect(ev.hypoId).toBe(hypoId)
    expect(ev.fitsPaths).toEqual(['/a.fits', '/b.fits'])
  })

  it('getEvidence round-trips by hypoId (first row)', async () => {
    await storage.addEvidence('proj-a', hypoId, {
      fitsPaths: ['/x.fits'],
      metadata: { wave: '171A' },
    })
    const got = await storage.getEvidence('proj-a', hypoId)
    expect(got).not.toBeNull()
    expect((got as { hypoId: string }).hypoId).toBe(hypoId)
    expect(JSON.parse((got as { fitsPathsJson: string }).fitsPathsJson)).toEqual(['/x.fits'])
    expect(JSON.parse((got as { metadataJson: string }).metadataJson)).toEqual({ wave: '171A' })
  })

  it('addEvidence stores videoClipPath null when omitted', async () => {
    await storage.addEvidence('proj-a', hypoId, {
      fitsPaths: [],
      metadata: {},
    })
    const got = await storage.getEvidence('proj-a', hypoId)
    expect((got as { videoClipPath: string | null }).videoClipPath).toBeNull()
  })

  it('getEvidence returns null for an unknown hypoId', async () => {
    expect(await storage.getEvidence('proj-a', randomUUID())).toBeNull()
  })
})

describe('critique repo', () => {
  let baseDir: string
  let storage: StorageModule
  let hypoId: string
  let otherHypoId: string

  beforeEach(async () => {
    baseDir = makeBaseDir('critique')
    storage = await loadStorage(baseDir)
    const projectId = (await storage.createProject('proj-a')).id as string
    const runId = (await storage.createRun('proj-a', projectId)).id
    hypoId = (
      await storage.createHypothesis('proj-a', projectId, runId, {
        statement: 'a',
        pythonCode: '',
        round: 1,
      })
    ).id
    otherHypoId = (
      await storage.createHypothesis('proj-a', projectId, runId, {
        statement: 'b',
        pythonCode: '',
        round: 1,
      })
    ).id
  })

  afterEach(() => {
    storage.closeProjectDb('proj-a')
    rmSync(baseDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('addCritique returns the stored payload', async () => {
    const c = await storage.addCritique('proj-a', hypoId, {
      critiqueText: 'too strong',
      rationale: 'no evidence',
      round: 2,
    })
    expect(c.hypoId).toBe(hypoId)
    expect(c.critiqueText).toBe('too strong')
  })

  it('listCritiques filters by hypoId', async () => {
    await storage.addCritique('proj-a', hypoId, {
      critiqueText: 'c1',
      rationale: 'r1',
      round: 1,
    })
    await storage.addCritique('proj-a', otherHypoId, {
      critiqueText: 'c2',
      rationale: 'r2',
      round: 1,
    })
    expect(await storage.listCritiques('proj-a', hypoId)).toHaveLength(1)
  })

  it('listCritiques returns [] for unknown hypoId', async () => {
    expect(await storage.listCritiques('proj-a', randomUUID())).toEqual([])
  })

  it('addMutation links parent → child and returns the row', async () => {
    const m = await storage.addMutation('proj-a', hypoId, otherHypoId, {
      mutationRationale: 'tightened scope',
      round: 2,
    })
    expect(m.parentHypoId).toBe(hypoId)
    expect(m.childHypoId).toBe(otherHypoId)
  })
})

describe('plan repo', () => {
  let baseDir: string
  let storage: StorageModule
  let runId: string

  beforeEach(async () => {
    baseDir = makeBaseDir('plan')
    storage = await loadStorage(baseDir)
    const projectId = (await storage.createProject('proj-a')).id as string
    runId = (await storage.createRun('proj-a', projectId)).id
  })

  afterEach(() => {
    storage.closeProjectDb('proj-a')
    rmSync(baseDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('addPlan returns the stored payload', async () => {
    const p = await storage.addPlan('proj-a', runId, {
      round: 1,
      searchParams: { q: 'corona' },
      mhdCfgPath: '/mhd/a.cfg',
      observationProposal: 'prop-1',
    })
    expect(p.runId).toBe(runId)
    expect(p.round).toBe(1)
  })

  it('listPlans filters by runId', async () => {
    await storage.addPlan('proj-a', runId, { round: 1, searchParams: {} })
    await storage.addPlan('proj-a', runId, { round: 2, searchParams: { x: 1 } })
    const plans = await storage.listPlans('proj-a', runId)
    expect(plans).toHaveLength(2)
    expect((plans[0] as { round: number }).round).toBe(1)
    expect((plans[1] as { round: number }).round).toBe(2)
  })

  it('listPlans returns [] for an unknown runId', async () => {
    expect(await storage.listPlans('proj-a', randomUUID())).toEqual([])
  })

  it('addPlan stores mhdCfgPath + observationProposal as null when omitted', async () => {
    await storage.addPlan('proj-a', runId, { round: 1, searchParams: {} })
    const plans = await storage.listPlans('proj-a', runId)
    expect((plans[0] as { mhdCfgPath: string | null }).mhdCfgPath).toBeNull()
    expect((plans[0] as { observationProposal: string | null }).observationProposal).toBeNull()
  })
})

describe('logs table (direct insert — no repo function yet)', () => {
  let baseDir: string
  let storage: StorageModule
  let runId: string

  beforeEach(async () => {
    baseDir = makeBaseDir('logs')
    storage = await loadStorage(baseDir)
    const projectId = (await storage.createProject('proj-a')).id as string
    runId = (await storage.createRun('proj-a', projectId)).id
  })

  afterEach(() => {
    storage.closeProjectDb('proj-a')
    rmSync(baseDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('the logs table exists after migration', async () => {
    // Schema has a `logs` table but no repo function; verify the migration
    // created it by querying sqlite_master directly.
    const { createProjectDb } = (await import('../src/index.js')) as unknown as {
      createProjectDb: (n: string) => {
        sqlite: { prepare: (s: string) => { all: () => unknown[] } }
      }
    }
    const { sqlite } = createProjectDb('proj-a')
    const rows = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string
    }[]
    expect(rows.map((r) => r.name)).toContain('logs')
    // touch runId so the linter doesn't complain about an unused var path.
    expect(runId).toBeTruthy()
  })
})

describe('db cache (createProjectDb / closeProjectDb)', () => {
  let baseDir: string
  let storage: StorageModule

  beforeEach(async () => {
    baseDir = makeBaseDir('cache')
    storage = await loadStorage(baseDir)
  })

  afterEach(() => {
    storage.closeProjectDb('proj-a')
    storage.closeProjectDb('proj-b')
    rmSync(baseDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('createProjectDb returns the same ProjectDb for the same name (cache hit)', () => {
    const a = storage.createProjectDb('proj-a')
    const b = storage.createProjectDb('proj-a')
    expect(a).toBe(b)
  })

  it('createProjectDb returns distinct ProjectDbs for different names', () => {
    const a = storage.createProjectDb('proj-a')
    const b = storage.createProjectDb('proj-b')
    expect(a).not.toBe(b)
  })

  it('closeProjectDb evicts the cache entry (next create yields a new instance)', () => {
    const a = storage.createProjectDb('proj-a')
    storage.closeProjectDb('proj-a')
    const b = storage.createProjectDb('proj-a')
    expect(b).not.toBe(a)
  })

  it('closeProjectDb on an unknown name is a no-op', () => {
    expect(() => storage.closeProjectDb('never-opened')).not.toThrow()
  })
})
