import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  appendMessage,
  appendRunChunk,
  closeProjectDb,
  createArtifact,
  createDataSnapshot,
  createMemoryEntry,
  createProcessingRun,
  createHypothesis,
  createProject,
  createProjectDb,
  createRun,
  createValidationTask,
  deleteProject,
  getHypothesis,
  getProject,
  getRun,
  getRunChunks,
  listHypothesesByRun,
  listArtifacts,
  listDataSnapshots,
  listMemoryEntries,
  listProcessingRuns,
  listValidationTasks,
  updateValidationTask,
  updateHypothesisStatus,
  updateRunStatus,
} from '../src/index.ts'

/**
 * Project-repo integration tests.
 *
 * Each `describe` block (and several individual `it`s) get a fresh BASE_DIR so
 * the per-project SQLite files never leak state between tests.
 *
 * `env` is a Proxy that re-reads `process.env.BASE_DIR` on every access, and
 * `createProjectDb` caches by `${baseDir}:${projectName}`, so setting the env
 * var per test is enough — no vi.resetModules() required.
 */

function makeBaseDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `os-storage-${label}-`))
}

describe('project repo', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = makeBaseDir('project')
    process.env.BASE_DIR = baseDir
  })

  afterEach(() => {
    closeProjectDb('proj-a')
    closeProjectDb('proj-b')
    rmSync(baseDir, { recursive: true, force: true })
    delete process.env.BASE_DIR
  })

  it('createProject inserts a row and returns id+name', async () => {
    const created = await createProject('proj-a', { theme: 'corona' })
    expect(created).toMatchObject({ name: 'proj-a' })
    expect((created as { id: string }).id).toBeTruthy()
  })

  it('getProject round-trips the row including configJson', async () => {
    await createProject('proj-a', { theme: 'corona', rounds: 3 })
    const got = await getProject('proj-a')
    expect(got).not.toBeNull()
    expect((got as { name: string }).name).toBe('proj-a')
    // configJson is stored raw; the repo returns the row as-is.
    expect((got as { configJson: string | null }).configJson).toContain('corona')
  })

  it('getProject returns null for unknown project', async () => {
    expect(await getProject('does-not-exist')).toBeNull()
  })

  it('deleteProject removes the row', async () => {
    await createProject('proj-a')
    expect(await getProject('proj-a')).not.toBeNull()
    await deleteProject('proj-a')
    expect(await getProject('proj-a')).toBeNull()
  })

  it('deleteProject on a missing project is a no-op (no throw)', async () => {
    await expect(deleteProject('ghost')).resolves.toBeUndefined()
  })
})

describe('run repo', () => {
  let baseDir: string
  let projectId: string

  beforeEach(async () => {
    baseDir = makeBaseDir('run')
    process.env.BASE_DIR = baseDir
    projectId = (await createProject('proj-a')).id as string
  })

  afterEach(() => {
    closeProjectDb('proj-a')
    rmSync(baseDir, { recursive: true, force: true })
    delete process.env.BASE_DIR
  })

  it('createRun seeds status=pending + startedAt', async () => {
    const run = await createRun('proj-a', projectId)
    expect(run.status).toBe('pending')
    expect(run.projectId).toBe(projectId)
    expect(run.startedAt).toBeTruthy()
  })

  it('getRun round-trips by id', async () => {
    const run = await createRun('proj-a', projectId)
    const got = await getRun('proj-a', run.id)
    expect(got).not.toBeNull()
    expect((got as { id: string }).id).toBe(run.id)
    expect((got as { currentRound: number }).currentRound).toBe(0)
    expect((got as { bestF1: number }).bestF1).toBe(0)
  })

  it('getRun returns null for unknown run', async () => {
    expect(await getRun('proj-a', randomUUID())).toBeNull()
  })

  it('updateRunStatus to running leaves endedAt null', async () => {
    const run = await createRun('proj-a', projectId)
    await updateRunStatus('proj-a', run.id, 'running')
    const got = await getRun('proj-a', run.id)
    expect((got as { status: string }).status).toBe('running')
    expect((got as { endedAt: string | null }).endedAt).toBeNull()
  })

  it('updateRunStatus to completed sets endedAt', async () => {
    const run = await createRun('proj-a', projectId)
    await updateRunStatus('proj-a', run.id, 'completed')
    const got = await getRun('proj-a', run.id)
    expect((got as { status: string }).status).toBe('completed')
    expect((got as { endedAt: string | null }).endedAt).not.toBeNull()
  })

  it('updateRunStatus to failed and stopped also set endedAt', async () => {
    for (const status of ['failed', 'stopped'] as const) {
      const run = await createRun('proj-a', projectId)
      await updateRunStatus('proj-a', run.id, status)
      const got = await getRun('proj-a', run.id)
      expect((got as { endedAt: string | null }).endedAt).not.toBeNull()
    }
  })
})

describe('message repo', () => {
  let baseDir: string
  let runId: string

  beforeEach(async () => {
    baseDir = makeBaseDir('message')
    process.env.BASE_DIR = baseDir
    const projectId = (await createProject('proj-a')).id as string
    runId = (await createRun('proj-a', projectId)).id
  })

  afterEach(() => {
    closeProjectDb('proj-a')
    rmSync(baseDir, { recursive: true, force: true })
    delete process.env.BASE_DIR
  })

  it('appendMessage returns the parts array (parsed back)', async () => {
    const msg = await appendMessage('proj-a', runId, 'user', [{ type: 'text', text: 'hello' }])
    expect(msg.role).toBe('user')
    expect(msg.parts).toEqual([{ type: 'text', text: 'hello' }])
  })
})

describe('hypothesis repo', () => {
  let baseDir: string
  let projectId: string
  let runId: string

  beforeEach(async () => {
    baseDir = makeBaseDir('hypothesis')
    process.env.BASE_DIR = baseDir
    projectId = (await createProject('proj-a')).id as string
    runId = (await createRun('proj-a', projectId)).id
  })

  afterEach(() => {
    closeProjectDb('proj-a')
    rmSync(baseDir, { recursive: true, force: true })
    delete process.env.BASE_DIR
  })

  it('createHypothesis seeds status=candidate + f1=null', async () => {
    const h = await createHypothesis('proj-a', projectId, runId, {
      statement: 'nano-flares heat the corona',
      pythonCode: 'print(1)',
      round: 1,
    })
    expect(h.status).toBe('candidate')
    expect(h.f1).toBeNull()
    // parentId omitted in input → absent from the returned object (undefined),
    // but persisted as NULL in the DB (verified by getHypothesis below).
    expect(h.round).toBe(1)
    const got = await getHypothesis('proj-a', h.id)
    expect((got as { parentId: string | null }).parentId).toBeNull()
  })

  it('createHypothesis stores parentId when provided', async () => {
    const parent = await createHypothesis('proj-a', projectId, runId, {
      statement: 'parent',
      pythonCode: '',
      round: 1,
    })
    const child = await createHypothesis('proj-a', projectId, runId, {
      statement: 'child',
      pythonCode: '',
      round: 2,
      parentId: parent.id,
    })
    expect(child.parentId).toBe(parent.id)
  })

  it('getHypothesis round-trips by id', async () => {
    const h = await createHypothesis('proj-a', projectId, runId, {
      statement: 'wave heating',
      pythonCode: 'x=1',
      round: 3,
    })
    const got = await getHypothesis('proj-a', h.id)
    expect(got).not.toBeNull()
    expect((got as { statement: string }).statement).toBe('wave heating')
    expect((got as { pythonCode: string }).pythonCode).toBe('x=1')
    expect((got as { round: number }).round).toBe(3)
  })

  it('getHypothesis returns null for unknown id', async () => {
    expect(await getHypothesis('proj-a', randomUUID())).toBeNull()
  })

  it('listHypothesesByRun filters by runId', async () => {
    await createHypothesis('proj-a', projectId, runId, {
      statement: 'a',
      pythonCode: '',
      round: 1,
    })
    await createHypothesis('proj-a', projectId, runId, {
      statement: 'b',
      pythonCode: '',
      round: 1,
    })
    expect(await listHypothesesByRun('proj-a', runId)).toHaveLength(2)
  })

  it('listHypothesesByRun returns [] for a run with no hypotheses', async () => {
    expect(await listHypothesesByRun('proj-a', randomUUID())).toEqual([])
  })

  it('updateHypothesisStatus transitions candidate → evaluated', async () => {
    const h = await createHypothesis('proj-a', projectId, runId, {
      statement: 's',
      pythonCode: '',
      round: 1,
    })
    await updateHypothesisStatus('proj-a', h.id, 'evaluated', 0.75)
    const got = await getHypothesis('proj-a', h.id)
    expect((got as { status: string }).status).toBe('evaluated')
    expect((got as { f1: number }).f1).toBeCloseTo(0.75)
  })

  it('updateHypothesisStatus sets winner without touching f1 when omitted', async () => {
    const h = await createHypothesis('proj-a', projectId, runId, {
      statement: 's',
      pythonCode: '',
      round: 1,
    })
    await updateHypothesisStatus('proj-a', h.id, 'evaluated', 0.9)
    await updateHypothesisStatus('proj-a', h.id, 'winner')
    const got = await getHypothesis('proj-a', h.id)
    expect((got as { status: string }).status).toBe('winner')
    expect((got as { f1: number }).f1).toBeCloseTo(0.9)
  })

  it('updateHypothesisStatus can move to eliminated', async () => {
    const h = await createHypothesis('proj-a', projectId, runId, {
      statement: 's',
      pythonCode: '',
      round: 1,
    })
    await updateHypothesisStatus('proj-a', h.id, 'eliminated')
    const got = await getHypothesis('proj-a', h.id)
    expect((got as { status: string }).status).toBe('eliminated')
  })
})

describe('scientific loop memory and validation task repos', () => {
  let baseDir: string
  let projectId: string
  let runId: string

  beforeEach(async () => {
    baseDir = makeBaseDir('scientific-loop')
    process.env.BASE_DIR = baseDir
    projectId = (await createProject('proj-a')).id as string
    runId = (await createRun('proj-a', projectId)).id
  })

  afterEach(() => {
    closeProjectDb('proj-a')
    rmSync(baseDir, { recursive: true, force: true })
    delete process.env.BASE_DIR
  })

  it('persists structured memory and returns it by round', async () => {
    await createMemoryEntry('proj-a', {
      memoryId: 'mem-1',
      layer: 'procedural-data',
      kind: 'processing-run',
      summary: '缺少高 cadence 磁场序列，不能判断高频功率谱',
      namespace: [projectId, runId, 'procedural-data'],
      tags: ['data-gap'],
      sourceIds: ['aia-171'],
      hypothesisIds: [],
      evidenceIds: [],
      taskIds: ['task-audit'],
      artifactIds: ['artifact-audit'],
      processingRunIds: ['processing-audit'],
      triggeredBy: ['task-audit'],
      verificationStatus: 'verified',
      agentId: 'source-audit',
      phenomenonId: 'phenomenon-1',
      projectId,
      runId,
      round: 1,
      fingerprint: 'mem-fingerprint-1',
      utility: 0.9,
      createdAt: new Date().toISOString(),
    })

    const entries = await listMemoryEntries('proj-a', { runId, limit: 5 })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.layer).toBe('procedural-data')
    expect(entries[0]?.kind).toBe('processing-run')
    expect(entries[0]?.sourceIds).toEqual(['aia-171'])
    expect(entries[0]?.namespace).toEqual([projectId, runId, 'procedural-data'])
    expect(entries[0]?.artifactIds).toEqual(['artifact-audit'])
    expect(entries[0]?.processingRunIds).toEqual(['processing-audit'])
    expect(entries[0]?.triggeredBy).toEqual(['task-audit'])
    expect(entries[0]?.verificationStatus).toBe('verified')
    expect(entries[0]?.agentId).toBe('source-audit')
    expect(entries[0]?.phenomenonId).toBe('phenomenon-1')
  })

  it('persists immutable data snapshots, processing runs, and artifacts', async () => {
    await createDataSnapshot('proj-a', projectId, runId, {
      snapshotId: 'snapshot-1',
      sourceIds: ['aia-171'],
      manifestPath: 'runs/run-1/data/snapshot-1.json',
      checksums: { 'aia-171': 'sha256:abc' },
      selection: { activeRegion: 'AR-1' },
      createdAt: '2026-08-08T00:00:00.000Z',
    })
    await createArtifact('proj-a', projectId, runId, {
      artifactId: 'artifact-1',
      kind: 'metrics',
      path: 'runs/run-1/artifacts/metrics.json',
      checksum: 'sha256:def',
      generatedBy: 'timeseries-analysis',
      processingRunId: 'processing-1',
      sourceIds: ['aia-171'],
      createdAt: '2026-08-08T00:00:01.000Z',
    })
    await createProcessingRun('proj-a', {
      processingRunId: 'processing-1',
      projectId,
      runId,
      round: 1,
      agentId: 'timeseries-analysis',
      taskId: 'task-1',
      triggeredBy: 'task-1',
      snapshotIds: ['snapshot-1'],
      steps: [
        {
          stepId: 'align-1',
          name: '多波段时间对齐',
          tool: 'alignment-pipeline',
          toolVersion: '1.0.0',
          parameters: { interpolation: 'nearest' },
          inputArtifactIds: [],
          outputArtifactIds: ['artifact-1'],
          deterministic: true,
        },
      ],
      deterministic: true,
      status: 'completed',
      outputArtifactIds: ['artifact-1'],
      metricsArtifactId: 'artifact-1',
      limitations: [],
      fingerprint: 'processing-fingerprint-1',
      startedAt: '2026-08-08T00:00:00.000Z',
      completedAt: '2026-08-08T00:00:01.000Z',
    })

    expect(await listDataSnapshots('proj-a', { runId })).toEqual([
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        sourceIds: ['aia-171'],
      }),
    ])
    expect(await listArtifacts('proj-a', { runId })).toEqual([
      expect.objectContaining({
        artifactId: 'artifact-1',
        processingRunId: 'processing-1',
      }),
    ])
    expect(await listProcessingRuns('proj-a', { runId })).toEqual([
      expect.objectContaining({
        processingRunId: 'processing-1',
        snapshotIds: ['snapshot-1'],
        outputArtifactIds: ['artifact-1'],
      }),
    ])
  })

  it('deduplicates validation tasks by fingerprint and records result evidence', async () => {
    const task = {
      taskId: 'task-1',
      route: 'B' as const,
      type: 'analysis' as const,
      objective: '比较活动区的高频功率谱',
      hypothesisIds: [],
      predictionIds: [],
      falsificationConditionIds: [],
      requiredSourceIds: ['aia-171'],
      discriminatingOutcomes: ['连续谱衰减', '间歇性突发'],
      triggeredBy: 'mem-1',
      status: 'planned' as const,
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'task-fingerprint-1',
    }
    const first = await createValidationTask('proj-a', { ...task, projectId, runId })
    const second = await createValidationTask('proj-a', {
      ...task,
      taskId: 'task-duplicate',
      projectId,
      runId,
    })

    expect(second.taskId).toBe(first.taskId)
    const updated = await updateValidationTask('proj-a', first.taskId, {
      status: 'completed',
      resultEvidenceIds: ['e-1'],
    })
    expect(updated?.status).toBe('completed')
    expect(updated?.resultEvidenceIds).toEqual(['e-1'])
  })

  it('scopes validation task fingerprints to a run and preserves executor bindings', async () => {
    const secondRunId = (await createRun('proj-a', projectId)).id
    const task = {
      taskId: 'task-run-1',
      executorId: 'coronal-timeseries-lag-v1',
      route: 'B' as const,
      type: 'analysis' as const,
      objective: 'measure a registered lag diagnostic',
      hypothesisIds: ['hypothesis-1'],
      predictionIds: [],
      falsificationConditionIds: [],
      requiredSourceIds: ['aia-171'],
      discriminatingOutcomes: ['lag detected', 'lag absent'],
      triggeredBy: 'hypothesis-1',
      status: 'planned' as const,
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'shared-fingerprint',
    }
    await createValidationTask('proj-a', { ...task, projectId, runId })
    await createValidationTask('proj-a', {
      ...task,
      taskId: 'task-run-2',
      projectId,
      runId: secondRunId,
    })

    expect(await listValidationTasks('proj-a', { runId })).toEqual([
      expect.objectContaining({
        taskId: 'task-run-1',
        executorId: 'coronal-timeseries-lag-v1',
      }),
    ])
    expect(await listValidationTasks('proj-a', { runId: secondRunId })).toEqual([
      expect.objectContaining({ taskId: 'task-run-2' }),
    ])
  })

  it('continues durable chunk sequence when a resumed writer restarts at zero', async () => {
    expect(await appendRunChunk('proj-a', runId, 0, JSON.stringify({ part: 1 }))).toBe(0)
    expect(await appendRunChunk('proj-a', runId, 0, JSON.stringify({ part: 2 }))).toBe(1)
    expect(await getRunChunks('proj-a', runId)).toEqual([
      { seq: 0, chunkJson: JSON.stringify({ part: 1 }) },
      { seq: 1, chunkJson: JSON.stringify({ part: 2 }) },
    ])
  })
})

describe('db cache (createProjectDb / closeProjectDb)', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = makeBaseDir('cache')
    process.env.BASE_DIR = baseDir
  })

  afterEach(() => {
    closeProjectDb('proj-a')
    closeProjectDb('proj-b')
    rmSync(baseDir, { recursive: true, force: true })
    delete process.env.BASE_DIR
  })

  it('createProjectDb returns the same ProjectDb for the same name (cache hit)', () => {
    const a = createProjectDb('proj-a')
    const b = createProjectDb('proj-a')
    expect(a).toBe(b)
  })

  it('createProjectDb returns distinct ProjectDbs for different names', () => {
    const a = createProjectDb('proj-a')
    const b = createProjectDb('proj-b')
    expect(a).not.toBe(b)
  })

  it('closeProjectDb evicts the cache entry (next create yields a new instance)', () => {
    const a = createProjectDb('proj-a')
    closeProjectDb('proj-a')
    const b = createProjectDb('proj-a')
    expect(b).not.toBe(a)
  })

  it('closeProjectDb on an unknown name is a no-op', () => {
    expect(() => closeProjectDb('never-opened')).not.toThrow()
  })
})
