import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { getDatasetDir, getProjectDir } from '@open-scientist/config'
import {
  createArtifact,
  createDataSnapshot,
  createProcessingRun,
  listArtifacts,
  listDataSnapshots,
  listProcessingRuns,
} from '@open-scientist/storage'
import type {
  EvidenceProvenance,
  EvidenceRecord,
} from '@open-scientist/schema'

const execFileAsync = promisify(execFile)
const PROCESSOR_VERSION = '1.0.0'

export interface ObservableDiagnostic {
  observableStatus: 'support' | 'unknown'
  boundary: string
  [key: string]: unknown
}

export interface LocalCoronalAnalysis {
  schemaVersion: number
  scriptVersion: string
  mode: 'discovery' | 'validation'
  generatedAt: string
  manifestPath: string
  manifestSha256: string
  target: {
    caseId: string
    label: string
    activeRegion: string
    roi: Record<string, unknown>
    channels: Record<string, Record<string, unknown>>
    comparisons: Record<string, Record<string, unknown>>
    usedObservationCount: number
    sampleIds: string[]
    sampledChecksums: Record<string, string>
    readFailures: string[]
  }
  baseline: null | {
    caseId: string
    label: string
    activeRegion: string
    channels: Record<string, Record<string, unknown>>
    usedObservationCount: number
    sampleIds: string[]
    sampledChecksums: Record<string, string>
    readFailures: string[]
  }
  diagnostics: {
    wave: ObservableDiagnostic
    reconnection: ObservableDiagnostic
    coupled: ObservableDiagnostic
  }
  limitations: string[]
}

export interface LocalProcessingResult {
  analysis: LocalCoronalAnalysis
  processingRunId: string
  snapshotId: string
  metricsArtifactId: string
  figureArtifactId: string
  provenance: EvidenceProvenance
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function fileSha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function processorScript(): string {
  return fileURLToPath(new URL('../../../../scripts/analyze_coronal_window.py', import.meta.url))
}

async function persistOnce(input: {
  projectId: string
  runId: string
  round: number
  caseId: string
  taskId?: string
  mode: 'discovery' | 'validation'
  parsed: {
    metricsPath: string
    figurePath: string
    metricsSha256: string
    figureSha256: string
    result: LocalCoronalAnalysis
  }
}): Promise<LocalProcessingResult> {
  const identity = digest({
    runId: input.runId,
    round: input.round,
    caseId: input.caseId,
    mode: input.mode,
    processor: PROCESSOR_VERSION,
  }).slice(0, 16)
  const snapshotId = `snapshot-coronal-${identity}`
  const processingRunId = `processing-coronal-${identity}`
  const metricsArtifactId = `artifact-coronal-metrics-${identity}`
  const figureArtifactId = `artifact-coronal-figure-${identity}`
  const now = new Date().toISOString()
  const checksums = {
    manifest: input.parsed.result.manifestSha256,
    ...input.parsed.result.target.sampledChecksums,
    ...(input.parsed.result.baseline?.sampledChecksums ?? {}),
  }

  const existingSnapshots = await listDataSnapshots(input.projectId, { runId: input.runId })
  if (!existingSnapshots.some((item) => item.snapshotId === snapshotId)) {
    await createDataSnapshot(input.projectId, input.projectId, input.runId, {
      snapshotId,
      sourceIds: ['local:coronal-starter-v1'],
      manifestPath: input.parsed.result.manifestPath,
      checksums,
      selection: {
        caseId: input.caseId,
        mode: input.mode,
        roi: input.parsed.result.target.roi,
        usedObservationCount: input.parsed.result.target.usedObservationCount,
        sampleIds: input.parsed.result.target.sampleIds,
      },
      createdAt: now,
    })
  }

  const existingArtifacts = await listArtifacts(input.projectId, { runId: input.runId })
  if (!existingArtifacts.some((item) => item.artifactId === metricsArtifactId)) {
    await createArtifact(input.projectId, input.projectId, input.runId, {
      artifactId: metricsArtifactId,
      kind: 'metrics',
      path: input.parsed.metricsPath,
      checksum: input.parsed.metricsSha256,
      mediaType: 'application/json',
      generatedBy: 'explorer-coronal-diagnostics',
      processingRunId,
      sourceIds: ['local:coronal-starter-v1'],
      createdAt: now,
    })
  }
  if (!existingArtifacts.some((item) => item.artifactId === figureArtifactId)) {
    await createArtifact(input.projectId, input.projectId, input.runId, {
      artifactId: figureArtifactId,
      kind: 'figure',
      path: input.parsed.figurePath,
      checksum: input.parsed.figureSha256,
      mediaType: 'image/png',
      generatedBy: 'explorer-coronal-diagnostics',
      processingRunId,
      sourceIds: ['local:coronal-starter-v1'],
      createdAt: now,
    })
  }

  const existingRuns = await listProcessingRuns(input.projectId, { runId: input.runId })
  if (!existingRuns.some((item) => item.processingRunId === processingRunId)) {
    await createProcessingRun(input.projectId, {
      processingRunId,
      projectId: input.projectId,
      runId: input.runId,
      round: input.round,
      agentId: 'explorer-coronal-diagnostics',
      ...(input.taskId ? { taskId: input.taskId } : {}),
      triggeredBy: input.taskId ?? `round-${input.round}-phenomenon`,
      snapshotIds: [snapshotId],
      steps: [{
        stepId: `step-coronal-${identity}`,
        name: input.mode === 'validation' ? '验证轮 FITS 可观测量复测' : 'FITS 可观测量探索分析',
        tool: 'scripts/analyze_coronal_window.py',
        toolVersion: PROCESSOR_VERSION,
        codeVersion: input.parsed.result.scriptVersion,
        parameters: {
          caseId: input.caseId,
          mode: input.mode,
          roiSelection: 'AIA 193A robust temporal variability',
        },
        inputArtifactIds: [],
        outputArtifactIds: [metricsArtifactId, figureArtifactId],
        deterministic: true,
      }],
      deterministic: true,
      status: 'completed',
      outputArtifactIds: [metricsArtifactId, figureArtifactId],
      metricsArtifactId,
      limitations: input.parsed.result.limitations,
      fingerprint: digest({ snapshotId, caseId: input.caseId, mode: input.mode, version: PROCESSOR_VERSION }),
      startedAt: now,
      completedAt: now,
    })
  }

  return {
    analysis: input.parsed.result,
    processingRunId,
    snapshotId,
    metricsArtifactId,
    figureArtifactId,
    provenance: {
      processingRunId,
      dataSnapshotIds: [snapshotId],
      artifactIds: [metricsArtifactId, figureArtifactId],
      generatedBy: 'explorer-coronal-diagnostics',
      deterministic: true,
    },
  }
}

export async function runLocalCoronalProcessing(input: {
  projectId: string
  runId: string
  round: number
  caseId: string
  taskId?: string
  mode: 'discovery' | 'validation'
  signal?: AbortSignal
}): Promise<LocalProcessingResult> {
  const datasetRoot = resolve(getDatasetDir(), 'coronal-starter-v1')
  const manifestPath = resolve(datasetRoot, 'manifest.json')
  const outputDir = resolve(
    getProjectDir(input.projectId),
    'workspace',
    'scientific-processing',
    input.runId,
    `round-${input.round}`,
    input.caseId,
  )
  await mkdir(outputDir, { recursive: true })
  const { stdout } = await execFileAsync(
    process.env.PYTHON_EXECUTABLE || 'python',
    [
      processorScript(),
      '--manifest', manifestPath,
      '--dataset-root', datasetRoot,
      '--case-id', input.caseId,
      '--output-dir', outputDir,
      '--mode', input.mode,
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
      timeout: 8 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  )
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
  if (!line) throw new Error('local coronal processor returned no result')
  const parsed = JSON.parse(line) as {
    metricsPath: string
    figurePath: string
    metricsSha256: string
    figureSha256: string
    result: LocalCoronalAnalysis
  }
  return persistOnce({ ...input, parsed })
}

export async function verifyLocalEvidenceProvenance(
  projectId: string,
  evidence: EvidenceRecord,
): Promise<boolean> {
  const provenance = evidence.provenance
  if (!provenance) return evidence.status === 'unknown'
  const [runs, snapshots, artifacts] = await Promise.all([
    listProcessingRuns(projectId, { limit: 200 }),
    listDataSnapshots(projectId, { limit: 200 }),
    listArtifacts(projectId, { limit: 400 }),
  ])
  const run = runs.find((item) => item.processingRunId === provenance.processingRunId)
  if (!run || run.status !== 'completed' || !run.deterministic) return false
  if (!provenance.dataSnapshotIds.every((id) => snapshots.some((item) => item.snapshotId === id))) return false
  for (const artifactId of provenance.artifactIds) {
    const artifact = artifacts.find((item) => item.artifactId === artifactId)
    if (!artifact || artifact.processingRunId !== provenance.processingRunId) return false
    try {
      if (await fileSha256(artifact.path) !== artifact.checksum) return false
    } catch {
      return false
    }
  }
  return true
}
