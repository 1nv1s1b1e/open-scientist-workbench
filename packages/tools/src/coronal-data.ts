import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { getDatasetDir } from '@open-scientist/config'
import {
  EisSpectroscopyMetricsV2Schema,
  QuantitativeResultSchema,
  IrisReplicationV1Schema,
  NustarGeometryV2Schema,
  type QuantitativeResult,
} from '@open-scientist/schema'
import { tool } from 'ai'
import { z } from 'zod'

export const CORONAL_STARTER_DATASET_ID = 'coronal-starter-v1'

/** Select a verified pack without changing the scientific-loop API contract. */
export function getCoronalDatasetId(): string {
  return process.env.CORONAL_DATASET_ID?.trim() || CORONAL_STARTER_DATASET_ID
}

/** Stable source id for the pack selected when this process starts. */
export const LOCAL_CORONAL_SOURCE_ID = `local:${getCoronalDatasetId()}`

const ObservationSchema = z.object({
  logicalId: z.string().min(1),
  assetId: z.string().min(1),
  streamId: z.string().min(1),
  instrument: z.string().min(1),
  kind: z.string().min(1),
  wavelengthOrBand: z.string().nullable(),
  cadenceSeconds: z.number().int().positive(),
  observedAt: z.string().min(1),
  quality: z.string().min(1),
})

const CaseSchema = z.object({
  caseId: z.string().min(1),
  label: z.string().min(1),
  activeRegion: z.string().min(1),
  startTai: z.string().min(1),
  duration: z.string().min(1),
  purpose: z.string().min(1),
  role: z.string().min(1).optional(),
  backgroundFor: z.string().min(1).optional(),
  observations: z.array(ObservationSchema),
})

const AssetSchema = z.object({
  assetId: z.string().min(1),
  kind: z.string().min(1),
  instrument: z.string().min(1),
  segment: z.string().min(1),
  wavelengthOrBand: z.string().nullable(),
  observedAt: z.string().min(1),
  sourceUrl: z.string().url(),
  sourcePath: z.string().min(1),
  queries: z.array(z.string().min(1)).min(1),
  quality: z.string().min(1),
  caseIds: z.array(z.string().min(1)).min(1),
  logicalIds: z.array(z.string().min(1)).min(1),
  relativePath: z.string().min(1),
  bytes: z.number().int().positive(),
  sha256: z.string().nullable(),
  downloadStatus: z.enum(['planned', 'verified']),
})

const MetadataSupplementSchema = z.object({
  kind: z.string().min(1),
  format: z.string().min(1),
  relativePath: z.string().min(1),
  sha256: z.string().length(64),
  assetCount: z.number().int().nonnegative(),
  requestedAssetCount: z.number().int().nonnegative(),
  complete: z.boolean(),
  generatedAt: z.string().min(1),
})

const DataSupplementSchema = MetadataSupplementSchema.extend({
  bytes: z.number().int().nonnegative(),
})

const ManifestSchema = z.object({
  format: z.literal('open-scientist-coronal-observation-pack-v1'),
  datasetId: z.string().min(1),
  plannedTotalBytes: z.number().int().nonnegative(),
  uniqueAssetCount: z.number().int().nonnegative(),
  logicalObservationCount: z.number().int().nonnegative(),
  scientificBoundary: z.object({
    statement: z.string().min(1),
    knownGaps: z.array(z.string().min(1)),
  }),
  cases: z.array(CaseSchema).min(1),
  assets: z.array(AssetSchema).min(1),
  metadataSupplements: z.array(MetadataSupplementSchema).default([]),
  dataSupplements: z.array(DataSupplementSchema).default([]),
  supplementalBytes: z.number().int().nonnegative().default(0),
  totalBytesIncludingSupplements: z.number().int().nonnegative().optional(),
})

export const DerivedMetricsSchema = z.object({
  scriptVersion: z.string().min(1),
  target: z.object({
    alignment: z.object({
      aiaWcsRegistrationReady: z.boolean(),
      hmiWcsRegistrationReady: z.boolean(),
    }),
  }),
  diagnostics: z.object({
    cooling_sequence: z.object({ observableStatus: z.string().min(1), boundary: z.string() }),
    dem_temperature: z.object({ observableStatus: z.string().min(1), boundary: z.string() }),
    magnetic_evolution: z.object({ observableStatus: z.string().min(1), boundary: z.string() }),
    spatial_wave: z
      .object({ observableStatus: z.string().min(1), boundary: z.string() })
      .optional(),
    event_fluence_distribution: z
      .object({ observableStatus: z.string().min(1), boundary: z.string() })
      .optional(),
    vector_magnetic_evolution: z
      .object({ observableStatus: z.string().min(1), boundary: z.string() })
      .optional(),
    magnetic_thermal_association: z
      .object({ observableStatus: z.string().min(1), boundary: z.string() })
      .optional(),
    spectroscopy: z
      .object({ observableStatus: z.string().min(1), boundary: z.string() })
      .optional(),
  }),
  preprocessing: z.object({ version: z.string().min(1) }),
  analysisDesign: z.object({
    scientificResultFingerprint: z.string().length(64),
    split: z.enum(['discovery', 'validation', 'holdout']),
  }),
})

export type CoronalObservation = z.infer<typeof ObservationSchema>
export type CoronalObservationCase = z.infer<typeof CaseSchema>
export type CoronalObservationAsset = z.infer<typeof AssetSchema>
export type CoronalObservationManifest = z.infer<typeof ManifestSchema>

export interface CoronalDataCatalog {
  rootDir: string
  manifestPath: string
  manifest: CoronalObservationManifest
  assetsById: ReadonlyMap<string, CoronalObservationAsset>
}

export interface CoronalCaseSummary {
  caseId: string
  label: string
  activeRegion: string
  startTai: string
  duration: string
  purpose: string
  role?: string
  backgroundFor?: string
  verifiedAssetCount: number
  expectedAssetCount: number
  logicalObservationCount: number
  instruments: string[]
  wavelengthOrBands: string[]
  cadencesSeconds: number[]
  sampleAssetIds: string[]
}

export interface CoronalPackVerification {
  sourceId: string
  datasetId: string
  status: 'ready' | 'incomplete'
  /**
   * Lineage-local mode: the primary AIA/HMI pack is verified independently of
   * the data supplements. Local FITS evidence depends only on primary-pack
   * assets, so a failed supplement degrades its own lineage (and is disclosed
   * in diagnosticBoundaries) without invalidating the whole pack.
   */
  primaryPackReady: boolean
  expectedAssetCount: number
  verifiedAssetCount: number
  expectedBytes: number
  verifiedBytes: number
  missingAssetIds: string[]
  expectedMetadataSupplementCount: number
  verifiedMetadataSupplementCount: number
  invalidMetadataSupplements: string[]
  expectedDataSupplementCount: number
  verifiedDataSupplementCount: number
  expectedDataSupplementAssetCount: number
  verifiedDataSupplementAssetCount: number
  expectedDataSupplementBytes: number
  verifiedDataSupplementBytes: number
  invalidDataSupplements: string[]
  boundary: string
  knownGaps: string[]
}

export type CoronalRequirement =
  | 'thermal-evolution'
  | 'magnetic-context'
  | 'wave-timescale'
  | 'spectroscopy'
  | 'simulation'

export interface CoronalCoverage {
  sourceId: string
  datasetId: string
  caseId: string | null
  status: 'ready' | 'incomplete' | 'not-found'
  satisfied: CoronalRequirement[]
  unavailable: CoronalRequirement[]
  limitations: string[]
  case: CoronalCaseSummary | null
  derivedDiagnostics: CoronalDerivedDiagnostics
  cohortReadiness: CoronalCohortReadiness
}

export interface CoronalCohortReadiness {
  status: 'ready' | 'insufficient'
  claimLevel: 'thermal_process_only'
  eligibleCases: Array<{
    caseId: string
    activeRegion: string
    analysisSplit: 'validation' | 'holdout'
    diagnosticFamilies: string[]
  }>
  independentEventCount: number
  independentActiveRegionCount: number
  validationEventCount: number
  holdoutEventCount: number
  observableFamilies: string[]
  registeredPredictionPairing: {
    validation: ['hot_event_tail', 'dem_thermal_response']
    holdout: ['spectroscopy_relative_doppler', 'dem_thermal_response']
  }
  blindDiscovery: false
  boundary: string
}

export interface CoronalDerivedDiagnostics {
  status: 'ready' | 'missing' | 'invalid'
  relativePath: string
  scriptVersion?: string
  preprocessingVersion?: string
  scientificResultFingerprint?: string
  analysisSplit?: 'discovery' | 'validation' | 'holdout'
  aiaWcsRegistrationReady?: boolean
  hmiWcsRegistrationReady?: boolean
  coolingObservableStatus?: string
  demObservableStatus?: string
  magneticObservableStatus?: string
  spatialWaveObservableStatus?: string
  eventFluenceObservableStatus?: string
  vectorMagneticObservableStatus?: string
  magneticThermalAssociationObservableStatus?: string
  spectroscopyObservableStatus?: string
  availableCapabilities: string[]
  diagnosticBoundaries: string[]
  mechanismEvidencePermitted: false
}

function resolvePackRoot(datasetDir = getDatasetDir()): string {
  return resolve(datasetDir, getCoronalDatasetId())
}

function resolveAssetPath(rootDir: string, relativePath: string): string {
  const resolved = resolve(rootDir, relativePath)
  const pathWithinRoot = relative(rootDir, resolved)
  if (pathWithinRoot === '' || pathWithinRoot.startsWith('..') || isAbsolute(pathWithinRoot)) {
    throw new Error(`Invalid coronal data relative path: ${relativePath}`)
  }
  return resolved
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

export async function loadDerivedDiagnostics(
  catalog: CoronalDataCatalog,
  caseId: string,
): Promise<CoronalDerivedDiagnostics> {
  const relativePath = `derived/analysis-v4/${caseId}/coronal_metrics.json`
  try {
    const raw = JSON.parse(
      await readFile(resolveAssetPath(catalog.rootDir, relativePath), 'utf8'),
    ) as unknown
    const parsed = DerivedMetricsSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        status: 'invalid',
        relativePath,
        availableCapabilities: [],
        diagnosticBoundaries: ['派生诊断文件未通过结构校验，不能作为本轮观测结果。'],
        mechanismEvidencePermitted: false,
      }
    }
    const metrics = parsed.data
    return {
      status: 'ready',
      relativePath,
      scriptVersion: metrics.scriptVersion,
      preprocessingVersion: metrics.preprocessing.version,
      scientificResultFingerprint: metrics.analysisDesign.scientificResultFingerprint,
      analysisSplit: metrics.analysisDesign.split,
      aiaWcsRegistrationReady: metrics.target.alignment.aiaWcsRegistrationReady,
      hmiWcsRegistrationReady: metrics.target.alignment.hmiWcsRegistrationReady,
      coolingObservableStatus: metrics.diagnostics.cooling_sequence.observableStatus,
      demObservableStatus: metrics.diagnostics.dem_temperature.observableStatus,
      magneticObservableStatus: metrics.diagnostics.magnetic_evolution.observableStatus,
      spatialWaveObservableStatus: metrics.diagnostics.spatial_wave?.observableStatus,
      eventFluenceObservableStatus:
        metrics.diagnostics.event_fluence_distribution?.observableStatus,
      vectorMagneticObservableStatus:
        metrics.diagnostics.vector_magnetic_evolution?.observableStatus,
      magneticThermalAssociationObservableStatus:
        metrics.diagnostics.magnetic_thermal_association?.observableStatus,
      spectroscopyObservableStatus: metrics.diagnostics.spectroscopy?.observableStatus,
      availableCapabilities: [
        'AIA/HMI WCS co-registration to a frozen 193 A ROI',
        'six-channel ROI-median regularized DEM',
        'pre-registered positive-lag cooling diagnostic with Holm correction',
        'projected HMI LOS flux, gradient and PIL diagnostics',
        ...(metrics.diagnostics.spatial_wave
          ? ['automatic-ROI spatial phase coherence and apparent time-distance propagation']
          : []),
        ...(metrics.diagnostics.event_fluence_distribution
          ? ['94/131 A relative event-fluence catalog and finite-tail fit']
          : []),
        ...(metrics.diagnostics.vector_magnetic_evolution
          ? ['HMI SHARP CEA vector-field, vertical-current and uncertainty proxies']
          : []),
        ...(metrics.diagnostics.magnetic_thermal_association
          ? ['circular-shift AIA hot-event versus SHARP magnetic-rate association']
          : []),
        ...(metrics.diagnostics.spectroscopy
          ? ['event-matched IRIS Level-2 relative Doppler diagnostic']
          : []),
      ],
      diagnosticBoundaries: unique([
        metrics.diagnostics.cooling_sequence.boundary,
        metrics.diagnostics.dem_temperature.boundary,
        metrics.diagnostics.magnetic_evolution.boundary,
        ...(metrics.diagnostics.spatial_wave ? [metrics.diagnostics.spatial_wave.boundary] : []),
        ...(metrics.diagnostics.event_fluence_distribution
          ? [metrics.diagnostics.event_fluence_distribution.boundary]
          : []),
        ...(metrics.diagnostics.vector_magnetic_evolution
          ? [metrics.diagnostics.vector_magnetic_evolution.boundary]
          : []),
        ...(metrics.diagnostics.magnetic_thermal_association
          ? [metrics.diagnostics.magnetic_thermal_association.boundary]
          : []),
        ...(metrics.diagnostics.spectroscopy ? [metrics.diagnostics.spectroscopy.boundary] : []),
      ]),
      mechanismEvidencePermitted: false,
    }
  } catch {
    return {
      status: 'missing',
      relativePath,
      availableCapabilities: [],
      diagnosticBoundaries: ['尚未生成该窗口的确定性派生诊断。'],
      mechanismEvidencePermitted: false,
    }
  }
}

async function assessCoronalCohortReadiness(
  catalog: CoronalDataCatalog,
  requiredLineagesReady: boolean,
): Promise<CoronalCohortReadiness> {
  const eligibleCases: CoronalCohortReadiness['eligibleCases'] = []
  for (const item of catalog.manifest.cases) {
    if (item.role === 'background_control' || item.role === 'discovery') continue
    const derived = await loadDerivedDiagnostics(catalog, item.caseId)
    if (derived.status !== 'ready') continue
    const diagnosticFamilies: string[] = []
    if (derived.eventFluenceObservableStatus === 'support')
      diagnosticFamilies.push('hot_event_tail')
    if (derived.coolingObservableStatus === 'support') diagnosticFamilies.push('ordered_cooling')
    if (derived.demObservableStatus === 'support') diagnosticFamilies.push('dem_thermal_response')
    if (derived.spectroscopyObservableStatus === 'support') diagnosticFamilies.push('spectroscopy')
    const hasImpulsiveOrFlowSignature =
      diagnosticFamilies.includes('hot_event_tail') || diagnosticFamilies.includes('spectroscopy')
    const hasIndependentThermalResponse =
      diagnosticFamilies.includes('ordered_cooling') ||
      diagnosticFamilies.includes('dem_thermal_response')
    if (!hasImpulsiveOrFlowSignature || !hasIndependentThermalResponse) continue
    const analysisSplit = derived.analysisSplit
    if (analysisSplit !== 'validation' && analysisSplit !== 'holdout') continue
    eligibleCases.push({
      caseId: item.caseId,
      activeRegion: item.activeRegion,
      analysisSplit,
      diagnosticFamilies,
    })
  }
  const independentActiveRegionCount = new Set(eligibleCases.map((item) => item.activeRegion)).size
  const validationEventCount = eligibleCases.filter(
    (item) => item.analysisSplit === 'validation',
  ).length
  const holdoutEventCount = eligibleCases.filter((item) => item.analysisSplit === 'holdout').length
  const observableFamilies = unique(eligibleCases.flatMap((item) => item.diagnosticFamilies)).sort()
  const ready =
    requiredLineagesReady &&
    eligibleCases.length >= 3 &&
    independentActiveRegionCount >= 3 &&
    validationEventCount >= 2 &&
    holdoutEventCount >= 1 &&
    observableFamilies.includes('hot_event_tail') &&
    observableFamilies.includes('dem_thermal_response') &&
    observableFamilies.includes('spectroscopy')
  return {
    status: ready ? 'ready' : 'insufficient',
    claimLevel: 'thermal_process_only',
    eligibleCases,
    independentEventCount: eligibleCases.length,
    independentActiveRegionCount,
    validationEventCount,
    holdoutEventCount,
    observableFamilies,
    registeredPredictionPairing: {
      validation: ['hot_event_tail', 'dem_thermal_response'],
      holdout: ['spectroscopy_relative_doppler', 'dem_thermal_response'],
    },
    blindDiscovery: false,
    boundary:
      '这只是生成跨事件热过程候选的可执行性清单，不是支持证据。所有案例均为外部文献引导选择或正控/留出复现，后续必须重新执行确定性处理、绑定原子预测并通过证据门槛；不得据此支持具体磁重联、纳耀斑、波动或耦合机制。',
  }
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/noaa|ar/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

function matchingScore(
  item: CoronalObservationCase,
  activeRegion?: string,
  query?: string,
): number {
  const haystack = normalized([item.caseId, item.label, item.activeRegion, item.purpose].join(' '))
  let score = 0
  for (const value of [activeRegion, query]) {
    if (!value) continue
    const needle = normalized(value)
    if (needle.length > 0 && haystack.includes(needle)) score += 10
  }
  return score
}

export async function loadCoronalDataCatalog(datasetDir?: string): Promise<CoronalDataCatalog> {
  const rootDir = resolvePackRoot(datasetDir)
  const manifestPath = resolve(rootDir, 'manifest.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot load ${getCoronalDatasetId()} manifest: ${detail}`)
  }
  const manifest = ManifestSchema.parse(parsed)
  if (manifest.uniqueAssetCount !== manifest.assets.length) {
    throw new Error('Coronal manifest uniqueAssetCount does not match the asset list')
  }
  if (manifest.plannedTotalBytes !== manifest.assets.reduce((sum, item) => sum + item.bytes, 0)) {
    throw new Error('Coronal manifest plannedTotalBytes does not match asset byte counts')
  }
  const supplementalBytes = manifest.dataSupplements.reduce((sum, item) => sum + item.bytes, 0)
  if (manifest.supplementalBytes !== supplementalBytes) {
    throw new Error('Coronal manifest supplementalBytes does not match data supplements')
  }
  if (
    manifest.totalBytesIncludingSupplements !== undefined &&
    manifest.totalBytesIncludingSupplements !== manifest.plannedTotalBytes + supplementalBytes
  ) {
    throw new Error('Coronal manifest totalBytesIncludingSupplements is inconsistent')
  }
  const assetsById = new Map(manifest.assets.map((asset) => [asset.assetId, asset]))
  if (assetsById.size !== manifest.assets.length) {
    throw new Error('Coronal manifest contains duplicate asset ids')
  }
  return { rootDir, manifestPath, manifest, assetsById }
}

function isVerified(asset: CoronalObservationAsset): boolean {
  return (
    asset.downloadStatus === 'verified' &&
    typeof asset.sha256 === 'string' &&
    asset.sha256.length > 0
  )
}

export function summarizeCoronalCase(
  catalog: CoronalDataCatalog,
  item: CoronalObservationCase,
): CoronalCaseSummary {
  const assetIds = unique(item.observations.map((observation) => observation.assetId))
  const assets = assetIds
    .map((assetId) => catalog.assetsById.get(assetId))
    .filter((asset): asset is CoronalObservationAsset => asset !== undefined)
  const verifiedAssetCount = assets.filter(isVerified).length
  return {
    caseId: item.caseId,
    label: item.label,
    activeRegion: item.activeRegion,
    startTai: item.startTai,
    duration: item.duration,
    purpose: item.purpose,
    ...(item.role ? { role: item.role } : {}),
    ...(item.backgroundFor ? { backgroundFor: item.backgroundFor } : {}),
    verifiedAssetCount,
    expectedAssetCount: assetIds.length,
    logicalObservationCount: item.observations.length,
    instruments: unique(item.observations.map((observation) => observation.instrument)).sort(),
    wavelengthOrBands: unique(
      item.observations
        .map((observation) => observation.wavelengthOrBand)
        .filter((value): value is string => value !== null),
    ).sort(),
    cadencesSeconds: unique(
      item.observations.map((observation) => observation.cadenceSeconds),
    ).sort((left, right) => left - right),
    sampleAssetIds: assetIds.slice(0, 8),
  }
}

export async function searchCoronalObservationCases(input: {
  activeRegion?: string
  query?: string
  limit?: number
  datasetDir?: string
}): Promise<{ sourceId: string; datasetId: string; cases: CoronalCaseSummary[] }> {
  const catalog = await loadCoronalDataCatalog(input.datasetDir)
  const hasFilter = Boolean(input.activeRegion || input.query)
  const ranked = catalog.manifest.cases
    .map((item) => ({ item, score: matchingScore(item, input.activeRegion, input.query) }))
    .filter((entry) => !hasFilter || entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        summarizeCoronalCase(catalog, right.item).logicalObservationCount -
          summarizeCoronalCase(catalog, left.item).logicalObservationCount ||
        left.item.caseId.localeCompare(right.item.caseId),
    )
    .slice(0, input.limit ?? 3)
    .map((entry) => summarizeCoronalCase(catalog, entry.item))
  return { sourceId: LOCAL_CORONAL_SOURCE_ID, datasetId: catalog.manifest.datasetId, cases: ranked }
}

export async function verifyCoronalDataPack(datasetDir?: string): Promise<CoronalPackVerification> {
  const catalog = await loadCoronalDataCatalog(datasetDir)
  const missingAssetIds: string[] = []
  let verifiedAssetCount = 0
  let verifiedBytes = 0
  for (const asset of catalog.manifest.assets) {
    if (!isVerified(asset)) {
      missingAssetIds.push(asset.assetId)
      continue
    }
    try {
      const file = await stat(resolveAssetPath(catalog.rootDir, asset.relativePath))
      if (!file.isFile() || file.size !== asset.bytes) {
        missingAssetIds.push(asset.assetId)
        continue
      }
      verifiedAssetCount += 1
      verifiedBytes += asset.bytes
    } catch {
      missingAssetIds.push(asset.assetId)
    }
  }
  const hmi720Assets = catalog.manifest.assets.filter((asset) =>
    asset.queries.some((query) => query.startsWith('hmi.M_720s[')),
  )
  const hmiMetadata = catalog.manifest.metadataSupplements.find(
    (item) => item.kind === 'jsoc-hmi-record-metadata',
  )
  const invalidMetadataSupplements: string[] = []
  let verifiedMetadataSupplementCount = 0
  for (const supplement of catalog.manifest.metadataSupplements) {
    try {
      const content = await readFile(resolveAssetPath(catalog.rootDir, supplement.relativePath))
      const digest = createHash('sha256').update(content).digest('hex')
      if (!supplement.complete || digest !== supplement.sha256) {
        invalidMetadataSupplements.push(supplement.kind)
        continue
      }
      if (supplement.kind === 'jsoc-hmi-record-metadata') {
        const metadata = JSON.parse(content.toString('utf8')) as Record<string, unknown>
        const assets = metadata.assets
        const missingAssetIds = metadata.missingAssetIds
        const queryFailures = metadata.queryFailures
        const metadataAssetCount =
          assets !== null && typeof assets === 'object' ? Object.keys(assets).length : -1
        if (
          supplement.format !== 'open-scientist-jsoc-hmi-record-metadata-v1' ||
          metadata.format !== supplement.format ||
          metadata.datasetId !== catalog.manifest.datasetId ||
          metadataAssetCount !== supplement.assetCount ||
          supplement.assetCount !== hmi720Assets.length ||
          supplement.requestedAssetCount !== hmi720Assets.length ||
          !Array.isArray(missingAssetIds) ||
          missingAssetIds.length > 0 ||
          !Array.isArray(queryFailures) ||
          queryFailures.length > 0
        ) {
          invalidMetadataSupplements.push(supplement.kind)
          continue
        }
      }
      verifiedMetadataSupplementCount += 1
    } catch {
      invalidMetadataSupplements.push(supplement.kind)
    }
  }
  if (hmi720Assets.length > 0 && !hmiMetadata) {
    invalidMetadataSupplements.push('jsoc-hmi-record-metadata')
  }
  const uniqueInvalidMetadataSupplements = unique(invalidMetadataSupplements)
  const invalidDataSupplements: string[] = []
  let verifiedDataSupplementCount = 0
  let verifiedDataSupplementAssetCount = 0
  let verifiedDataSupplementBytes = 0
  for (const supplement of catalog.manifest.dataSupplements) {
    try {
      const content = await readFile(resolveAssetPath(catalog.rootDir, supplement.relativePath))
      const manifestDigest = createHash('sha256').update(content).digest('hex')
      if (!supplement.complete || manifestDigest !== supplement.sha256) {
        invalidDataSupplements.push(supplement.kind)
        continue
      }
      const payload = JSON.parse(content.toString('utf8')) as Record<string, unknown>
      const assets = Array.isArray(payload.assets)
        ? (payload.assets as Array<Record<string, unknown>>)
        : []
      if (
        payload.format !== supplement.format ||
        payload.complete !== true ||
        assets.length !== supplement.assetCount ||
        payload.assetCount !== supplement.assetCount ||
        payload.plannedTotalBytes !== supplement.bytes
      ) {
        invalidDataSupplements.push(supplement.kind)
        continue
      }
      let supplementVerifiedAssets = 0
      let supplementVerifiedBytes = 0
      for (const asset of assets) {
        const relativePath = typeof asset.relativePath === 'string' ? asset.relativePath : ''
        const bytes = typeof asset.bytes === 'number' ? asset.bytes : -1
        const sha256 = typeof asset.sha256 === 'string' ? asset.sha256 : ''
        if (
          relativePath.length === 0 ||
          !Number.isInteger(bytes) ||
          bytes <= 0 ||
          sha256.length !== 64 ||
          asset.downloadStatus !== 'verified'
        ) {
          continue
        }
        try {
          const file = await stat(resolveAssetPath(catalog.rootDir, relativePath))
          if (file.isFile() && file.size === bytes) {
            supplementVerifiedAssets += 1
            supplementVerifiedBytes += bytes
          }
        } catch {
          // Counted below as an incomplete supplement.
        }
      }
      verifiedDataSupplementAssetCount += supplementVerifiedAssets
      verifiedDataSupplementBytes += supplementVerifiedBytes
      if (
        supplementVerifiedAssets !== supplement.assetCount ||
        supplementVerifiedBytes !== supplement.bytes
      ) {
        invalidDataSupplements.push(supplement.kind)
        continue
      }
      verifiedDataSupplementCount += 1
    } catch {
      invalidDataSupplements.push(supplement.kind)
    }
  }
  const uniqueInvalidDataSupplements = unique(invalidDataSupplements)
  return {
    sourceId: LOCAL_CORONAL_SOURCE_ID,
    datasetId: catalog.manifest.datasetId,
    primaryPackReady: missingAssetIds.length === 0 && uniqueInvalidMetadataSupplements.length === 0,
    status:
      missingAssetIds.length === 0 &&
      uniqueInvalidMetadataSupplements.length === 0 &&
      uniqueInvalidDataSupplements.length === 0
        ? 'ready'
        : 'incomplete',
    expectedAssetCount: catalog.manifest.assets.length,
    verifiedAssetCount,
    expectedBytes: catalog.manifest.plannedTotalBytes,
    verifiedBytes,
    missingAssetIds: missingAssetIds.slice(0, 20),
    expectedMetadataSupplementCount:
      catalog.manifest.metadataSupplements.length +
      (hmi720Assets.length > 0 && !hmiMetadata ? 1 : 0),
    verifiedMetadataSupplementCount,
    invalidMetadataSupplements: uniqueInvalidMetadataSupplements,
    expectedDataSupplementCount: catalog.manifest.dataSupplements.length,
    verifiedDataSupplementCount,
    expectedDataSupplementAssetCount: catalog.manifest.dataSupplements.reduce(
      (sum, item) => sum + item.assetCount,
      0,
    ),
    verifiedDataSupplementAssetCount,
    expectedDataSupplementBytes: catalog.manifest.supplementalBytes,
    verifiedDataSupplementBytes,
    invalidDataSupplements: uniqueInvalidDataSupplements,
    boundary: catalog.manifest.scientificBoundary.statement,
    knownGaps: catalog.manifest.scientificBoundary.knownGaps,
  }
}

export async function assessCoronalDataCoverage(input: {
  activeRegion?: string
  query?: string
  caseId?: string
  requirements?: CoronalRequirement[]
  datasetDir?: string
}): Promise<CoronalCoverage> {
  const catalog = await loadCoronalDataCatalog(input.datasetDir)
  const pack = await verifyCoronalDataPack(input.datasetDir)
  const jointSpectroscopyLineageReady = !pack.invalidDataSupplements.some((kind) =>
    kind.startsWith('joint-spectroscopy-'),
  )
  const cohortReadiness = await assessCoronalCohortReadiness(
    catalog,
    pack.primaryPackReady && jointSpectroscopyLineageReady,
  )
  const requested: CoronalRequirement[] = input.requirements?.length
    ? unique(input.requirements)
    : ['thermal-evolution', 'magnetic-context']
  let selected: CoronalObservationCase | undefined
  if (input.caseId) selected = catalog.manifest.cases.find((item) => item.caseId === input.caseId)
  if (!selected) {
    selected = catalog.manifest.cases
      .map((item) => ({ item, score: matchingScore(item, input.activeRegion, input.query) }))
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          summarizeCoronalCase(catalog, right.item).logicalObservationCount -
            summarizeCoronalCase(catalog, left.item).logicalObservationCount ||
          left.item.caseId.localeCompare(right.item.caseId),
      )[0]?.item
  }
  if (!selected) {
    return {
      sourceId: LOCAL_CORONAL_SOURCE_ID,
      datasetId: catalog.manifest.datasetId,
      caseId: null,
      status: 'not-found',
      satisfied: [],
      unavailable: requested,
      limitations: ['本地数据包中没有与当前活动区或现象匹配的观测窗口。'],
      case: null,
      derivedDiagnostics: {
        status: 'missing',
        relativePath: '',
        availableCapabilities: [],
        diagnosticBoundaries: ['没有匹配窗口，无法加载派生诊断。'],
        mechanismEvidencePermitted: false,
      },
      cohortReadiness,
    }
  }
  const summary = summarizeCoronalCase(catalog, selected)
  const derivedDiagnostics = await loadDerivedDiagnostics(catalog, selected.caseId)
  const bands = new Set(summary.wavelengthOrBands)
  const hasCoreThermal = ['94 Å', '131 Å', '171 Å', '193 Å', '211 Å', '335 Å'].every((band) =>
    bands.has(band),
  )
  const hasMagnetic = summary.instruments.includes('SDO/HMI')
  const hasFastTwoBand =
    summary.cadencesSeconds.some((cadence) => cadence <= 30) &&
    bands.has('171 Å') &&
    bands.has('193 Å')
  const packHasSpectroscopy = catalog.manifest.dataSupplements.some(
    (supplement) =>
      supplement.kind.startsWith('joint-spectroscopy-') &&
      supplement.complete &&
      jointSpectroscopyLineageReady,
  )
  let hasSpectroscopy = false
  for (const supplement of catalog.manifest.dataSupplements) {
    if (!supplement.kind.startsWith('joint-spectroscopy-') || !supplement.complete) continue
    try {
      const payload = JSON.parse(
        await readFile(resolveAssetPath(catalog.rootDir, supplement.relativePath), 'utf8'),
      ) as Record<string, unknown>
      const assets = Array.isArray(payload.assets)
        ? (payload.assets as Array<Record<string, unknown>>)
        : []
      const hasIrisLevel2 = assets.some(
        (asset) => asset.instrument === 'IRIS' && asset.productLevel === 'level2',
      )
      if (
        payload.complete === true &&
        payload.caseId === selected.caseId &&
        payload.analysisSplit === 'holdout' &&
        hasIrisLevel2
      ) {
        hasSpectroscopy = true
      }
    } catch {
      // The pack verifier reports malformed or missing supplements.
    }
  }
  const supported = new Set<CoronalRequirement>()
  // Lineage-local integrity: an unrelated optional supplement must not erase
  // otherwise verified primary AIA/HMI capabilities. Spectroscopy additionally
  // requires its own registered supplement lineage to pass verification.
  if (pack.primaryPackReady && hasCoreThermal) supported.add('thermal-evolution')
  if (pack.primaryPackReady && hasMagnetic) supported.add('magnetic-context')
  if (pack.primaryPackReady && hasFastTwoBand) supported.add('wave-timescale')
  if (pack.primaryPackReady && jointSpectroscopyLineageReady && hasSpectroscopy) {
    supported.add('spectroscopy')
  }
  const satisfied = requested.filter((requirement) => supported.has(requirement))
  const unavailable = requested.filter((requirement) => !supported.has(requirement))
  const limitations = catalog.manifest.scientificBoundary.knownGaps.filter(
    (gap) => !(packHasSpectroscopy && /spectroscop|光谱|Doppler|line-width/i.test(gap)),
  )
  if (!pack.primaryPackReady) {
    limitations.unshift('本地主观测包完整性未通过，不能用于本轮分析。')
  } else if (pack.invalidDataSupplements.length > 0) {
    limitations.unshift(
      `部分可选补充谱系未通过完整性校验（${pack.invalidDataSupplements.join('、')}）；仅禁用受影响的补充诊断，已核验的 AIA/HMI 主谱系仍可使用。`,
    )
  }
  if (unavailable.includes('spectroscopy'))
    limitations.push(
      packHasSpectroscopy
        ? '当前匹配案例没有事件匹配的光谱或非热展宽诊断；数据包其他案例的光谱不能移作本案例证据。'
        : '当前包没有光谱或非热展宽诊断。',
    )
  if (unavailable.includes('simulation'))
    limitations.push('当前包没有与观测同化的 MHD 数值模拟产物。')
  return {
    sourceId: LOCAL_CORONAL_SOURCE_ID,
    datasetId: catalog.manifest.datasetId,
    caseId: selected.caseId,
    status: pack.status,
    satisfied,
    unavailable,
    limitations: unique(limitations),
    case: summary,
    derivedDiagnostics,
    cohortReadiness,
  }
}

export async function getCoronalObservationAsset(input: {
  assetId: string
  datasetDir?: string
}): Promise<Record<string, unknown> | null> {
  const catalog = await loadCoronalDataCatalog(input.datasetDir)
  const asset = catalog.assetsById.get(input.assetId)
  if (!asset) return null
  const localPath = resolveAssetPath(catalog.rootDir, asset.relativePath)
  return {
    assetId: asset.assetId,
    instrument: asset.instrument,
    segment: asset.segment,
    wavelengthOrBand: asset.wavelengthOrBand,
    observedAt: asset.observedAt,
    quality: asset.quality,
    bytes: asset.bytes,
    sha256: asset.sha256,
    downloadStatus: asset.downloadStatus,
    relativePath: asset.relativePath,
    localPath,
    sourceUrl: asset.sourceUrl,
    queries: asset.queries,
    caseIds: asset.caseIds,
  }
}

const SearchInputSchema = z.object({
  activeRegion: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(6).default(3),
})

export const searchLocalSolarDataTool = tool({
  description:
    '在已校验的本地 SDO 日冕观测包中检索活动区窗口。只返回数据覆盖和可追溯索引，不解释图像或生成机制结论。',
  inputSchema: SearchInputSchema,
  execute: async (input) => searchCoronalObservationCases(input),
})

export const checkLocalSolarCoverageTool = tool({
  description:
    '检查本地观测包是否覆盖指定活动区的多波段热演化、磁场背景、波动时标、光谱或模拟需求，并返回只用于生成受限跨事件热过程候选的 cohortReadiness。缺失诊断必须被保留为限制条件；readiness 本身不是证据。',
  inputSchema: z.object({
    activeRegion: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    caseId: z.string().min(1).optional(),
    requirements: z
      .array(
        z.enum([
          'thermal-evolution',
          'magnetic-context',
          'wave-timescale',
          'spectroscopy',
          'simulation',
        ]),
      )
      .min(1)
      .max(5)
      .default(['thermal-evolution', 'magnetic-context']),
  }),
  execute: async (input) => assessCoronalDataCoverage(input),
})

// ── Registered supplement analysis products ──────────────────────────────
// The targeted-discriminants supplement registers frozen derived products
// (EIS CHIANTI density spectroscopy, NuSTAR solar-geometry count-rate chain,
// IRIS method replication) whose Python side stamps every record with
// `mechanismEvidencePermitted: false`. The reading layer below gives the
// scientific loop visibility into those products WITHOUT granting them
// gate-ready support status: evidence built from them stays `unknown` /
// `diagnostic_boundary` (positive-control description), and the boundaries
// travel with the record.

const SupplementManifestSchema = z.object({
  format: z.string().min(1),
  kind: z.string().min(1),
  complete: z.boolean(),
  calibrationRegistryComplete: z.boolean().optional(),
  analysisProducts: z
    .array(
      z.object({
        kind: z.string().min(1),
        caseId: z.string().min(1).nullable().optional(),
        relativePath: z.string().min(1),
        sha256: z.string().length(64),
        analysisVersion: z.string().min(1),
        inputAssetIds: z.array(z.string().min(1)).default([]),
        mechanismEvidencePermitted: z.boolean(),
        generatedAt: z.string().min(1),
      }),
    )
    .default([]),
})

export interface SupplementAnalysisProductRecord {
  kind: string
  caseId: string | null
  analysisVersion: string
  relativePath: string
  registeredSha256: string
  fileSha256Matches: boolean
  inputAssetIds: string[]
  mechanismEvidencePermitted: boolean
  evidenceRole: string
  boundaries: string[]
  quantitativeResults: QuantitativeResult[]
}

export interface SupplementAnalysisDiagnostics {
  status: 'ready' | 'missing' | 'invalid'
  manifestPath: string
  productCount: number
  products: SupplementAnalysisProductRecord[]
  availableCapabilities: string[]
  diagnosticBoundaries: string[]
  mechanismEvidencePermitted: false
}

function asQuantitativeResult(
  metric: string,
  interval: { estimate: number; lowerBound: number; upperBound: number },
  unit?: string,
): QuantitativeResult {
  return {
    metric,
    estimate: interval.estimate,
    lowerBound: interval.lowerBound,
    upperBound: interval.upperBound,
    confidenceLevel: 0.95,
    ...(unit ? { unit } : {}),
  }
}

/** Map registered supplement products onto audited quantitative results. */
export function supplementProductQuantitativeResults(
  kind: string,
  payload: unknown,
): QuantitativeResult[] {
  const results: QuantitativeResult[] = []
  if (kind.startsWith('eis-versioned-line-fitting')) {
    const parsed = EisSpectroscopyMetricsV2Schema.safeParse(payload)
    if (!parsed.success) return results
    const metrics = parsed.data
    results.push(
      asQuantitativeResult(
        'eis_six_258_261_intensity_ratio',
        metrics.siX258To261IntensityRatio,
        '1',
      ),
    )
    results.push({
      metric: 'eis_six_log10_electron_density',
      estimate: metrics.electronDensityCm3.log10Estimate,
      lowerBound: metrics.electronDensityCm3.log10LowerBound,
      upperBound: metrics.electronDensityCm3.log10UpperBound,
      confidenceLevel: 0.95,
      unit: 'log10(cm^-3)',
    })
    for (const [line, fit] of Object.entries(metrics.lines)) {
      results.push(
        asQuantitativeResult(
          `eis_${line}_relative_doppler_velocity`,
          fit.relativeDopplerVelocityKmPerSecond,
          'km/s',
        ),
      )
      if (fit.nonthermalVelocityKmPerSecond) {
        results.push(
          asQuantitativeResult(
            `eis_${line}_nonthermal_velocity`,
            fit.nonthermalVelocityKmPerSecond,
            'km/s',
          ),
        )
      }
    }
    return results
  }
  if (kind.startsWith('nustar-hxr-solar-geometry')) {
    const parsed = NustarGeometryV2Schema.safeParse(payload)
    if (!parsed.success) return results
    for (const observation of parsed.data.observations) {
      for (const [band, geometry] of Object.entries(observation.geometry.bands ?? {})) {
        // A non-detection carries a real one-sided exact-Poisson upper limit;
        // detected excesses stay in `metrics` because the registered product
        // provides a significance, not a symmetric rate interval.
        if (!geometry.detection && typeof geometry.countRateUpperLimitPerSecond === 'number') {
          results.push({
            metric: `nustar_${observation.obsid}_${observation.module}_${band}_count_rate_upper_limit`,
            estimate: 0,
            lowerBound: 0,
            upperBound: geometry.countRateUpperLimitPerSecond,
            confidenceLevel: 0.99865,
            unit: 'count/s',
          })
        }
      }
    }
    return results
  }
  if (
    kind.startsWith('hxr-flux-limit') ||
    kind.startsWith('wave-energy-closure') ||
    kind.startsWith('loop-scaling-forward') ||
    kind.startsWith('magnetic-energy-budget')
  ) {
    // Versioned v2+ supplement products carry their own contract-valid
    // quantitativeResults; pass them through after schema validation.
    const raw = (payload as { quantitativeResults?: unknown }).quantitativeResults
    const parsed = z.array(QuantitativeResultSchema).safeParse(raw ?? [])
    return parsed.success ? parsed.data : []
  }
  if (kind.startsWith('iris-method-replication')) {
    const parsed = IrisReplicationV1Schema.safeParse(payload)
    if (!parsed.success) return results
    const interval = parsed.data.velocityInterval95KmPerSecond
    if (interval) {
      results.push(
        asQuantitativeResult(
          `iris_${parsed.data.caseId}_siiv_bright_minus_reference_velocity`,
          interval,
          'km/s',
        ),
      )
    }
    return results
  }
  return results
}

/**
 * Load, hash-verify and contract-parse every registered supplement analysis
 * product. A checksum mismatch or contract failure marks the single product
 * `invalid` via `fileSha256Matches=false` / an empty quantitative list while
 * keeping the remaining products readable.
 */
export async function loadSupplementAnalysisDiagnostics(
  datasetDir?: string,
): Promise<SupplementAnalysisDiagnostics> {
  const rootDir = resolve(datasetDir ?? getDatasetDir(), getCoronalDatasetId())
  const manifestPath = resolve(rootDir, 'supplements/targeted-discriminants-v1/manifest.json')
  const invalid: SupplementAnalysisDiagnostics = {
    status: 'missing',
    manifestPath,
    productCount: 0,
    products: [],
    availableCapabilities: [],
    diagnosticBoundaries: ['定向补充派生产物未找到，光谱/硬X射线正控证据不可用。'],
    mechanismEvidencePermitted: false,
  }
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    return invalid
  }
  const parsedManifest = SupplementManifestSchema.safeParse(raw)
  if (!parsedManifest.success || parsedManifest.data.analysisProducts.length === 0) {
    return { ...invalid, status: 'invalid' }
  }
  const products: SupplementAnalysisProductRecord[] = []
  for (const entry of parsedManifest.data.analysisProducts) {
    let fileSha256Matches = false
    let payload: unknown
    let evidenceRole = entry.kind
    const boundaries: string[] = []
    let quantitativeResults: QuantitativeResult[] = []
    let mechanismEvidencePermitted = entry.mechanismEvidencePermitted
    try {
      const productPath = resolve(rootDir, entry.relativePath)
      const bytes = await readFile(productPath)
      const digest = createHash('sha256').update(bytes).digest('hex')
      fileSha256Matches = digest === entry.sha256
      payload = JSON.parse(bytes.toString('utf8')) as unknown
      // Product-boundary fields live inside the payload; fall back to the
      // manifest registration when a legacy product omits them.
      if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>
        if (typeof record.evidenceRole === 'string') evidenceRole = record.evidenceRole
        if (Array.isArray(record.boundaries)) {
          for (const item of record.boundaries) {
            if (typeof item === 'string') boundaries.push(item)
          }
        }
        if (typeof record.mechanismEvidencePermitted === 'boolean') {
          mechanismEvidencePermitted = record.mechanismEvidencePermitted
        }
      }
      if (fileSha256Matches) {
        quantitativeResults = supplementProductQuantitativeResults(entry.kind, payload)
      } else {
        boundaries.push('派生产物 SHA-256 与补充包 manifest 登记值不一致，已拒绝定量读取。')
      }
    } catch {
      boundaries.push('派生产物文件缺失或不可读。')
    }
    products.push({
      kind: entry.kind,
      caseId: entry.caseId ?? null,
      analysisVersion: entry.analysisVersion,
      relativePath: entry.relativePath,
      registeredSha256: entry.sha256,
      fileSha256Matches,
      inputAssetIds: entry.inputAssetIds,
      mechanismEvidencePermitted,
      evidenceRole,
      boundaries,
      quantitativeResults,
    })
  }
  const readyProducts = products.filter(
    (product) => product.fileSha256Matches && product.quantitativeResults.length > 0,
  )
  const capabilities = new Set<string>()
  for (const product of readyProducts) {
    if (product.kind.startsWith('eis-versioned-line-fitting')) {
      capabilities.add('eis-chianti-density-spectroscopy')
    }
    if (product.kind.startsWith('nustar-hxr-solar-geometry')) {
      capabilities.add('nustar-count-rate-limits')
    }
    if (product.kind.startsWith('iris-method-replication')) {
      capabilities.add('iris-method-replication')
    }
  }
  return {
    status: readyProducts.length > 0 ? 'ready' : 'invalid',
    manifestPath,
    productCount: products.length,
    products,
    availableCapabilities: [...capabilities],
    diagnosticBoundaries: [...new Set(products.flatMap((product) => product.boundaries))],
    mechanismEvidencePermitted: false,
  }
}
