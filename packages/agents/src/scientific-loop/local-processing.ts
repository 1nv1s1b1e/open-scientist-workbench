import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { getDatasetDir, getProjectDir, resolveRepoPath } from '@open-scientist/config'
import { getCoronalDatasetId, LOCAL_CORONAL_SOURCE_ID } from '@open-scientist/tools'
import {
  createArtifact,
  createDataSnapshot,
  createProcessingRun,
  getArtifact,
  getDataSnapshot,
  getProcessingRun,
  listArtifacts,
  listDataSnapshots,
  listProcessingRuns,
} from '@open-scientist/storage'
import type { EvidenceProvenance, EvidenceRecord } from '@open-scientist/schema'

const execFileAsync = promisify(execFile)
const PROCESSOR_VERSION = '5.3.0'
// Cold-cache WCS/DEM processing of the largest registered cases can take more
// than eight minutes on a busy workstation. Keep this below the demo's outer
// request budget while leaving enough headroom for a deterministic case to
// finish instead of being killed with only warning text on stderr.
const LOCAL_PROCESSOR_TIMEOUT_MS = 20 * 60 * 1000

type LocalAnalysisSplit = 'discovery' | 'validation' | 'holdout'

export interface ObservableDiagnostic {
  observableStatus: 'support' | 'unknown'
  boundary: string
  [key: string]: unknown
}

export interface LocalCoronalAnalysis {
  schemaVersion: number
  scriptVersion: string
  mode: LocalAnalysisSplit
  generatedAt: string
  manifestPath: string
  manifestSha256: string
  target: {
    caseId: string
    label: string
    activeRegion: string
    role?: string | null
    backgroundFor?: string | null
    roi: Record<string, unknown>
    channels: Record<string, Record<string, unknown>>
    comparisons: Record<string, Record<string, unknown>>
    alignment: {
      aiaRegistered: number
      aiaFallback: number
      hmiRegistered: number
      hmiUnregistered: number
      aiaWcsRegistrationReady: boolean
      hmiWcsRegistrationReady: boolean
      unifiedRoiReferenceBand: string
      roiCoordinateSystem: string
    }
    usedObservationCount: number
    sampleIds: string[]
    sampledChecksums: Record<string, string>
    readFailures: string[]
    vectorMagnetic?: Record<string, unknown>
  }
  baseline: null | {
    caseId: string
    label: string
    activeRegion: string
    role?: string | null
    backgroundFor?: string | null
    channels: Record<string, Record<string, unknown>>
    usedObservationCount: number
    sampleIds: string[]
    sampledChecksums: Record<string, string>
    readFailures: string[]
    vectorMagnetic?: Record<string, unknown>
  }
  diagnostics: {
    wave: ObservableDiagnostic
    reconnection: ObservableDiagnostic
    coupled: ObservableDiagnostic
    cooling_sequence: ObservableDiagnostic
    dem_temperature: ObservableDiagnostic
    magnetic_evolution: ObservableDiagnostic
    spatial_wave?: ObservableDiagnostic
    event_fluence_distribution?: ObservableDiagnostic
    vector_magnetic_evolution?: ObservableDiagnostic
    magnetic_thermal_association?: ObservableDiagnostic
    spectroscopy?: ObservableDiagnostic
  }
  preprocessing: {
    version: string
    targetMaximumPixels: number
    method: string
    cachePolicy: string
    requestedFrameLoads: number
    cacheHits: number
    cacheMisses: number
    cacheHitRate: number
    uniqueRawAssetsReferenced: number
    referencedRawBytes: number
    derivedBytesForReferencedAssets: number
    derivedToReferencedRatio: number | null
    datasetRawBytes: number
    datasetSupplementalRawBytes?: number
    datasetTotalRegisteredRawBytes?: number
    cacheEntryCount: number
    cacheTotalBytes: number
    cacheToDatasetRatio: number | null
    cacheReadFailures: string[]
    cacheWriteFailures: string[]
    qualityPolicy: string
    qualityRejectedFrames: number
    wcsMetadataRetained: boolean
    wcsRegistrationImplemented: boolean
    lossy: boolean
    rawRetentionRequired: boolean
    suitableFor: string[]
    notSuitableFor: string[]
  }
  dataSupplementAudit?: Array<Record<string, unknown>>
  analysisDesign: {
    split: LocalAnalysisSplit
    featureExtractorVersion: string
    parametersFrozen: boolean
    outcomeLabelsUsedForRoiSelection: boolean
    scientificResultFingerprint: string
    maximumSeriesFramesPerStream: number
    usesAllRegisteredFramesBelowCap: boolean
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
  /** Runtime selection purpose; it prevents cross-event tasks from relabelling validation data as holdout. */
  selectionPurpose?: 'primary' | 'cross_event'
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function nestedChecksums(value?: Record<string, unknown>): Record<string, string> {
  const candidate = value?.sampledChecksums
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {}
  return Object.fromEntries(
    Object.entries(candidate).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string' && entry[1].length > 0
    }),
  )
}

async function fileSha256(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
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
  mode: LocalAnalysisSplit
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
    caseId: input.caseId,
    mode: input.mode,
    processor: PROCESSOR_VERSION,
    manifestSha256: input.parsed.result.manifestSha256,
  }).slice(0, 16)
  const snapshotId = `snapshot-coronal-${identity}`
  const processingRunId = `processing-coronal-${identity}`
  const metricsArtifactId = `artifact-coronal-metrics-${identity}`
  const figureArtifactId = `artifact-coronal-figure-${identity}`
  const now = new Date().toISOString()
  const spectroscopyAssetId = input.parsed.result.diagnostics.spectroscopy?.sourceAssetId
  const spectroscopyAssetSha256 = input.parsed.result.diagnostics.spectroscopy?.sourceAssetSha256
  const checksums = {
    manifest: input.parsed.result.manifestSha256,
    ...input.parsed.result.target.sampledChecksums,
    ...nestedChecksums(input.parsed.result.target.vectorMagnetic),
    ...input.parsed.result.baseline?.sampledChecksums,
    ...nestedChecksums(input.parsed.result.baseline?.vectorMagnetic),
    ...(typeof spectroscopyAssetId === 'string' && typeof spectroscopyAssetSha256 === 'string'
      ? { [spectroscopyAssetId]: spectroscopyAssetSha256 }
      : {}),
  }

  const existingSnapshots = await listDataSnapshots(input.projectId, { runId: input.runId })
  if (!existingSnapshots.some((item) => item.snapshotId === snapshotId)) {
    await createDataSnapshot(input.projectId, input.projectId, input.runId, {
      snapshotId,
      sourceIds: [LOCAL_CORONAL_SOURCE_ID],
      manifestPath: input.parsed.result.manifestPath,
      checksums,
      selection: {
        caseId: input.caseId,
        mode: input.mode,
        roi: input.parsed.result.target.roi,
        preprocessing: input.parsed.result.preprocessing,
        dataSupplementAudit: input.parsed.result.dataSupplementAudit ?? [],
        vectorMagnetic: input.parsed.result.target.vectorMagnetic ?? null,
        analysisDesign: input.parsed.result.analysisDesign,
        usedObservationCount: input.parsed.result.target.usedObservationCount,
        sampleIds: input.parsed.result.target.sampleIds,
        supplementalSampleIds: typeof spectroscopyAssetId === 'string' ? [spectroscopyAssetId] : [],
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
      sourceIds: [LOCAL_CORONAL_SOURCE_ID],
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
      sourceIds: [LOCAL_CORONAL_SOURCE_ID],
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
      steps: [
        {
          stepId: `step-coronal-${identity}`,
          name:
            input.mode === 'holdout'
              ? '留出事件 FITS 冻结流程复测'
              : input.mode === 'validation'
                ? '验证轮 FITS 可观测量复测'
                : 'FITS 可观测量探索分析',
          tool: 'scripts/analyze_coronal_window.py',
          toolVersion: PROCESSOR_VERSION,
          codeVersion: input.parsed.result.scriptVersion,
          parameters: {
            caseId: input.caseId,
            mode: input.mode,
            roiSelection:
              'AIA 193A robust temporal variability on a frozen linear-WCS reference grid',
            wcsRegistration: input.parsed.result.target.alignment,
            preprocessingVersion: input.parsed.result.preprocessing.version,
            reducedFrameTarget: input.parsed.result.preprocessing.targetMaximumPixels,
            parametersFrozen: input.parsed.result.analysisDesign.parametersFrozen,
          },
          inputArtifactIds: [],
          outputArtifactIds: [metricsArtifactId, figureArtifactId],
          deterministic: true,
        },
      ],
      deterministic: true,
      status: 'completed',
      outputArtifactIds: [metricsArtifactId, figureArtifactId],
      metricsArtifactId,
      limitations: input.parsed.result.limitations,
      fingerprint: digest({
        snapshotId,
        caseId: input.caseId,
        mode: input.mode,
        version: PROCESSOR_VERSION,
        scientificResultFingerprint: input.parsed.result.analysisDesign.scientificResultFingerprint,
      }),
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
  mode: LocalAnalysisSplit
  signal?: AbortSignal
}): Promise<LocalProcessingResult> {
  const datasetRoot = resolve(getDatasetDir(), getCoronalDatasetId())
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
      '--manifest',
      manifestPath,
      '--dataset-root',
      datasetRoot,
      '--case-id',
      input.caseId,
      '--output-dir',
      outputDir,
      '--mode',
      input.mode,
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
      timeout: LOCAL_PROCESSOR_TIMEOUT_MS,
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
  // Primary-key lookups: paginated listings silently truncated on long runs
  // and made otherwise valid evidence fail verification.
  const run = await getProcessingRun(projectId, provenance.processingRunId)
  if (!run || run.status !== 'completed' || !run.deterministic) return false
  if (!provenance.dataSnapshotIds.every((id) => run.snapshotIds.includes(id))) return false
  if (!provenance.artifactIds.every((id) => run.outputArtifactIds.includes(id))) return false
  for (const snapshotId of provenance.dataSnapshotIds) {
    const snapshot = await getDataSnapshot(projectId, snapshotId)
    if (!snapshot) return false
  }
  for (const artifactId of provenance.artifactIds) {
    const artifact = await getArtifact(projectId, artifactId)
    if (!artifact || artifact.processingRunId !== provenance.processingRunId) return false
    try {
      if ((await fileSha256(resolveRepoPath(artifact.path))) !== artifact.checksum) return false
    } catch {
      return false
    }
  }
  return true
}
