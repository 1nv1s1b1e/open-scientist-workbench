import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { getDatasetDir } from '@open-scientist/config'
import { tool } from 'ai'
import { z } from 'zod'

export const CORONAL_STARTER_DATASET_ID = 'coronal-starter-v1'
export const LOCAL_CORONAL_SOURCE_ID = 'local:coronal-starter-v1'

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

const ManifestSchema = z.object({
  format: z.literal('open-scientist-coronal-observation-pack-v1'),
  datasetId: z.literal(CORONAL_STARTER_DATASET_ID),
  plannedTotalBytes: z.number().int().nonnegative(),
  uniqueAssetCount: z.number().int().nonnegative(),
  logicalObservationCount: z.number().int().nonnegative(),
  scientificBoundary: z.object({
    statement: z.string().min(1),
    knownGaps: z.array(z.string().min(1)),
  }),
  cases: z.array(CaseSchema).min(1),
  assets: z.array(AssetSchema).min(1),
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
  expectedAssetCount: number
  verifiedAssetCount: number
  expectedBytes: number
  verifiedBytes: number
  missingAssetIds: string[]
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
}

function resolvePackRoot(datasetDir = getDatasetDir()): string {
  return resolve(datasetDir, CORONAL_STARTER_DATASET_ID)
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

function normalized(value: string): string {
  return value.toLowerCase().replace(/noaa|ar/g, '').replace(/[^a-z0-9]+/g, '')
}

function matchingScore(
  item: CoronalObservationCase,
  activeRegion?: string,
  query?: string,
): number {
  const haystack = normalized([
    item.caseId,
    item.label,
    item.activeRegion,
    item.purpose,
  ].join(' '))
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
    throw new Error(`Cannot load ${CORONAL_STARTER_DATASET_ID} manifest: ${detail}`)
  }
  const manifest = ManifestSchema.parse(parsed)
  if (manifest.uniqueAssetCount !== manifest.assets.length) {
    throw new Error('Coronal manifest uniqueAssetCount does not match the asset list')
  }
  if (manifest.plannedTotalBytes !== manifest.assets.reduce((sum, item) => sum + item.bytes, 0)) {
    throw new Error('Coronal manifest plannedTotalBytes does not match asset byte counts')
  }
  const assetsById = new Map(manifest.assets.map((asset) => [asset.assetId, asset]))
  if (assetsById.size !== manifest.assets.length) {
    throw new Error('Coronal manifest contains duplicate asset ids')
  }
  return { rootDir, manifestPath, manifest, assetsById }
}

function isVerified(asset: CoronalObservationAsset): boolean {
  return asset.downloadStatus === 'verified' && typeof asset.sha256 === 'string' && asset.sha256.length > 0
}

export function summarizeCoronalCase(
  catalog: CoronalDataCatalog,
  item: CoronalObservationCase,
): CoronalCaseSummary {
  const assetIds = unique(item.observations.map((observation) => observation.assetId))
  const assets = assetIds.map((assetId) => catalog.assetsById.get(assetId)).filter(
    (asset): asset is CoronalObservationAsset => asset !== undefined,
  )
  const verifiedAssetCount = assets.filter(isVerified).length
  return {
    caseId: item.caseId,
    label: item.label,
    activeRegion: item.activeRegion,
    startTai: item.startTai,
    duration: item.duration,
    purpose: item.purpose,
    verifiedAssetCount,
    expectedAssetCount: assetIds.length,
    logicalObservationCount: item.observations.length,
    instruments: unique(item.observations.map((observation) => observation.instrument)).sort(),
    wavelengthOrBands: unique(
      item.observations.map((observation) => observation.wavelengthOrBand).filter(
        (value): value is string => value !== null,
      ),
    ).sort(),
    cadencesSeconds: unique(item.observations.map((observation) => observation.cadenceSeconds)).sort(
      (left, right) => left - right,
    ),
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
    .sort((left, right) =>
      right.score - left.score
      || summarizeCoronalCase(catalog, right.item).logicalObservationCount - summarizeCoronalCase(catalog, left.item).logicalObservationCount
      || left.item.caseId.localeCompare(right.item.caseId),
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
  return {
    sourceId: LOCAL_CORONAL_SOURCE_ID,
    datasetId: catalog.manifest.datasetId,
    status: missingAssetIds.length === 0 ? 'ready' : 'incomplete',
    expectedAssetCount: catalog.manifest.assets.length,
    verifiedAssetCount,
    expectedBytes: catalog.manifest.plannedTotalBytes,
    verifiedBytes,
    missingAssetIds: missingAssetIds.slice(0, 20),
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
  const requested: CoronalRequirement[] = input.requirements?.length
    ? unique(input.requirements)
    : ['thermal-evolution', 'magnetic-context']
  let selected: CoronalObservationCase | undefined
  if (input.caseId) selected = catalog.manifest.cases.find((item) => item.caseId === input.caseId)
  if (!selected) {
    selected = catalog.manifest.cases
      .map((item) => ({ item, score: matchingScore(item, input.activeRegion, input.query) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) =>
        right.score - left.score
        || summarizeCoronalCase(catalog, right.item).logicalObservationCount - summarizeCoronalCase(catalog, left.item).logicalObservationCount
        || left.item.caseId.localeCompare(right.item.caseId),
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
    }
  }
  const summary = summarizeCoronalCase(catalog, selected)
  const bands = new Set(summary.wavelengthOrBands)
  const hasCoreThermal = ['94 Å', '131 Å', '171 Å', '193 Å', '211 Å', '335 Å'].every(
    (band) => bands.has(band),
  )
  const hasMagnetic = summary.instruments.includes('SDO/HMI')
  const hasFastTwoBand = summary.cadencesSeconds.some((cadence) => cadence <= 30)
    && bands.has('171 Å') && bands.has('193 Å')
  const supported = new Set<CoronalRequirement>()
  if (pack.status === 'ready' && hasCoreThermal) supported.add('thermal-evolution')
  if (pack.status === 'ready' && hasMagnetic) supported.add('magnetic-context')
  if (pack.status === 'ready' && hasFastTwoBand) supported.add('wave-timescale')
  const satisfied = requested.filter((requirement) => supported.has(requirement))
  const unavailable = requested.filter((requirement) => !supported.has(requirement))
  const limitations = [...catalog.manifest.scientificBoundary.knownGaps]
  if (pack.status !== 'ready') limitations.unshift('本地数据包完整性未通过，不能用于本轮分析。')
  if (unavailable.includes('spectroscopy')) limitations.push('当前包没有光谱或非热展宽诊断。')
  if (unavailable.includes('simulation')) limitations.push('当前包没有与观测同化的 MHD 数值模拟产物。')
  return {
    sourceId: LOCAL_CORONAL_SOURCE_ID,
    datasetId: catalog.manifest.datasetId,
    caseId: selected.caseId,
    status: pack.status,
    satisfied,
    unavailable,
    limitations: unique(limitations),
    case: summary,
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
  description: '在已校验的本地 SDO 日冕观测包中检索活动区窗口。只返回数据覆盖和可追溯索引，不解释图像或生成机制结论。',
  inputSchema: SearchInputSchema,
  execute: async (input) => searchCoronalObservationCases(input),
})

export const checkLocalSolarCoverageTool = tool({
  description: '检查本地观测包是否覆盖指定活动区的多波段热演化、磁场背景、波动时标、光谱或模拟需求。缺失诊断必须被保留为限制条件。',
  inputSchema: z.object({
    activeRegion: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    caseId: z.string().min(1).optional(),
    requirements: z.array(z.enum([
      'thermal-evolution',
      'magnetic-context',
      'wave-timescale',
      'spectroscopy',
      'simulation',
    ])).min(1).max(5).default(['thermal-evolution', 'magnetic-context']),
  }),
  execute: async (input) => assessCoronalDataCoverage(input),
})
