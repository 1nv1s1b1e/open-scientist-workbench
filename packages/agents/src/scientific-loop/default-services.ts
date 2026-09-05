import { createHash } from 'node:crypto'
import { getDatasetDir, type AgentRuntimeConfig, type ModelArg } from '@open-scientist/config'
import {
  assessCoronalDataCoverage,
  LOCAL_CORONAL_SOURCE_ID,
  searchVerifiedCoronalLiterature,
  searchCoronalObservationCases,
  verifyCoronalDataPack,
  loadSupplementAnalysisDiagnostics,
} from '@open-scientist/tools'
import {
  EvidenceRecordSchema,
  PhenomenonInputSchema,
  QuantitativeResultSchema,
  SCIENTIFIC_AGENTS,
  ScientificHypothesisSchema,
  ScientificCorrectionSchema,
  scientificFalsificationConditionId,
  scientificPredictionId,
  type EvidenceRecord,
  type HypothesisCoverageAudit,
  type PhenomenonInput,
  type QuantitativeResult,
  type ScientificHypothesis,
  type ScientificCorrection,
  type ValidationTask,
} from '@open-scientist/schema'
import { z } from 'zod'
import { librarianWorkflow } from '../librarian/workflow.ts'
import type { EmitChunk } from '../shared/stream.ts'
import type {
  EvidenceAgent,
  EvidenceAgentContext,
  EvidenceAgentCorrection,
} from './evidence-workgroup.ts'
import {
  type HypothesisGenerationContext,
  type HypothesisGenerationResult,
  type PlanningContext,
  type ScientificGraphDependencies,
  type SynthesisContext,
} from './services.ts'
import {
  runLocalCoronalProcessing,
  verifyLocalEvidenceProvenance,
  type LocalCoronalAnalysis,
  type LocalProcessingResult,
  type ObservableDiagnostic,
} from './local-processing.ts'
import { runScientificModelTask } from './model-assisted.ts'
import { steeringPromptBlock } from './human-channel.ts'
import { evaluateDetectability } from './detectability.ts'
import {
  COMPOUND_TASK_REJECTION_PATTERN,
  executorContractByExecutorId,
  EXECUTOR_CONTRACTS,
  inferableExecutorContracts,
  stripStableIdTokens,
} from './executor-contracts.ts'
import { canonicalValidationSourceId } from './validation-source.ts'
import {
  executorSupportsPrediction,
  filterPredictionIdsByCapability,
  predictionStatementForId,
} from './executor-capabilities.ts'
import { PREREGISTERED_MINIMUM_INDEPENDENT_EVENTS } from './evidence-gate.ts'

export interface DefaultScientificServicesInput {
  projectId: string
  runId: string
  modelConfig: ModelArg
  agentConfigs?: Record<string, AgentRuntimeConfig>
  emitChunk?: EmitChunk
  abortSignal?: AbortSignal
  localGrounded?: boolean
}

const ModelEvidenceReviewSchema = z.object({
  summary: z.string().min(1),
  findings: z
    .array(
      z.object({
        hypothesisId: z.string().min(1),
        assessment: z.enum(['supports_prediction', 'challenges_prediction', 'insufficient']),
        claim: z.string().min(1),
        observed: z.string().min(1),
        sourceIds: z.array(z.string().min(1)).max(8).default([]),
        limitations: z.array(z.string().min(1)).max(5).default([]),
      }),
    )
    .max(8),
  corrections: z
    .array(
      z.object({
        stage: z.preprocess(
          (value) =>
            value === 'A'
              ? 'librarian'
              : value === 'B'
                ? 'explorer'
                : value === 'C'
                  ? 'oracle'
                  : value === 'D'
                    ? 'prometheus'
                    : value,
          z.enum([
            'librarian',
            'self-correction-i',
            'surveyor',
            'explorer',
            'self-correction-ii',
            'oracle',
            'prometheus',
            'memory',
            'data-processing',
          ]),
        ),
        kind: z.enum(['schema', 'provenance', 'factual', 'execution', 'memory-policy']),
        severity: z.enum(['info', 'warning', 'error']),
        message: z.string().min(1),
        action: z.string().min(1),
        affectedIds: z.array(z.string().min(1)).max(8).default([]),
        evidenceAction: z.enum(['none', 'downgrade_to_unknown', 'revoke']).default('none'),
      }),
    )
    .max(6)
    .default([]),
})

const ModelConclusionSchema = z.object({
  conclusion: z.string().min(1),
  reasoningSummary: z.string().min(1),
})

const ModelDiagnosticIdSchema = z.enum([
  'aia-171-193-timeseries-v1',
  'aia-94-131-hot-channel-variability-v1',
  'aia-target-background-variability-v1',
  'aia-cross-event-holdout-v1',
  'aia-wcs-unified-roi-v2',
  'aia-cooling-sequence-v2',
  'aia-dem-inversion-v1',
  'aia-event-threshold-sensitivity-v2',
  'hmi-magnetic-metadata-audit-v2',
  'aia-spatial-wave-v1',
  'aia-event-fluence-distribution-v1',
  'hmi-sharp-vector-v1',
  'aia-hmi-temporal-association-v1',
  'iris-relative-doppler-v1',
  'external',
])

type ModelDiagnosticId = z.infer<typeof ModelDiagnosticIdSchema>

/**
 * Diagnostic ID → executor ID mapping, derived from the single
 * {@link EXECUTOR_CONTRACTS} registry (P1-7 fix). The compile-time assertion
 * below fails the build if a planner diagnostic ever lacks a contract entry.
 */
type ContractDiagnosticId = (typeof EXECUTOR_CONTRACTS)[number]['diagnosticId']
type _AssertDiagnosticCoverage =
  Exclude<ModelDiagnosticId, ContractDiagnosticId> extends never ? true : never
const _diagnosticCoverage: _AssertDiagnosticCoverage = true
void _diagnosticCoverage

const MODEL_DIAGNOSTIC_EXECUTORS: Record<ModelDiagnosticId, string> = Object.fromEntries(
  EXECUTOR_CONTRACTS.map((contract) => [contract.diagnosticId, contract.executorId]),
) as Record<ModelDiagnosticId, string>

const ModelValidationPlanSchema = z.object({
  reasoningSummary: z.string().min(1),
  tasks: z
    .array(
      z.object({
        hypothesisId: z.string().min(1),
        diagnosticId: ModelDiagnosticIdSchema,
        route: z.preprocess(
          (value) => (value === 'A' ? 'librarian' : value === 'B' ? 'explorer' : value),
          z.enum(['librarian', 'explorer']),
        ),
        type: z.enum([
          'observation',
          'analysis',
          'history-search',
          'simulation',
          'model-update',
          'human-review',
        ]),
        scientificPurpose: z.string().min(1),
        predictionIds: z.array(z.string().min(1)).min(1).max(8),
        falsificationConditionIds: z.array(z.string().min(1)).min(1).max(8),
        requiredSourceIds: z.array(z.string().min(1)).max(10).default([]),
        discriminatingOutcomes: z.array(z.string().min(1)).min(1).max(8),
      }),
    )
    .min(1)
    // Model proposals supplement the deterministic full diagnostic matrix;
    // the runtime no longer truncates registered executable diagnostics.
    .max(24),
})

const ModelHypothesisRevisionSchema = z.object({
  reasoningSummary: z.string().min(1),
  revisions: z
    .array(
      z.object({
        parentId: z.string().min(1),
        statement: z.string().min(1),
        mechanismComposition: z
          .array(
            z.object({
              mechanism: z.string().min(1),
              role: z.enum(['dominant', 'secondary', 'coupled', 'unknown']),
              contribution: z.number().min(0).max(1).optional(),
            }),
          )
          .min(1)
          .max(5),
        predictions: z.array(z.string().min(1)).min(1).max(8),
        falsificationConditions: z.array(z.string().min(1)).min(1).max(8),
        sourceIds: z.array(z.string().min(1)).max(12).default([]),
        scope: z.string().min(1),
        changeRationale: z.string().min(1),
      }),
    )
    .min(1)
    .max(6),
})

type ModelEvidenceReview = z.infer<typeof ModelEvidenceReviewSchema>

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function conciseText(value: string, maximum: number = 900): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maximum) return normalized
  return `${normalized.slice(0, maximum)}...`
}

function selectedDiagnosticFields(
  diagnostic: ObservableDiagnostic,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.flatMap((key) => (diagnostic[key] === undefined ? [] : [[key, diagnostic[key]]])),
  )
}

/**
 * Keep every processed event visible to model reviewers. Passing full channel
 * arrays caused the prompt to be truncated after the discovery event, which
 * silently hid cross-active-region holdouts from Explorer and Oracle.
 */
function compactProcessingPromptRows(processing: readonly LocalProcessingResult[]) {
  return processing.map((item) => ({
    processingRunId: item.processingRunId,
    snapshotId: item.snapshotId,
    mode: item.analysis.mode,
    caseId: item.analysis.target.caseId,
    activeRegion: item.analysis.target.activeRegion,
    usedObservationCount: item.analysis.target.usedObservationCount,
    analysisSplit: item.analysis.analysisDesign.split,
    scientificResultFingerprint: item.analysis.analysisDesign.scientificResultFingerprint,
    alignment: {
      aiaWcsRegistrationReady: item.analysis.target.alignment.aiaWcsRegistrationReady,
      hmiWcsRegistrationReady: item.analysis.target.alignment.hmiWcsRegistrationReady,
      aiaRegistered: item.analysis.target.alignment.aiaRegistered,
      aiaFallback: item.analysis.target.alignment.aiaFallback,
      hmiRegistered: item.analysis.target.alignment.hmiRegistered,
      hmiUnregistered: item.analysis.target.alignment.hmiUnregistered,
    },
    diagnostics: {
      wave: selectedDiagnosticFields(item.analysis.diagnostics.wave, [
        'observableStatus',
        'periodsSeconds',
        'periodResolved',
        'cyclesCovered',
        'crossChannelCorrelation',
        'crossChannelLagSeconds',
        'boundary',
      ]),
      reconnection: selectedDiagnosticFields(item.analysis.diagnostics.reconnection, [
        'observableStatus',
        'hotChannelPeakCount',
        'hotChannelRelativeVariability',
        'targetToBackgroundVariabilityRatio',
        'eventThresholdSensitivity',
        'boundary',
      ]),
      coupled: selectedDiagnosticFields(item.analysis.diagnostics.coupled, [
        'observableStatus',
        'jointIndicatorsPresent',
        'boundary',
      ]),
      coolingSequence: selectedDiagnosticFields(item.analysis.diagnostics.cooling_sequence, [
        'observableStatus',
        'pairCount',
        'usablePairCount',
        'passingPairCount',
        'frozenCriterion',
        'boundary',
      ]),
      demTemperature: selectedDiagnosticFields(item.analysis.diagnostics.dem_temperature, [
        'observableStatus',
        'usable',
        'timeSampleCount',
        'medianReducedChiSquare',
        'meanEmWeightedLog10Temperature',
        'meanHotEmissionFractionAboveLogT6_7',
        'nonnegativeDemFraction',
        'medianAbsoluteReconstructionResidualSigma',
        'assumedFractionalCalibrationUncertainty',
        'quantitativeResults',
        'boundary',
      ]),
      magneticEvolution: selectedDiagnosticFields(item.analysis.diagnostics.magnetic_evolution, [
        'observableStatus',
        'wcsRegistrationAvailable',
        'physicalUnitMetadataAvailable',
        'physicalMagneticMetricsAvailable',
        'resolvedFluxEvolution',
        'frozenCriterion',
        'signedLosFluxSlopeMxPerHour',
        'signedLosFluxSlopeIntervalMxPerHour',
        'unsignedLosFluxSlopeMxPerHour',
        'unsignedLosFluxSlopeIntervalMxPerHour',
        'gradientMedianGPerMm',
        'pilLengthMedianMm',
        'signedMeanProxySlopePerHour',
        'unsignedMeanProxySlopePerHour',
        'gradientMedianProxy',
        'pilNeighborhoodFractionProxy',
        'boundary',
      ]),
      spatialWave: selectedDiagnosticFields(
        item.analysis.diagnostics.spatial_wave ?? {
          observableStatus: 'unknown',
          boundary: '尚无空间波动诊断。',
        },
        [
          'observableStatus',
          'usableBandCount',
          'periodAgreement',
          'standingWaveCompatibleBandCount',
          'propagationCompatibleBandCount',
          'quantitativeResults',
          'boundary',
        ],
      ),
      eventFluenceDistribution: selectedDiagnosticFields(
        item.analysis.diagnostics.event_fluence_distribution ?? {
          observableStatus: 'unknown',
          boundary: '尚无事件 fluence 目录。',
        },
        [
          'observableStatus',
          'eventCount',
          'backgroundEventCount',
          'eventRatePerHour',
          'powerLawProxyFit',
          'targetBackgroundKsDistance',
          'quantitativeResults',
          'boundary',
        ],
      ),
      vectorMagneticEvolution: selectedDiagnosticFields(
        item.analysis.diagnostics.vector_magnetic_evolution ?? {
          observableStatus: 'unknown',
          boundary: '尚无矢量磁场诊断。',
        },
        [
          'observableStatus',
          'usable',
          'recordCount',
          'harpNum',
          'resolvedRadialFluxEvolution',
          'resolvedUnsignedCurrentEvolution',
          'horizontalFieldMedianG',
          'totalUnsignedVerticalCurrentMedianA',
          'componentErrorMedianG',
          'quantitativeResults',
          'boundary',
        ],
      ),
      magneticThermalAssociation: selectedDiagnosticFields(
        item.analysis.diagnostics.magnetic_thermal_association ?? {
          observableStatus: 'unknown',
          boundary: '尚无磁—热时序关联诊断。',
        },
        [
          'observableStatus',
          'usable',
          'eventCount',
          'vectorRecordCount',
          'meanAbsoluteUnsignedFluxFractionalRateAtEventsPerHour',
          'medianMagneticDerivativeMinusHotPeakLagSeconds',
          'circularShiftPValue',
          'quantitativeResults',
          'boundary',
        ],
      ),
      spectroscopy: selectedDiagnosticFields(
        item.analysis.diagnostics.spectroscopy ?? {
          observableStatus: 'unknown',
          boundary: '尚无事件匹配的 IRIS Level-2 光谱诊断。',
        },
        [
          'observableStatus',
          'rasterCount',
          'failedRasterCount',
          'medianBrightMinusReferenceVelocityKmPerSecond',
          'velocityInterval95KmPerSecond',
          'frozenCriterion',
          'wavelengthCalibration',
          'quantitativeResults',
          'boundary',
        ],
      ),
    },
    limitations: item.analysis.limitations.slice(0, 4),
  }))
}

/**
 * Summarize already-promoted deterministic records by raw event. Completed
 * tasks are intentionally no longer runnable, so reloading processors alone
 * cannot reconstruct the multi-event context for later model reviewers.
 */
function compactEventEvidencePromptRows(records: readonly EvidenceRecord[]) {
  const byEvent = new Map<
    string,
    {
      eventGroupId: string
      analysisSplit: string
      rawDataFingerprint: string
      evidenceIds: string[]
      hypothesisIds: string[]
      observations: string[]
      quantitativeResults: Array<{
        metric: string
        estimate: number
        lowerBound: number
        upperBound: number
        confidenceLevel: number
        unit?: string
      }>
    }
  >()
  for (const record of records) {
    if (!record.provenance || !record.lineage) continue
    const key = record.lineage.eventGroupId
    const row = byEvent.get(key) ?? {
      eventGroupId: key,
      analysisSplit: record.lineage.analysisSplit,
      rawDataFingerprint: record.lineage.rawDataFingerprint,
      evidenceIds: [],
      hypothesisIds: [],
      observations: [],
      quantitativeResults: [],
    }
    if (!row.evidenceIds.includes(record.evidenceId)) row.evidenceIds.push(record.evidenceId)
    if (record.hypothesisId && !row.hypothesisIds.includes(record.hypothesisId)) {
      row.hypothesisIds.push(record.hypothesisId)
    }
    if (!row.observations.includes(record.observed)) row.observations.push(record.observed)
    for (const result of record.quantitativeResults) {
      if (
        row.quantitativeResults.some(
          (existing) => existing.metric === result.metric && existing.estimate === result.estimate,
        )
      )
        continue
      row.quantitativeResults.push({
        metric: result.metric,
        estimate: result.estimate,
        lowerBound: result.lowerBound,
        upperBound: result.upperBound,
        confidenceLevel: result.confidenceLevel,
        ...(result.unit ? { unit: result.unit } : {}),
      })
    }
    byEvent.set(key, row)
  }
  return [...byEvent.values()]
    .map((row) => ({
      ...row,
      evidenceIds: row.evidenceIds.slice(0, 12),
      observations: row.observations.slice(0, 6),
      quantitativeResults: row.quantitativeResults.slice(0, 8),
    }))
    .sort((left, right) => left.eventGroupId.localeCompare(right.eventGroupId))
}

function sourceIds(phenomenon: PhenomenonInput): string[] {
  return [...new Set(phenomenon.observations.map((item) => item.sourceId))]
}

function inferredActiveRegion(phenomenon: PhenomenonInput): string | undefined {
  if (phenomenon.activeRegion?.trim()) return phenomenon.activeRegion.trim()
  const match = `${phenomenon.title} ${phenomenon.description}`.match(
    /(?:NOAA|AR)\s*[-#:]?\s*(\d{4,5})/i,
  )
  return match?.[1]
}

function phenomenonPrompt(phenomenon: PhenomenonInput): string {
  const observations =
    phenomenon.observations.length > 0
      ? phenomenon.observations
          .map(
            (item) => `${item.sourceId}（${item.kind}；${item.wavelengthOrBand ?? '波段未提供'}）`,
          )
          .join('；')
      : '当前没有绑定可执行来源，请先提出数据需求而不要假定观测结果'
  return [
    `科学现象：${phenomenon.title}`,
    phenomenon.description,
    `活动区：${phenomenon.activeRegion ?? '未提供'}`,
    `已登记观测：${observations}`,
    phenomenon.requestedQuestion ?? '',
  ]
    .filter(Boolean)
    .join('\n')
}

const RETRIEVAL_TOOL_LABELS = {
  searchPapers: '文献检索',
  searchHypotheses: '历史假设检索',
  searchLocalSolarData: '本地观测检索',
  checkLocalSolarCoverage: '数据覆盖核验',
} as const

type RetrievalToolName = keyof typeof RETRIEVAL_TOOL_LABELS

interface RetrievalToolState {
  called: boolean
  completed: boolean
  failed: boolean
  resultCount: number
}

interface RetrievalTrace {
  toolByCallId: Map<string, RetrievalToolName>
  tools: Record<RetrievalToolName, RetrievalToolState>
  sourceIds: Set<string>
  paperIds: Set<string>
  paperCount: number
  localCaseCount: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseToolOutput(value: unknown): Record<string, unknown> | null {
  const direct = asRecord(value)
  if (direct) return direct
  if (typeof value !== 'string') return null
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return null
  }
}

function createRetrievalTrace(phenomenon: PhenomenonInput): RetrievalTrace {
  const state = (): RetrievalToolState => ({
    called: false,
    completed: false,
    failed: false,
    resultCount: 0,
  })
  return {
    toolByCallId: new Map(),
    tools: {
      searchPapers: state(),
      searchHypotheses: state(),
      searchLocalSolarData: state(),
      checkLocalSolarCoverage: state(),
    },
    sourceIds: new Set(sourceIds(phenomenon)),
    paperIds: new Set(),
    paperCount: 0,
    localCaseCount: 0,
  }
}

function isRetrievalToolName(value: unknown): value is RetrievalToolName {
  return typeof value === 'string' && value in RETRIEVAL_TOOL_LABELS
}

function captureRetrievalChunk(trace: RetrievalTrace, chunk: unknown): void {
  const event = asRecord(chunk)
  if (!event || typeof event.type !== 'string') return
  const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : null

  if (toolCallId && isRetrievalToolName(event.toolName)) {
    trace.toolByCallId.set(toolCallId, event.toolName)
    trace.tools[event.toolName].called = true
    if (event.type === 'tool-input-error') trace.tools[event.toolName].failed = true
  }

  if (!toolCallId) return
  const toolName = trace.toolByCallId.get(toolCallId)
  if (!toolName) return
  if (event.type === 'tool-output-error') {
    trace.tools[toolName].failed = true
    return
  }
  if (event.type !== 'tool-output-available') return

  const toolState = trace.tools[toolName]
  toolState.completed = true
  const output = parseToolOutput(event.output)
  if (!output) return

  if (toolName === 'searchPapers') {
    const papers = Array.isArray(output.papers) ? output.papers : []
    toolState.resultCount = papers.length
    for (const paper of papers) {
      const id = asRecord(paper)?.id
      if (typeof id === 'number' || typeof id === 'string') {
        const sourceId = `paper:${id}`
        trace.sourceIds.add(sourceId)
        trace.paperIds.add(sourceId)
      }
    }
    trace.paperCount = trace.paperIds.size
    return
  }
  if (toolName === 'searchHypotheses') {
    const hypotheses = Array.isArray(output.hypotheses) ? output.hypotheses : []
    toolState.resultCount = hypotheses.length
    return
  }
  if (toolName === 'searchLocalSolarData') {
    const cases = Array.isArray(output.cases) ? output.cases : []
    toolState.resultCount = cases.length
    trace.localCaseCount = Math.max(trace.localCaseCount, cases.length)
    if (cases.length > 0 && typeof output.sourceId === 'string')
      trace.sourceIds.add(output.sourceId)
    return
  }

  const selectedCase = asRecord(output.case)
  const hasCase = selectedCase !== null || typeof output.caseId === 'string'
  toolState.resultCount = hasCase ? 1 : 0
  trace.localCaseCount = Math.max(trace.localCaseCount, toolState.resultCount)
  if (hasCase && typeof output.sourceId === 'string') trace.sourceIds.add(output.sourceId)
}

function generationCorrection(
  context: Readonly<HypothesisGenerationContext>,
  severity: ScientificCorrection['severity'],
  message: string,
  action: string,
): ScientificCorrection {
  return ScientificCorrectionSchema.parse({
    correctionId: `correction-a-rag-${digest({
      runId: context.runId,
      message,
      round: context.round,
    }).slice(0, 16)}`,
    stage: 'librarian',
    kind: severity === 'error' ? 'execution' : 'factual',
    severity,
    message,
    action,
    affectedIds: [],
    triggeredBy: ['librarian.generate', 'librarian'],
    round: context.round,
    agentId: 'librarian',
  })
}

function safeGenerationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/abort/i.test(message)) return '本轮模型调用已取消，未生成候选假设。'
  if (/(helix|connection refused|econnrefused|fetch failed)/i.test(message)) {
    return '文献检索服务未能返回结果，本轮不生成候选假设。'
  }
  if (/(timeout|timed out|超时)/i.test(message)) return '模型或资料检索超时，本轮不生成候选假设。'
  return '模型未完成满足结构与来源约束的候选假设。'
}

/**
 * Deterministic (local-grounded) generation never consumes free-text human
 * steering — reproducibility forbids it. The steering is still drained and
 * audited upstream; here we record that fact honestly.
 */
function withLocalSteeringNote(
  context: Readonly<HypothesisGenerationContext>,
  result: HypothesisGenerationResult,
): HypothesisGenerationResult {
  if (!context.steering || context.steering.length === 0) return result
  return {
    ...result,
    corrections: [
      ...(result.corrections ?? []),
      generationCorrection(
        context,
        'info',
        `人工转向输入已登记（${context.steering.length} 条）但未被本地确定性生成消费；转向只能影响 model-assisted 路径的候选生成。`,
        '如需人工转向参与候选生成，请使用 model-assisted 执行模式重新运行。',
      ),
    ],
  }
}

const OPEN_WORLD_MECHANISM_RULES: ReadonlyArray<{ family: string; pattern: RegExp }> = [
  { family: 'wave-energy-transport', pattern: /Alfv[eé]n|MHD wave|phase mix|resonan|波动|波耗散/i },
  { family: 'reconnection-nanoflare', pattern: /nanoflare|reconnect|纳耀斑|重联/i },
  { family: 'turbulent-cascade', pattern: /turbulen|cascade|湍流|级联/i },
  {
    family: 'magnetic-braiding-current-sheets',
    pattern: /braid|footpoint shuffl|current sheet|Ohmic|磁编织|电流片|欧姆/i,
  },
  {
    family: 'thermal-nonequilibrium',
    pattern: /thermal nonequilibrium|coronal rain|overcool|热非平衡|日冕雨/i,
  },
  { family: 'quasi-steady-heating', pattern: /quasi.?steady|steady.?state|近稳态|持续加热/i },
  {
    family: 'compressive-shocks',
    pattern: /shock|magnetoacoustic|slow.?mode|compressive|冲击|慢模|压缩/i,
  },
  {
    family: 'chromospheric-upflows-spicules',
    pattern: /spicule|upflow|enthalpy|chromospheric injection|上流|针状体|焓流/i,
  },
  {
    family: 'flux-emergence-cancellation',
    pattern: /flux emergence|flux cancellation|fan.?spine|磁通涌现|磁通消失|扇脊/i,
  },
  {
    family: 'kinetic-particle-heating',
    pattern: /ion cyclotron|kinetic heating|preferential ion|离子回旋|动理学加热/i,
  },
  {
    family: 'conductive-evaporative-response',
    pattern: /thermal conduction|chromospheric evaporation|conductive flux|热传导|色球蒸发/i,
  },
]

function mechanismFamiliesInText(text: string): string[] {
  return OPEN_WORLD_MECHANISM_RULES.filter((rule) => rule.pattern.test(text)).map(
    (rule) => rule.family,
  )
}

function buildHypothesisCoverageAudit(input: {
  hypotheses: readonly ScientificHypothesis[]
  papers: readonly { title: string; abstract?: string | null }[]
  retrievalSourceCount: number
  modeLabel: string
}): HypothesisCoverageAudit {
  const retrievedMechanismFamilies = [
    ...new Set(
      input.papers.flatMap((paper) =>
        mechanismFamiliesInText(`${paper.title} ${paper.abstract ?? ''}`),
      ),
    ),
  ].sort()
  const representedMechanismFamilies = [
    ...new Set(
      input.hypotheses.flatMap((hypothesis) =>
        mechanismFamiliesInText(
          `${hypothesis.statement} ${hypothesis.mechanismComposition.map((item) => item.mechanism).join(' ')}`,
        ),
      ),
    ),
  ].sort()
  const unrepresentedMechanismFamilies = retrievedMechanismFamilies.filter(
    (family) => !representedMechanismFamilies.includes(family),
  )
  return {
    mode: 'open_world',
    exhaustiveClaim: false,
    fixedMechanismCount: false,
    candidateCount: input.hypotheses.length,
    retrievalSourceCount: input.retrievalSourceCount,
    retrievedMechanismFamilies,
    representedMechanismFamilies,
    unrepresentedMechanismFamilies,
    residualAlternativeAllowed: true,
    limitations: [
      `${input.modeLabel} 按检索结果和可证伪差异生成候选，不设三类机制或固定候选数。`,
      '开放世界审计不能证明穷尽全部太阳物理解释；新文献、新观测异常或专家提出的可证伪替代机制可以继续进入 Librarian 假设阶段。',
      ...(unrepresentedMechanismFamilies.length > 0
        ? [`检索到但尚未形成合格候选的机制族：${unrepresentedMechanismFamilies.join('、')}。`]
        : []),
    ],
  }
}

async function generateLocalGroundedHypotheses(
  input: DefaultScientificServicesInput,
  context: Readonly<HypothesisGenerationContext>,
): Promise<HypothesisGenerationResult> {
  const phenomenon = context.phenomenon
  const activeRegion = inferredActiveRegion(phenomenon)
  const narrative = `${phenomenon.title} ${phenomenon.description} ${phenomenon.requestedQuestion ?? ''}`
  const normalized = narrative.toLowerCase()
  const paperBatches = await Promise.all(
    [
      narrative,
      'coronal heating competing hypotheses alternative mechanisms observational discriminants',
      'active region loop energy transport dissipation counterexamples shocks upflows braiding turbulence thermal nonequilibrium',
      'propagating disturbances upflows spicules flux emergence cancellation kinetic heating thermal conduction chromospheric evaporation',
    ].map((query) => searchVerifiedCoronalLiterature(query, 12)),
  )
  const papers = [
    ...new Map(paperBatches.flat().map((paper) => [paper.id, paper] as const)).values(),
  ].slice(0, 40)
  const matches = await searchCoronalObservationCases({
    activeRegion,
    query: narrative,
    limit: 3,
  })
  const selected = matches.cases[0]
  const coverage = await assessCoronalDataCoverage({
    activeRegion,
    query: narrative,
    caseId: selected?.caseId,
    requirements: [
      'thermal-evolution',
      'magnetic-context',
      'wave-timescale',
      'spectroscopy',
      'simulation',
    ],
  })
  const pack = await verifyCoronalDataPack()
  const localSourceIds = selected ? [matches.sourceId] : []
  const paperIds = papers.map((paper) => `paper:${paper.id}`)
  const allSources = [...new Set([...paperIds, ...localSourceIds])]
  const regionLabel = activeRegion
    ? /^(?:AR|NOAA)\b/i.test(activeRegion)
      ? activeRegion
      : `AR${activeRegion}`
    : '当前输入现象'
  const hasWaveCue = /(准周期|传播|波动|振荡|alfv|wave|periodic|oscillat)/i.test(normalized)
  const hasReconnectionCue =
    /(间歇|增亮|耀斑|重联|极性反转|中性线|94|131|nanoflare|brighten|reconnect|pil)/i.test(
      normalized,
    )
  const hasTurbulenceCue = /(湍流|非热线宽|谱线增宽|turbulen|non.?thermal|line width)/i.test(
    normalized,
  )
  const hasNonequilibriumCue =
    /(热非平衡|非平衡|循环|长周期|thermal.?none.?equilibrium|TNE|cycle|overcooling)/i.test(
      normalized,
    )
  const hasSteadyCue = /(稳态|近稳态|steady|quasi.?steady|continuous)/i.test(normalized)
  const retrievedMechanismFamilies = new Set(
    papers.flatMap((paper) => mechanismFamiliesInText(`${paper.title} ${paper.abstract ?? ''}`)),
  )
  const paperSources = (pattern: RegExp, limit = 3) => {
    const selectedIds = papers
      .filter((paper) => pattern.test(`${paper.title} ${paper.abstract ?? ''}`))
      .slice(0, limit)
      .map((paper) => `paper:${paper.id}`)
    // Every candidate must bind at least one verified paper source; a
    // pattern that matches nothing falls back to the full verified corpus
    // rather than shipping a literature-free candidate.
    return selectedIds.length > 0 ? [...new Set([...selectedIds, ...localSourceIds])] : allSources
  }
  const candidates: Array<{
    key: string
    statement: string
    composition: Array<{
      mechanism: string
      role: 'dominant' | 'secondary' | 'coupled' | 'unknown'
    }>
    predictions: string[]
    falsification: string[]
    sources: string[]
    cued: boolean
  }> = []

  candidates.push({
    key: 'wave',
    statement: `${regionLabel} 中描述的${hasWaveCue ? '传播或准周期扰动' : '多波段演化'}可由波能沿磁结构传输并耗散解释；当前将其作为与脉冲加热并列的候选，而非既定结论。`,
    composition: [
      { mechanism: '阿尔芬波传播、反射与耗散', role: hasWaveCue ? 'dominant' : 'unknown' },
    ],
    predictions: [
      '在冻结预处理的 AIA 171 Å/193 Å ROI 强度时序中，应出现跨通道相关且至少覆盖两个周期的可重复候选功率峰。',
      '完成 WCS 配准与环路径提取后，扰动应具有可重复的传播速度或相位差。',
      '扰动功率或振幅随传播距离衰减，并与热响应时间变化保持稳定关系。',
    ],
    falsification: [
      '冻结参数的独立事件中不再出现跨通道相关的可重复候选功率峰。',
      '完成时间同步、去趋势和空间路径测量后，不存在稳定传播或相位关系。',
    ],
    sources: paperSources(/MHD waves|Alfv[eé]n|non-thermal|coronal heating/i),
    cued: hasWaveCue,
  })

  candidates.push({
    key: 'reconnection',
    statement: `${regionLabel} 中描述的${hasReconnectionCue ? '局部热通道增亮与磁场演化' : '热演化'}可由间歇性小尺度重联事件累积解释；需要用事件统计与磁场背景检验。`,
    composition: [
      { mechanism: '磁重联与纳耀斑脉冲加热', role: hasReconnectionCue ? 'dominant' : 'unknown' },
    ],
    predictions: [
      '冻结预处理的 94 Å/131 Å ROI 强度时序中应出现间歇且可重复的热通道增强。',
      '完成通道响应校正后，热通道增强应在较冷通道中形成有序时间延迟。',
      '事件目录的 fluence 分布应呈现有限的幂律尾部，且发生率与磁场演化相关。',
    ],
    falsification: [
      '冻结参数的独立事件中，94 Å/131 Å 时序不再呈现预设的间歇增强。',
      '完成事件检测、通道响应和磁图配准后，增强既无有序冷却时延，也不与磁结构演化相关。',
    ],
    sources: paperSources(/nanoflare|impulsive|Fe XIX|time-dependence/i),
    cued: hasReconnectionCue,
  })

  candidates.push({
    key: 'coupled',
    statement: `${regionLabel} 的现象允许波动传输、湍流级联与间歇性重联耦合：波动负责输运和触发，局地耗散与重联共同形成热响应。`,
    composition: [
      { mechanism: '波动与湍流能量输运', role: 'coupled' },
      { mechanism: '间歇性磁重联', role: 'coupled' },
    ],
    predictions: [
      '冻结预处理的同一窗口中，波动时序指标与热通道/磁场代理指标应同时满足各自预设条件。',
      '传播扰动或频谱变化应在局部热通道增强之前出现，并与磁结构复杂度共同预测事件发生。',
    ],
    falsification: [
      '冻结参数的独立事件中，波动时序指标与热通道/磁场代理指标不能共同复现。',
      '统一处理后，波动指标、磁场代理量和热响应之间不存在稳定的先后关系或联合增益。',
    ],
    sources: paperSources(/contemporary|Recent advances|Key aspects|coronal heating/i, 4),
    cued: (hasWaveCue && hasReconnectionCue) || hasTurbulenceCue,
  })

  candidates.push({
    key: 'thermal-nonequilibrium',
    statement: `${regionLabel} 的多波段演化可由热非平衡循环解释：加热与辐射不平衡导致等离子体过冷并进入长周期往复，而非单一脉冲事件；该候选用于防止把有序冷却直接写成重联指纹。`,
    composition: [
      {
        mechanism: '热非平衡循环与长周期往复冷却',
        role: hasNonequilibriumCue ? 'dominant' : 'unknown',
      },
    ],
    predictions: [
      '冻结预处理的 171 Å/193 Å 时序中应出现长周期候选振荡或缓慢强度循环。',
      '六通道正则化 DEM 应显示持续的低温成分占比变化，而非单次脉冲后的单调冷却。',
      '热通道增强与磁场演化之间不需要存在稳定的时序关联。',
    ],
    falsification: [
      '冻结参数的独立事件中不存在长周期候选振荡或循环往复强度变化。',
      'DEM 热结构在去趋势后仍表现为单峰脉冲冷却，无持续低温成分演化。',
    ],
    sources: paperSources(/thermal nonequilibrium|nonequilibrium|cycle|overcooling|long.?period/i),
    cued: hasNonequilibriumCue,
  })

  candidates.push({
    key: 'turbulent-cascade',
    statement: `${regionLabel} 的热响应可由磁湍流级联解释：大尺度磁结构经级联把能量输入小尺度耗散，形成宽谱加热而非离散脉冲；该候选与纳耀斑和波动耗散并列。`,
    composition: [
      { mechanism: '磁湍流级联与宽谱耗散', role: hasTurbulenceCue ? 'dominant' : 'unknown' },
    ],
    predictions: [
      '冻结预处理的 171 Å/193 Å 时序中应出现增强的高频变异与稳定候选周期。',
      '六通道正则化 DEM 应显示更宽的温度分布或持续的高温成分。',
      'IRIS Si IV 谱线在可用留出事件中应显示非热展宽或系统流速偏移。',
    ],
    falsification: [
      '冻结参数的独立事件中时序变异不高于背景对照水平。',
      'DEM 热结构无宽度或高温成分变化，可用光谱无非热展宽证据。',
    ],
    sources: paperSources(/turbulen|cascade|braid|Parker|non.?thermal|line width/i),
    cued: hasTurbulenceCue,
  })

  candidates.push({
    key: 'steady-baseline',
    statement: `${regionLabel} 的热演化可作为近稳态加热对照：若热通道变异不高于同活动区背景水平，则脉冲类候选失去特异性；该候选保留用于约束"低频脉冲 vs 严格近稳态"的区分。`,
    composition: [{ mechanism: '近稳态持续加热对照', role: hasSteadyCue ? 'dominant' : 'unknown' }],
    predictions: [
      '目标窗口的 94/131 Å 热通道相对变异应与同活动区背景对照窗口相近。',
      '冻结预处理下 94 Å/131 Å 稳健峰数应不超过背景对照的检测阈值水平。',
    ],
    falsification: [
      '目标窗口热通道变异显著高于背景对照，稳态解释失去特异性。',
      '事件目录呈现明确的间歇结构与有限幂律尾部，排除严格稳态。',
    ],
    sources: paperSources(/steady|quasi.?steady|static|steady.?state|background/i),
    cued: hasSteadyCue,
  })

  const narrativeMechanismFamilies = new Set(mechanismFamiliesInText(narrative))
  const isRelevantAlternative = (family: string) =>
    retrievedMechanismFamilies.has(family) || narrativeMechanismFamilies.has(family)

  if (isRelevantAlternative('magnetic-braiding-current-sheets')) {
    candidates.push({
      key: 'magnetic-braiding-current-sheets',
      statement: `${regionLabel} 的加热可由光球足点随机运动持续编织磁场、形成薄电流层并间歇耗散解释；该候选与泛称“湍流”或单次重联分开检验。`,
      composition: [{ mechanism: '足点磁编织—薄电流层—欧姆耗散', role: 'unknown' }],
      predictions: [
        'HMI SHARP 矢量代理应显示电流/水平场复杂度持续积累，并在热事件前局地增强。',
        '匹配几何的 MHD 前向模型应同时复现多温 DEM、空间碎裂热响应和事件等待时间。',
      ],
      falsification: [
        '独立事件中热增强不伴随任何可重复的足点驱动或电流层代理变化。',
        '仪器卷积后的编织前向模型无法同时复现空间结构和热事件统计。',
      ],
      sources: paperSources(/braid|footpoint shuffl|current sheet|Ohmic|Parker/i, 4),
      cued: narrativeMechanismFamilies.has('magnetic-braiding-current-sheets'),
    })
  }

  if (isRelevantAlternative('compressive-shocks')) {
    candidates.push({
      key: 'compressive-shocks',
      statement: `${regionLabel} 的准周期亮度扰动可能是慢模/磁声压缩波及弱冲击耗散，而不是阿尔芬波或重联事件。`,
      composition: [{ mechanism: '慢模磁声波与压缩冲击耗散', role: 'unknown' }],
      predictions: [
        '沿环强度、Doppler 速度和密度扰动应具有慢模相位关系与接近声速的传播速度。',
        '扰动振幅应随距离衰减，并伴随压缩性温度/密度响应而非纯横向位移。',
      ],
      falsification: [
        '空间传播速度、相位关系或密度响应与慢模压缩预测不相容。',
        '独立事件只显示非压缩横向扰动或无传播结构。',
      ],
      sources: paperSources(/magnetoacoustic|slow.?mode|shock|compressive|propagating/i, 4),
      cued: narrativeMechanismFamilies.has('compressive-shocks'),
    })
  }

  if (isRelevantAlternative('chromospheric-upflows-spicules')) {
    candidates.push({
      key: 'chromospheric-upflows-spicules',
      statement: `${regionLabel} 的传播亮度扰动和热通道响应可能由准周期高速上流、针状体供质与焓流驱动，而非波传播本身。`,
      composition: [{ mechanism: '色球上流/针状体供质与焓流输入', role: 'unknown' }],
      predictions: [
        'IRIS/EIS 应出现与向外传播亮度前沿同步的蓝翼非对称或系统性蓝移。',
        'DEM 发射量变化应体现质量注入，并在多温通道中呈现与纯波不同的非对称响应。',
      ],
      falsification: [
        '传播前沿没有可重复的蓝移/蓝翼非对称，且相位关系符合纯波。',
        '独立事件的发射量变化不支持质量注入或焓流贡献。',
      ],
      sources: paperSources(/spicule|upflow|enthalpy|blue.?wing|chromospheric/i, 4),
      cued: narrativeMechanismFamilies.has('chromospheric-upflows-spicules'),
    })
  }

  if (isRelevantAlternative('flux-emergence-cancellation')) {
    candidates.push({
      key: 'flux-emergence-cancellation',
      statement: `${regionLabel} 的局部加热可能由磁通涌现/消失触发的拓扑重构驱动，而非既有闭合环中的一般纳耀斑统计。`,
      composition: [{ mechanism: '磁通涌现/消失触发的拓扑重构', role: 'unknown' }],
      predictions: [
        '共空间 HMI 磁通变化应稳定领先热事件，并集中在新生/消失磁通与拓扑分界附近。',
        '矢量场外推应给出与喷流、扇脊或新生环响应一致的拓扑变化。',
      ],
      falsification: [
        '热事件与磁通涌现/消失在时间和空间上均无稳定对应。',
        '拓扑外推与观测到的热结构或流动方向不相容。',
      ],
      sources: paperSources(/flux emergence|flux cancellation|fan.?spine|jet|topolog/i, 4),
      cued: narrativeMechanismFamilies.has('flux-emergence-cancellation'),
    })
  }

  if (isRelevantAlternative('kinetic-particle-heating')) {
    candidates.push({
      key: 'kinetic-particle-heating',
      statement: `${regionLabel} 的能量耗散也可能进入动理学尺度并产生离子优先加热；现有 AIA/HMI 不能直接检验该候选。`,
      composition: [{ mechanism: '动理学尺度波粒相互作用与离子优先加热', role: 'unknown' }],
      predictions: [
        '多离子光谱应显示与质量荷比相关的温度或非热展宽差异。',
        '动理学前向模型应在独立事件中复现离子温度、速度分布和能量预算。',
      ],
      falsification: [
        '经仪器和热宽传播后，不同离子不存在预注册的优先加热差异。',
        '可接受参数范围内的动理学模型无法满足观测能量预算。',
      ],
      sources: paperSources(/ion cyclotron|kinetic|preferential ion|wave.?particle/i, 4),
      cued: narrativeMechanismFamilies.has('kinetic-particle-heating'),
    })
  }

  if (isRelevantAlternative('conductive-evaporative-response')) {
    candidates.push({
      key: 'conductive-evaporative-response',
      statement: `${regionLabel} 的多波段先后关系可能主要反映热传导、色球蒸发和辐射冷却响应；它约束能量输运过程，但不唯一指定最初释放机制。`,
      composition: [{ mechanism: '热传导—色球蒸发—辐射冷却响应', role: 'unknown' }],
      predictions: [
        '高温通道增强后应出现与传导/辐射时标相容的有序冷却和 DEM 演化。',
        '事件匹配光谱应给出与蒸发/凝结阶段一致的 Doppler 速度符号和区间。',
      ],
      falsification: [
        '冻结参数下通道时延、DEM 与光谱流动无法由同一热响应轨迹解释。',
        '独立事件的速度符号和冷却顺序系统性违背传导—蒸发模型。',
      ],
      sources: paperSources(/thermal conduction|chromospheric evaporation|cooling|enthalpy/i, 4),
      cued: narrativeMechanismFamilies.has('conductive-evaporative-response'),
    })
  }

  // Data-anchored variant candidates. Each variant is emitted only when the
  // phenomenon text or the registered data coverage provides the anchor it
  // needs, and its predictions are phrased against the registered diagnostic
  // families rather than free prose. Together with the literature-retrieved
  // alternatives above, the candidate-set size varies by phenomenon and
  // corpus coverage instead of being fixed to three mainstream mechanisms.
  const spectroscopySatisfied = coverage.satisfied.includes('spectroscopy')
  const magneticSatisfied = coverage.satisfied.includes('magnetic-context')
  const waveTimescaleSatisfied = coverage.satisfied.includes('wave-timescale')
  const thermalSatisfied = coverage.satisfied.includes('thermal-evolution')

  if (hasWaveCue) {
    candidates.push({
      key: 'wave-kinematics',
      statement: `${regionLabel} 的传播或准周期扰动若具有波动起源，应呈现稳定相速度、方向符号与随距离衰减；本变体把波动候选压缩为可测量的运动学预测，与积分强度周期候选区分。`,
      composition: [{ mechanism: '阿尔芬波传播运动学（相速度与衰减）', role: 'secondary' }],
      predictions: [
        '注册的 aia_spatial_ 空间相干/表观传播诊断应给出符号一致且跨窗口稳定的候选传播速度。',
        '注册的 aia_171_193_ 跨通道时延应在传播方向上保持稳定符号，且幅值随传播距离衰减。',
        ...(waveTimescaleSatisfied
          ? []
          : [
              '当前数据包未登记 wave-timescale 覆盖；该变体的运动学预测须等待高时间分辨率数据后执行。',
            ]),
      ],
      falsification: [
        '冻结参数下 aia_spatial_ 表观传播速度不稳定或方向与扰动传播矛盾。',
        '独立窗口的跨通道时延符号翻转且无稳定的幅值衰减关系。',
      ],
      sources: paperSources(/propagat|phase|kinemat|Alfv[eé]n wave/i),
      cued: true,
    })
  }

  if (hasReconnectionCue) {
    candidates.push({
      key: 'nanoflare-power-law',
      statement: `${regionLabel} 的间歇热通道增强若源于纳耀斑群，其事件目录应呈现有限幂律尾部与发生率-磁场演化的正相关；本变体把重联候选压缩为事件统计预测。`,
      composition: [{ mechanism: '纳耀斑事件统计（fluence 幂律与发生率）', role: 'secondary' }],
      predictions: [
        '注册的 aia_hot_event_ 事件目录诊断应给出有限幂律尾部指数与稳定的检测阈值稳健性。',
        'aia_94_131_ 相对变异应显著高于 target_to_background_ 背景对照水平。',
      ],
      falsification: [
        '事件目录在冻结检测阈值下无有限幂律尾部或对阈值选择强敏感。',
        '目标窗口热通道变异不高于同活动区背景对照，事件统计失去脉冲特异性。',
      ],
      sources: paperSources(/nanoflare|power.?law|fluence|impulsive/i),
      cued: true,
    })
  }

  if (hasReconnectionCue && magneticSatisfied) {
    candidates.push({
      key: 'magnetic-thermal-coupling',
      statement: `${regionLabel} 中若间歇加热由磁场驱动，热通道增强的起始应与矢量磁场演化量存在可重复的时序先导关系；本变体检验磁—热时序耦合而非共同演化。`,
      composition: [{ mechanism: '磁—热时序耦合（矢量磁场先导）', role: 'secondary' }],
      predictions: [
        '注册的 hmi_sharp_hot_event_ 磁—热关联诊断应给出热峰之前磁场代理量的稳定先导时移。',
        'hmi_sharp_ 矢量磁场演化量在热事件窗口的统计分布应显著区别于非事件窗口。',
      ],
      falsification: [
        '冻结配准下热峰起始与磁场代理量之间无稳定先导时移或时移方向不稳定。',
        '事件窗口与非事件窗口的磁场演化分布不可区分。',
      ],
      sources: paperSources(/magnetic|current|helicity|PIL|vector/i),
      cued: true,
    })
  }

  if (hasNonequilibriumCue || thermalSatisfied) {
    candidates.push({
      key: 'dem-evolution',
      statement: `${regionLabel} 的热演化若由加热-辐射失衡主导，六通道 DEM 应呈现持续的低/高温成分再分布而非单峰脉冲冷却；本变体把热结构演化单独列为可证伪候选。`,
      composition: [{ mechanism: 'DEM 热结构演化（成分再分布）', role: 'secondary' }],
      predictions: [
        '注册的 aia_dem_ 正则化 DEM 诊断应给出低温成分占比的系统性变化轨迹。',
        'aia_cooling_ 冷却时延应在多通道间保持有序排列并与 DEM 冷却轨迹一致。',
      ],
      falsification: [
        'DEM 热结构在去趋势后表现为单峰单调冷却，无持续成分再分布。',
        '多通道冷却时延排序在独立窗口间不稳定。',
      ],
      sources: paperSources(/differential emission measure|DEM|thermal structure/i),
      cued: hasNonequilibriumCue,
    })
  }

  if (hasTurbulenceCue && spectroscopySatisfied) {
    candidates.push({
      key: 'spectroscopic-nonthermal',
      statement: `${regionLabel} 的湍流级联若真实存在，注册的 IRIS Si IV 光谱诊断应在可用事件中给出超出热宽度的非热展宽或系统性流速偏移；本变体只在光谱覆盖就绪时保留。`,
      composition: [{ mechanism: '光谱非热展宽与流速诊断', role: 'secondary' }],
      predictions: [
        '注册的 iris_ 相对 Doppler 诊断应给出与冻结校准一致、跨栅格稳定的非热速度或流速偏移区间。',
        '非热速度的符号与幅值应与热通道事件时间有可重复的对应关系。',
      ],
      falsification: [
        '光谱非热速度区间与纯热+仪器宽度传播结果不可区分。',
        '流速偏移在独立栅格间符号不稳定或与热事件无对应。',
      ],
      sources: paperSources(/non.?thermal|turbulen|line width|Si IV/i),
      cued: true,
    })
  }

  if (hasReconnectionCue || hasNonequilibriumCue || hasSteadyCue) {
    candidates.push({
      key: 'thermal-process-cohort',
      statement: `${regionLabel} 的多活动区样本若共享同一低频脉冲热过程，则跨独立事件的 aia_94_131_ 变异指标应在留出事件中保持统计一致，而具体能量释放机制保持未定；本变体把过程级结论与机制级结论显式分离。`,
      composition: [
        {
          mechanism: '跨事件低频脉冲热过程（作用域受限）',
          role: hasReconnectionCue ? 'dominant' : 'secondary',
        },
      ],
      predictions: [
        '跨独立活动区留出事件中，注册的 aia_94_131_ 变异指标应保持同号且达到预注册功效。',
        '跨事件一致的热过程不应被归因于单一微观机制：机制区分指标需另行登记。',
      ],
      falsification: [
        '留出事件的变异指标符号不一致或未达到预注册功效下限。',
        '跨事件一致性消失且只能由单一事件驱动。',
      ],
      sources: paperSources(/cross.?event|population|distribution|statistic/i),
      cued: true,
    })
  }

  const hypotheses = candidates.map((candidate) =>
    ScientificHypothesisSchema.parse({
      id: `h-local-${candidate.key}-${digest({
        runId: context.runId,
        phenomenon: phenomenon.phenomenonId,
        candidate: candidate.key,
      }).slice(0, 10)}`,
      statement: candidate.statement,
      mechanismComposition: candidate.composition,
      predictions: candidate.predictions,
      falsificationConditions: candidate.falsification,
      sourceIds: candidate.sources.length > 0 ? candidate.sources : allSources,
      scope: `基于 ${regionLabel} 的输入文本、本地核验文献和 ${selected?.label ?? '当前可用观测目录'}`,
      evidenceStrengthGrade: 'not_assessed',
      priority: candidate.cued ? 'high' : 'medium',
      priorityReason: candidate.cued
        ? '输入现象包含对应物理线索，且现有本地多波段时序可先检验至少一条原子预测。'
        : '物理上值得保留，但当前输入线索较弱；先作为对照候选，避免把机制预设为结论。',
      parentId: null,
      round: context.round,
      status: 'candidate',
    }),
  )

  input.emitChunk?.({
    type: 'custom',
    kind: 'scientific.retrieval',
    stage: 'librarian',
    round: context.round,
    status: 'grounded',
    message: `本地资料模式完成：检索 ${papers.length} 篇核验文献，匹配 ${matches.cases.length} 个观测窗口；数据包核验 ${pack.verifiedAssetCount}/${pack.expectedAssetCount} 个文件。`,
    sourceCount: allSources.length,
    paperCount: papers.length,
    localCaseCount: matches.cases.length,
    tools: [
      {
        id: 'searchPapers',
        label: '本地核验文献',
        status: 'completed',
        resultCount: papers.length,
      },
      { id: 'searchHypotheses', label: '历史候选查重', status: 'skipped', resultCount: 0 },
      {
        id: 'searchLocalSolarData',
        label: '本地观测检索',
        status: 'completed',
        resultCount: matches.cases.length,
      },
      {
        id: 'checkLocalSolarCoverage',
        label: '数据覆盖核验',
        status: 'completed',
        resultCount: coverage.satisfied.length,
      },
    ],
  } as never)
  input.emitChunk?.({
    type: 'custom',
    kind: 'scientific.reasoning-summary',
    stage: 'librarian',

    round: context.round,
    agentId: 'librarian',
    title: '本地资料形成候选的依据',
    summary: `根据现象、三路开放检索和可证伪差异生成 ${hypotheses.length} 个候选；不设三类机制或固定条数，引用仅来自核验文献语料和实际匹配的观测目录。`,
    hypothesisCount: hypotheses.length,
  } as never)
  return {
    hypotheses,
    coverageAudit: buildHypothesisCoverageAudit({
      hypotheses,
      papers,
      retrievalSourceCount: allSources.length,
      modeLabel: 'local-grounded 开放世界候选生成',
    }),
  }
}

function revisionTargets(context: Readonly<HypothesisGenerationContext>): ScientificHypothesis[] {
  const targetIds = new Set<string>()
  for (const task of context.context.validationTasks) {
    if (task.type !== 'model-update' && task.route !== 'librarian') continue
    if (context.existingHypotheses.some((item) => item.id === task.triggeredBy)) {
      targetIds.add(task.triggeredBy)
      continue
    }
    const triggeringEvidence = context.context.evidence.find(
      (item) => item.evidenceId === task.triggeredBy,
    )
    if (triggeringEvidence?.hypothesisId) targetIds.add(triggeringEvidence.hypothesisId)
  }
  const active = context.existingHypotheses.filter(
    (item) => item.status !== 'eliminated' && item.status !== 'revised',
  )
  return targetIds.size > 0 ? active.filter((item) => targetIds.has(item.id)) : active
}

function localHypothesisRevisions(
  context: Readonly<HypothesisGenerationContext>,
): HypothesisGenerationResult {
  const targets = revisionTargets(context)
  if (targets.length === 0) return { hypotheses: [...context.existingHypotheses] }
  const relevantTasks = context.context.validationTasks.filter(
    (task) => task.route === 'librarian' || task.type === 'model-update',
  )
  const revisedParents = targets.map((parent) => ({ ...parent, status: 'revised' as const }))
  const children = targets.map((parent) => {
    const relatedEvidence = context.context.evidence.filter(
      (item) => item.hypothesisId === parent.id,
    )
    const task = relevantTasks.find(
      (item) =>
        item.triggeredBy === parent.id ||
        relatedEvidence.some((evidence) => evidence.evidenceId === item.triggeredBy),
    )
    return ScientificHypothesisSchema.parse({
      ...parent,
      id: `h-revision-${digest({
        runId: context.runId,
        parentId: parent.id,
        round: context.round,
        task: task?.fingerprint ?? 'evidence-driven',
      }).slice(0, 16)}`,
      predictions: [...parent.predictions],
      falsificationConditions: [
        ...new Set([
          ...parent.falsificationConditions,
          ...(task ? [`未能满足验证任务：${task.objective}`] : []),
        ]),
      ],
      scope: `${parent.scope}；第 ${context.round} 轮仅针对新增证据和验证任务修订${
        task ? `；待区分结果：${task.discriminatingOutcomes.join('、')}` : ''
      }`,
      confidence: undefined,
      confidenceBasis: undefined,
      evidenceStrengthGrade: 'not_assessed',
      parentId: parent.id,
      round: context.round,
      status: 'candidate',
    })
  })
  return { hypotheses: [...revisedParents, ...children] }
}

async function modelHypothesisRevisions(
  input: DefaultScientificServicesInput,
  context: Readonly<HypothesisGenerationContext>,
): Promise<HypothesisGenerationResult> {
  const targets = revisionTargets(context)
  if (targets.length === 0) return { hypotheses: [...context.existingHypotheses] }
  const knownSources = new Set([
    ...sourceIds(context.phenomenon),
    ...context.existingHypotheses.flatMap((item) => item.sourceIds),
    ...context.context.evidence.flatMap((item) => item.sourceIds),
  ])
  const result = await runScientificModelTask({
    projectId: input.projectId,
    runId: input.runId,
    agentId: 'librarian-hypothesis-revision',
    role: 'librarian',
    modelConfig: input.agentConfigs?.librarian?.modelConfig ?? input.modelConfig,
    schema: ModelHypothesisRevisionSchema,
    round: context.round,
    emitChunk: input.emitChunk,
    abortSignal: input.abortSignal,
    prompt: [
      '请依据新增证据和验证任务修订候选假设。不得随机换题，不得创造未登记的观测或来源。',
      '每个修订必须引用一个现有 parentId，并给出可观测预测、证伪条件和 changeRationale。',
      `现象：${JSON.stringify(context.phenomenon)}`,
      `待修订假设：${JSON.stringify(targets)}`,
      `证据：${JSON.stringify(context.context.evidence)}`,
      `验证任务：${JSON.stringify(context.context.validationTasks)}`,
      steeringPromptBlock(context.steering),
    ].join('\n'),
  })
  const parents = new Map(targets.map((item) => [item.id, item]))
  const revisedParentIds = new Set<string>()
  const children = result.revisions.flatMap((revision) => {
    const parent = parents.get(revision.parentId)
    if (!parent) return []
    revisedParentIds.add(parent.id)
    const acceptedSources = revision.sourceIds.filter((id) => knownSources.has(id))
    return [
      ScientificHypothesisSchema.parse({
        id: `h-revision-${digest({
          runId: context.runId,
          parentId: parent.id,
          round: context.round,
          revision,
        }).slice(0, 16)}`,
        statement: revision.statement,
        mechanismComposition: revision.mechanismComposition,
        predictions: revision.predictions,
        falsificationConditions: revision.falsificationConditions,
        sourceIds: acceptedSources.length > 0 ? acceptedSources : parent.sourceIds,
        scope: `${revision.scope}；修订依据：${revision.changeRationale}`,
        evidenceStrengthGrade: 'not_assessed',
        priority: parent.priority,
        priorityReason: parent.priorityReason,
        parentId: parent.id,
        round: context.round,
        status: 'candidate',
      }),
    ]
  })
  if (children.length === 0) {
    return {
      hypotheses: [...context.existingHypotheses],
      corrections: [
        generationCorrection(
          context,
          'warning',
          '模型未生成可关联到现有父假设的有效修订。',
          '保留原假设，不将无来源的变化写入科学状态。',
        ),
      ],
    }
  }
  input.emitChunk?.({
    type: 'custom',
    kind: 'scientific.reasoning-summary',
    stage: 'librarian',
    round: context.round,
    agentId: 'librarian-hypothesis-revision',
    title: '证据驱动的假设修订',
    summary: result.reasoningSummary,
    hypothesisCount: children.length,
  } as never)
  return {
    hypotheses: [
      ...targets
        .filter((parent) => revisedParentIds.has(parent.id))
        .map((parent) => ({ ...parent, status: 'revised' as const })),
      ...children,
    ],
  }
}

async function generateHypotheses(
  input: DefaultScientificServicesInput,
  context: Readonly<HypothesisGenerationContext>,
): Promise<HypothesisGenerationResult> {
  if (context.round > 1) {
    if (input.localGrounded) {
      const result = localHypothesisRevisions(context)
      return withLocalSteeringNote(context, result)
    }
    return modelHypothesisRevisions(input, context)
  }

  if (input.localGrounded) {
    const result = await generateLocalGroundedHypotheses(input, context)
    return withLocalSteeringNote(context, result)
  }
  const retrieval = createRetrievalTrace(context.phenomenon)
  const emitLibrarianChunk: EmitChunk = (chunk) => {
    captureRetrievalChunk(retrieval, chunk)
    input.emitChunk?.(chunk)
  }

  const emitRetrieval = (status: 'grounded' | 'limited' | 'blocked', message: string) => {
    input.emitChunk?.({
      type: 'custom',
      kind: 'scientific.retrieval',
      stage: 'librarian',
      round: context.round,
      status,
      message,
      sourceCount: retrieval.sourceIds.size,
      paperCount: retrieval.paperCount,
      localCaseCount: retrieval.localCaseCount,
      tools: Object.entries(retrieval.tools).map(([id, state]) => ({
        id,
        label: RETRIEVAL_TOOL_LABELS[id as RetrievalToolName],
        status: state.failed
          ? 'failed'
          : state.completed
            ? 'completed'
            : state.called
              ? 'running'
              : 'skipped',
        resultCount: state.resultCount,
      })),
    } as never)
  }

  try {
    const pool = await librarianWorkflow({
      seed: phenomenonPrompt(context.phenomenon) + steeringPromptBlock(context.steering),
      projectId: input.projectId,
      runId: input.runId,
      modelConfig: input.modelConfig,
      agentConfig: input.agentConfigs?.librarian,
      emitChunk: emitLibrarianChunk,
      abortSignal: input.abortSignal,
      scientific: true,
    })

    const rationale = typeof pool.rationale === 'string' ? conciseText(pool.rationale) : ''
    if (rationale) {
      input.emitChunk?.({
        type: 'custom',
        kind: 'scientific.reasoning-summary',
        stage: 'librarian',
        round: context.round,
        agentId: 'librarian',
        title: '候选机制的形成依据',
        summary: rationale,
        hypothesisCount: pool.hypotheses.length,
      } as never)
    }

    const criticalToolIds: RetrievalToolName[] = [
      'searchPapers',
      'searchLocalSolarData',
      'checkLocalSolarCoverage',
    ]
    const missingCriticalTools = criticalToolIds
      .filter((id) => !retrieval.tools[id].completed)
      .map((id) => RETRIEVAL_TOOL_LABELS[id])
    const historyUnavailable = !retrieval.tools.searchHypotheses.completed
    const sourceScope = [...retrieval.sourceIds]
    const retrievalStatus: 'grounded' | 'limited' | 'blocked' =
      missingCriticalTools.length > 0 || sourceScope.length === 0
        ? 'blocked'
        : retrieval.paperCount > 0 && retrieval.localCaseCount > 0 && !historyUnavailable
          ? 'grounded'
          : 'limited'

    const retrievalMessage =
      retrievalStatus === 'grounded'
        ? `已检索 ${retrieval.paperCount} 篇文献和 ${retrieval.localCaseCount} 个本地观测案例，候选假设仅使用这些来源。`
        : retrievalStatus === 'limited'
          ? `必要检索已完成，当前获得 ${retrieval.paperCount} 篇文献和 ${retrieval.localCaseCount} 个本地观测案例${historyUnavailable ? '；历史候选索引不可用，本轮跳过查重' : ''}。`
          : missingCriticalTools.length > 0
            ? `必要检索未完成：${missingCriticalTools.join('、')}。`
            : '文献和本地观测检索均未返回可核验来源。'
    emitRetrieval(retrievalStatus, retrievalMessage)

    if (retrievalStatus === 'blocked') {
      return {
        hypotheses: [],
        corrections: [
          generationCorrection(
            context,
            'error',
            retrievalMessage,
            '检查文献索引、本地数据目录和模型工具调用后重新运行 Librarian 假设生成。',
          ),
        ],
      }
    }

    const activeRegion = inferredActiveRegion(context.phenomenon) ?? '当前活动区'
    const candidateIds = new Map(
      pool.hypotheses.map((candidate, index) => {
        const sourceId = candidate.id || `candidate-${index + 1}-${digest(candidate).slice(0, 8)}`
        return [
          sourceId,
          `h-librarian-${digest({
            runId: context.runId,
            sourceId,
          }).slice(0, 16)}`,
        ]
      }),
    )
    const converted = pool.hypotheses.flatMap((candidate, index) => {
      const sourceId = candidate.id || `candidate-${index + 1}-${digest(candidate).slice(0, 8)}`
      const declaredSourceIds = candidate.sourceIds.filter((sourceId) =>
        sourceScope.includes(sourceId),
      )
      const parsed = ScientificHypothesisSchema.safeParse({
        id: candidateIds.get(sourceId),
        statement: candidate.statement,
        mechanismComposition: candidate.mechanismComposition?.length
          ? candidate.mechanismComposition.map(({ mechanism, role }) => ({ mechanism, role }))
          : [{ mechanism: candidate.mechanism, role: 'unknown' }],
        predictions: candidate.predictions,
        falsificationConditions: candidate.falsificationConditions,
        sourceIds: declaredSourceIds.length > 0 ? declaredSourceIds : sourceScope,
        scope:
          candidate.scope ??
          (/(?:所选.{0,8}样本|跨事件|队列|多活动区|sample|cohort|cross-event)/i.test(
            `${candidate.statement} ${candidate.mechanism}`,
          )
            ? '仅针对本地观测包中预先登记的跨活动区 validation/holdout 样本，不外推到单一活动区或全部太阳日冕。'
            : `仅针对 ${activeRegion} 的现象描述和本轮实际检索来源`),
        evidenceStrengthGrade: 'not_assessed',
        priority: candidate.predictions.some((prediction) =>
          /(?:171|193|94|131|AIA|HMI|时序|背景|留出)/i.test(prediction),
        )
          ? 'high'
          : 'medium',
        priorityReason: candidate.predictions.some((prediction) =>
          /(?:171|193|94|131|AIA|HMI|时序|背景|留出)/i.test(prediction),
        )
          ? '至少一条预测可映射到当前登记的多波段观测或本地确定性诊断，优先获取区分性证据。'
          : '预测需要外部数据、模拟或尚未注册的诊断；先保留为中优先级候选。',
        parentId: candidate.parentId ? (candidateIds.get(candidate.parentId) ?? null) : null,
        round: context.round,
        status: 'candidate',
      })
      return parsed.success ? [normalizeScopedImpulsiveStatement(parsed.data)] : []
    })

    if (converted.length === 0) {
      return {
        hypotheses: [],
        corrections: [
          generationCorrection(
            context,
            'error',
            '模型未提交满足结构与来源约束的候选假设。',
            '调整现象描述或模型输出协议后重新运行 Librarian 假设生成。',
          ),
        ],
      }
    }

    const coverageAudit = buildHypothesisCoverageAudit({
      hypotheses: converted,
      papers: rationale ? [{ title: rationale }] : [],
      retrievalSourceCount: sourceScope.length,
      modeLabel: 'model-assisted 多源开放检索',
    })

    return retrievalStatus === 'limited'
      ? {
          hypotheses: converted,
          coverageAudit,
          corrections: [
            generationCorrection(
              context,
              'warning',
              '当前候选仅获得部分资料支撑；缺失的文献或观测不作推断。',
              '在进入机制判断前补齐缺失资料，并保持相关证据为 unknown。',
            ),
          ],
        }
      : { hypotheses: converted, coverageAudit }
  } catch (error) {
    const message = safeGenerationFailure(error)
    emitRetrieval('blocked', message)
    input.emitChunk?.({
      type: 'custom',
      kind: 'scientific.self-correction',
      stage: 'librarian',
      status: 'blocked',
      round: context.round,
      message,
    } as never)
    return {
      hypotheses: [],
      corrections: [
        generationCorrection(
          context,
          'error',
          message,
          '检查模型、HelixDB 和本地数据工具后重新运行 Librarian 假设生成。',
        ),
      ],
    }
  }
}
function unknownEvidence(
  agentId: string,
  context: Readonly<EvidenceAgentContext>,
  hypothesis: ScientificHypothesis,
  limitation: string,
) {
  return {
    evidenceId: `e-${agentId}-${digest({ hypothesis: hypothesis.id, round: context.round }).slice(0, 12)}`,
    hypothesisId: hypothesis.id,
    agentId,
    status: 'unknown' as const,
    evidenceRole: 'diagnostic_boundary' as const,
    contradictionScope: 'mechanism' as const,
    claim: `当前不能用已登记数据甄别“${hypothesis.statement}”。`,
    observed: '本轮只完成数据可用性或证据边界检查，尚未得到可重复的机制区分指标。',
    method: agentId,
    sourceIds: sourceIds(context.phenomenon),
    sampleIds: [],
    predictionIds: [],
    falsificationConditionIds: [],
    quantitativeResults: [],
    limitations: [limitation],
    round: context.round,
  }
}
export function localValidationExecutor(task: ValidationTask): string | null {
  if (
    task.status !== 'planned' ||
    task.type !== 'analysis' ||
    !task.requiredSourceIds.includes(LOCAL_CORONAL_SOURCE_ID)
  )
    return null
  // Objectives embed stable ids (`h-…:prediction:N`, task fingerprints, …)
  // whose hex digests can contain domain keywords ("131", "94", …). Match on
  // the stripped natural-language text so claiming never depends on hash
  // collisions (regression: h-local-wave-kinematics-6013bc0131).
  const objective = stripStableIdTokens(task.objective)
  const requestedExecutor = task.executorId
  // Contract-driven claiming (P1-7): every pattern lives in the
  // EXECUTOR_CONTRACTS registry. The two historical code paths are preserved
  // exactly: a requested executor validates its own capability pattern, and
  // an unowned task walks the ordered keyword-inference chain.
  if (requestedExecutor) {
    const requested = executorContractByExecutorId(requestedExecutor)
    // The registered spectroscopy executor validates its objective before
    // the compound rejection, matching the pre-refactor early return.
    if (requested?.bypassesCompoundRejection) {
      return requested.requestedPattern.test(objective) ? requested.executorId : null
    }
  }
  if (COMPOUND_TASK_REJECTION_PATTERN.test(objective)) return null
  if (task.executorId === 'external') return null
  if (requestedExecutor) {
    const requested = executorContractByExecutorId(requestedExecutor)
    if (!requested) return null
    if (requested.requestedExcludePattern?.test(objective)) return null
    return requested.requestedPattern.test(objective) ? requested.executorId : null
  }
  for (const contract of inferableExecutorContracts()) {
    if ((contract.inferencePattern ?? contract.requestedPattern).test(objective)) {
      return contract.executorId
    }
  }
  return null
}

function hasRunnableLocalTask(context: Readonly<EvidenceAgentContext>): boolean {
  // Only planned tasks are work for a later round. Completed tasks remain in
  // state for provenance and reporting, but must not reopen the local loader
  // or semantic reviewers as if they were new scientific work.
  return context.validationTasks.some(
    (task) => task.status === 'planned' && localValidationExecutor(task) !== null,
  )
}

function localObservationCatalogAgent(): EvidenceAgent {
  return {
    id: 'looker-local-observation-catalog',
    label: `${agentLabel('looker')}：本地观测目录审计`,
    executionKind: 'deterministic',
    capabilities: ['source-audit', 'observation-analysis', 'timeseries-analysis', 'fact-check'],
    // The manifest and coverage catalog are run-invariant. Repeating the same
    // catalog record in later rounds adds no independent scientific evidence.
    canRun: (context) => context.round === 1,
    run: async (context) => {
      try {
        const activeRegion = inferredActiveRegion(context.phenomenon)
        const query = `${context.phenomenon.title} ${context.phenomenon.description}`
        const [pack, matches] = await Promise.all([
          verifyCoronalDataPack(),
          searchCoronalObservationCases({ activeRegion, query, limit: 1 }),
        ])
        const selected = matches.cases[0]
        const coverage = await assessCoronalDataCoverage({
          activeRegion,
          query,
          caseId: selected?.caseId,
          requirements: [
            'thermal-evolution',
            'magnetic-context',
            'wave-timescale',
            'spectroscopy',
            'simulation',
          ],
        })
        const satisfied = coverage.satisfied.length > 0 ? coverage.satisfied.join('、') : '无'
        const unavailable = coverage.unavailable.length > 0 ? coverage.unavailable.join('、') : '无'
        const limitation = coverage.case
          ? `已定位 ${coverage.case.label}；当前目录步骤只确认数据覆盖（可用：${satisfied}；未覆盖：${unavailable}）。WCS 对齐和诊断由后续确定性处理运行完成；目录覆盖本身不能升级为机制证据。`
          : '当前本地包未找到与该现象匹配的活动区窗口；不能将其他活动区的观测移作证据。'
        const corrections = [
          ...(pack.primaryPackReady
            ? []
            : [
                {
                  stage: 'B-data-integrity',
                  severity: 'error' as const,
                  message: '本地日冕观测包完整性未通过。',
                  action: '停止使用该包并先修复缺失或尺寸不符的观测文件。',
                  affectedIds: pack.missingAssetIds,
                },
              ]),
          ...(coverage.unavailable.length > 0
            ? [
                {
                  stage: 'B-fact-correction',
                  severity: 'warning' as const,
                  message: `本轮没有覆盖：${unavailable}。`,
                  action: '将这些诊断写入下一步验证计划，不把缺失诊断解释为支持或反驳。',
                },
              ]
            : []),
        ]
        return {
          evidence: context.hypotheses.map((hypothesis) => ({
            ...unknownEvidence('looker-local-observation-catalog', context, hypothesis, limitation),
            claim: coverage.case
              ? `数据处理结果：${coverage.case.label} 已完成文件完整性、仪器、波段、cadence 与诊断覆盖核验。`
              : '数据处理结果：本地目录未匹配到当前活动区，已形成补充数据任务。',
            observed: coverage.case
              ? `本地包已核验 ${coverage.case.verifiedAssetCount}/${coverage.case.expectedAssetCount} 个文件，含 ${coverage.case.instruments.join('、')}；这里只报告目录覆盖。`
              : '本轮没有匹配的本地观测窗口。',
            sourceIds: [LOCAL_CORONAL_SOURCE_ID],
            method: 'manifest-integrity + file-size-verification + band-cadence-coverage',
            sampleIds: coverage.case?.sampleAssetIds ?? [],
          })),
          // Lineage-local mode: local evidence depends only on primary-pack
          // assets; a failed supplement degrades its own lineage without
          // invalidating the AIA cohort (P0-2 unification).
          verifiedSourceIds: pack.primaryPackReady ? [LOCAL_CORONAL_SOURCE_ID] : [],
          limitations: [...coverage.limitations, limitation],
          corrections,
        }
      } catch (error) {
        const limitation = `本地日冕数据工具调用失败：${error instanceof Error ? error.message : String(error)}`
        return {
          evidence: context.hypotheses.map((hypothesis) =>
            unknownEvidence('looker-local-observation-catalog', context, hypothesis, limitation),
          ),
          limitations: [limitation],
          corrections: [
            {
              stage: 'B-data-tool',
              severity: 'error',
              message: limitation,
              action: '保留 unknown，并在下一轮先修复本地数据工具或 manifest。',
            },
          ],
        }
      }
    },
  }
}

type LocalProcessingLoader = (
  context: Readonly<EvidenceAgentContext>,
) => Promise<LocalProcessingResult[]>

/**
 * Preserve request order while limiting memory-heavy deterministic workers.
 * A full coronal case can hold several hundred MiB of WCS/DEM arrays; starting
 * every validation/holdout case at once made cold-cache runs vulnerable to the
 * OS terminating Python without a useful traceback.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer')
  }
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const runWorker = async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await worker(items[index]!, index)
    }
  }
  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}

function createLocalProcessingLoader(input: DefaultScientificServicesInput): LocalProcessingLoader {
  const cache = new Map<string, Promise<LocalProcessingResult>>()
  return async (context) => {
    if (context.round > 1 && !hasRunnableLocalTask(context)) return []
    const activeRegion = inferredActiveRegion(context.phenomenon)
    const query = `${context.phenomenon.title} ${context.phenomenon.description}`
    const runnableTasks = context.validationTasks.filter(
      (item) => item.status === 'planned' && localValidationExecutor(item) !== null,
    )
    const primaryMatches = await searchCoronalObservationCases({ activeRegion, query, limit: 1 })
    const primary = primaryMatches.cases[0]
    const requests: Array<{
      caseId: string
      mode: 'discovery' | 'validation' | 'holdout'
      purpose: 'primary' | 'cross_event'
    }> = []
    const needsPrimary =
      context.round === 1 ||
      runnableTasks.some(
        (task) => localValidationExecutor(task) !== 'coronal-cross-event-holdout-v1',
      )
    if (primary && needsPrimary) {
      requests.push({
        caseId: primary.caseId,
        mode: context.round > 1 || runnableTasks.length > 0 ? 'validation' : 'discovery',
        purpose: 'primary',
      })
    }
    if (
      runnableTasks.some(
        (item) => localValidationExecutor(item) === 'coronal-cross-event-holdout-v1',
      )
    ) {
      const catalog = await searchCoronalObservationCases({ limit: 20 })
      const usedActiveRegions = new Set(primary ? [primary.activeRegion] : [])
      const selected = catalog.cases
        .filter(
          (candidate) =>
            candidate.role !== 'background_control' &&
            !/background/i.test(candidate.caseId) &&
            candidate.caseId !== primary?.caseId,
        )
        .sort((left, right) => {
          const priority = (role?: string) =>
            role === 'holdout' ? 0 : role === 'independent_target' ? 1 : 2
          return priority(left.role) - priority(right.role)
        })
        .filter((candidate) => {
          if (usedActiveRegions.has(candidate.activeRegion)) return false
          usedActiveRegions.add(candidate.activeRegion)
          return true
        })
        // The frozen pack currently contains six non-primary active-region targets.
        // Keep all of them eligible so the evidence gate can assess method diversity;
        // a smaller top-k silently omitted the cooling and DEM replication events.
        .slice(0, 6)
      for (const candidate of selected) {
        requests.push({
          caseId: candidate.caseId,
          mode: candidate.role === 'holdout' ? 'holdout' : 'validation',
          purpose: 'cross_event',
        })
      }
    }
    return mapWithConcurrency(requests, 2, async (request) => {
      // A deterministic processing result is identified by its input and
      // processor version, not by the orchestration round. Reusing this key
      // prevents a later round from recomputing and re-emitting the same
      // diagnostic as if it were new evidence.
      const key = `${request.caseId}:${request.mode}:${request.purpose}`
      let pending = cache.get(key)
      if (!pending) {
        pending = runLocalCoronalProcessing({
          projectId: input.projectId,
          runId: input.runId,
          round: context.round,
          caseId: request.caseId,
          mode: request.mode,
          signal: context.signal,
        }).then((result) => ({ ...result, selectionPurpose: request.purpose }))
        cache.set(key, pending)
      }
      return pending
    })
  }
}

type ModelScheduler = <T>(work: () => Promise<T>) => Promise<T>

function createModelScheduler(): ModelScheduler {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>) => {
    const next = tail.then(work, work)
    tail = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}

function hypothesisPromptRows(hypotheses: readonly ScientificHypothesis[]) {
  return hypotheses.map((hypothesis) => ({
    id: hypothesis.id,
    statement: hypothesis.statement,
    mechanisms: hypothesis.mechanismComposition,
    predictions: hypothesis.predictions.map((statement, index) => ({
      predictionId: scientificPredictionId(hypothesis.id, index),
      statement,
    })),
    falsificationConditions: hypothesis.falsificationConditions.map((statement, index) => ({
      falsificationConditionId: scientificFalsificationConditionId(hypothesis.id, index),
      statement,
    })),
    sourceIds: hypothesis.sourceIds,
  }))
}

function priorEvidencePromptRows(evidence: readonly EvidenceRecord[]) {
  return evidence.map((item) => ({
    evidenceId: item.evidenceId,
    hypothesisId: item.hypothesisId,
    agentId: item.agentId,
    status: item.status,
    claim: item.claim,
    observed: item.observed,
    method: item.method,
    sourceIds: item.sourceIds,
    metrics: item.metrics,
    evidenceRole: item.evidenceRole,
    contradictionScope: item.contradictionScope,
    adjudication: item.adjudication,
    hasDeterministicProvenance: Boolean(item.provenance),
    limitations: item.limitations,
  }))
}

function mapModelReview(
  agentId: string,
  context: Readonly<EvidenceAgentContext>,
  review: ModelEvidenceReview,
  allowedSourceIds: readonly string[],
) {
  const hypothesisIds = new Set(context.hypotheses.map((item) => item.id))
  const allowedSources = new Set(allowedSourceIds)
  const evidence = review.findings
    .filter((finding) => hypothesisIds.has(finding.hypothesisId))
    .map((finding) => {
      const assessment =
        finding.assessment === 'supports_prediction'
          ? '与部分预测一致'
          : finding.assessment === 'challenges_prediction'
            ? '提示反例或非特异性'
            : '信息不足'
      return {
        evidenceId: `e-${agentId}-${digest({ round: context.round, finding }).slice(0, 12)}`,
        hypothesisId: finding.hypothesisId,
        agentId,
        // 文献和模型解释不能替代确定性数据处理，因此始终保持 unknown。
        status: 'unknown' as const,
        evidenceRole: 'diagnostic_boundary' as const,
        contradictionScope: 'mechanism' as const,
        claim: `${assessment}：${finding.claim}`,
        observed: finding.observed,
        method: 'model-assisted-bounded-review',
        sourceIds: [
          ...new Set(finding.sourceIds.filter((sourceId) => allowedSources.has(sourceId))),
        ],
        sampleIds: [],
        predictionIds: [],
        falsificationConditionIds: [],
        quantitativeResults: [],
        limitations: [
          ...new Set([
            ...finding.limitations,
            '该记录是模型对已提供资料的有界解释；未绑定确定性处理溯源，不能升级为支持或反驳证据。',
          ]),
        ],
        round: context.round,
      }
    })
  return {
    evidence,
    notes: [review.summary],
    corrections: review.corrections.map((item) => ({
      stage: item.stage,
      kind: item.kind,
      severity: item.severity,
      message: item.message,
      action: item.action,
      affectedIds: item.affectedIds,
      evidenceAction: item.evidenceAction,
    })),
  }
}

async function runBoundedEvidenceReview(input: {
  services: DefaultScientificServicesInput
  context: Readonly<EvidenceAgentContext>
  schedule: ModelScheduler
  agentId: string
  role: 'looker' | 'explore' | 'oracle'
  prompt: string
  allowedSourceIds: string[]
}) {
  const modelConfig =
    input.services.agentConfigs?.[input.role]?.modelConfig ?? input.services.modelConfig
  const review = await input.schedule(() =>
    runScientificModelTask({
      projectId: input.services.projectId,
      runId: input.services.runId,
      agentId: input.agentId,
      role: input.role,
      modelConfig,
      schema: ModelEvidenceReviewSchema,
      prompt: `${input.prompt}

输出要求：
- 逐条核对候选 hypothesisId；不得新建假设。
- assessment 只描述资料与预测的关系。由于这里没有新的确定性处理溯源，finding 不会直接成为 support/contradict。
- sourceIds 只能从提示中列出的“允许来源 ID”选择；没有来源时使用空数组。
- summary 用中文给出本智能体真正采用的事实、判断与边界。
- summary 控制在 600 字以内；每个 finding 的 claim 控制在 120 字以内、observed 控制在 300 字以内，limitations 最多列 3 条。不要在 summary 中逐字重复 findings。
- 必须核对“前序智能体记录”；若其结论越过数据、来源或处理边界，在 corrections 中用受控 stage/kind 指出冲突、受影响 ID 和具体修正动作。
- correction 若需改变既有证据，affectedIds 必须填写精确 evidenceId，并选择 downgrade_to_unknown 或 revoke；仅文字建议必须选择 none。
- 不得输出隐藏思维链，只提交可核验的公开工作摘要。`,
      emitChunk: input.services.emitChunk,
      abortSignal: input.context.signal,
      maxOutputTokens: 3600,
      round: input.context.round,
    }),
  )
  return mapModelReview(input.agentId, input.context, review, input.allowedSourceIds)
}

/**
 * Render earlier-round self-correction findings for model reviewers. Without
 * this block a round-2 reviewer re-reports the round-1 finding verbatim
 * (observed in the 2026-09-01 runs: identical FITS-read-failure corrections
 * in both rounds) because the finding text never reached its context.
 */
function recentLessonsPromptBlock(lessons: readonly string[] | undefined): string {
  if (!lessons || lessons.length === 0) return ''
  return `历史轮次已发现问题（勿重复报告；如仍未解决请优先说明已登记的工单/降级是否足够，并提出新行动）：\n${lessons
    .map((lesson) => `- ${lesson}`)
    .join('\n')}\n`
}

function modelObservationQcAgent(
  input: DefaultScientificServicesInput,
  schedule: ModelScheduler,
): EvidenceAgent {
  return {
    id: 'looker-model-observation-review',
    label: `${agentLabel('looker')}：模型观测语境审阅`,
    executionKind: 'model',
    capabilities: ['source-audit', 'observation-analysis', 'fact-check'],
    // Later rounds are task-driven. Do not re-run a semantic review when the
    // only input is the same completed baseline evidence.
    canRun: (context) => context.round === 1 || hasRunnableLocalTask(context),
    run: async (context) => {
      const activeRegion = inferredActiveRegion(context.phenomenon)
      const query = `${context.phenomenon.title} ${context.phenomenon.description}`
      const [pack, matches] = await Promise.all([
        verifyCoronalDataPack(),
        searchCoronalObservationCases({ activeRegion, query, limit: 2 }),
      ])
      const selected = matches.cases[0]
      const coverage = await assessCoronalDataCoverage({
        activeRegion,
        query,
        caseId: selected?.caseId,
        requirements: [
          'thermal-evolution',
          'magnetic-context',
          'wave-timescale',
          'spectroscopy',
          'simulation',
        ],
      })
      const allowedSourceIds = selected ? [matches.sourceId] : []
      return runBoundedEvidenceReview({
        services: input,
        context,
        schedule,
        agentId: 'looker-model-observation-review',
        role: 'looker',
        allowedSourceIds,
        prompt: `请审阅现象、候选机制与本地观测覆盖，只判断当前数据是否具备检验相应预测的条件。

现象：${phenomenonPrompt(context.phenomenon)}
候选假设：${conciseText(JSON.stringify(hypothesisPromptRows(context.hypotheses)), 7000)}
观测目录事实：${conciseText(
          JSON.stringify({
            packStatus: pack.status,
            primaryPackReady: pack.primaryPackReady,
            verifiedAssets: pack.verifiedAssetCount,
            expectedAssets: pack.expectedAssetCount,
            matchedCases: matches.cases,
            satisfiedDiagnostics: coverage.satisfied,
            unavailableDiagnostics: coverage.unavailable,
            limitations: coverage.limitations,
          }),
          7000,
        )}
前序智能体记录（确定性计算优先）：${conciseText(JSON.stringify(priorEvidencePromptRows(context.evidence)), 9000)}
${recentLessonsPromptBlock(context.recentLessons)}允许来源 ID：${allowedSourceIds.join('、') || '无'}`,
      })
    },
  }
}

function modelExplorerAgent(
  input: DefaultScientificServicesInput,
  load: LocalProcessingLoader,
  schedule: ModelScheduler,
): EvidenceAgent {
  return {
    id: 'explorer-model-diagnostic-review',
    label: `${agentLabel('explore')}：模型诊断比较`,
    executionKind: 'model',
    capabilities: [
      'literature-retrieval',
      'timeseries-analysis',
      'image-analysis',
      'cross-validation',
    ],
    canRun: (context) => context.round === 1 || hasRunnableLocalTask(context),
    run: async (context) => {
      const query = `${context.phenomenon.title} ${context.phenomenon.description}`
      const [processing, papers] = await Promise.all([
        load(context),
        searchVerifiedCoronalLiterature(`coronal heating ${query}`, 6),
      ])
      const paperSourceIds = papers.map((paper) => `paper:${paper.id}`)
      const allowedSourceIds = [
        ...new Set([...paperSourceIds, ...(processing.length ? [LOCAL_CORONAL_SOURCE_ID] : [])]),
      ]
      return runBoundedEvidenceReview({
        services: input,
        context,
        schedule,
        agentId: 'explorer-model-diagnostic-review',
        role: 'explore',
        allowedSourceIds,
        prompt: `请比较候选机制的可观测预测与本轮真实处理指标及已核验文献。区分“指标一致”“诊断不特异”和“缺少关键测量”。

现象：${phenomenonPrompt(context.phenomenon)}
候选假设：${conciseText(JSON.stringify(hypothesisPromptRows(context.hypotheses)), 7000)}
确定性处理事实：${conciseText(
          JSON.stringify(
            processing.length ? compactProcessingPromptRows(processing) : { available: false },
          ),
          9000,
        )}
按原始事件聚合的确定性证据（必须逐事件比较，不得只复述 discovery）：${conciseText(
          JSON.stringify(compactEventEvidencePromptRows(context.evidence)),
          10000,
        )}
已核验文献：${conciseText(JSON.stringify(papers.map((paper) => ({ id: `paper:${paper.id}`, title: paper.title, abstract: paper.abstract }))), 8000)}
前序智能体记录（用于复核而非复制）：${conciseText(JSON.stringify(priorEvidencePromptRows(context.evidence)), 10000)}
${recentLessonsPromptBlock(context.recentLessons)}
允许来源 ID：${allowedSourceIds.join('、') || '无'}`,
      })
    },
  }
}

function modelOracleAgent(
  input: DefaultScientificServicesInput,
  load: LocalProcessingLoader,
  schedule: ModelScheduler,
): EvidenceAgent {
  return {
    id: 'oracle-model-counterexample-review',
    label: `${agentLabel('oracle')}：模型反例审阅`,
    executionKind: 'model',
    capabilities: ['counterexample-search', 'cross-validation', 'fact-check'],
    canRun: (context) => context.round === 1 || hasRunnableLocalTask(context),
    run: async (context) => {
      const processing = await load(context)
      const allowedSourceIds = processing.length ? [LOCAL_CORONAL_SOURCE_ID] : []
      // Reuse the librarian's verified literature retrieval to ground the
      // counterexample search in documented alternative explanations. Papers
      // are context only; they can never become observational support.
      const mechanismTerms = [
        ...new Set(
          context.hypotheses.flatMap((hypothesis) =>
            hypothesis.mechanismComposition.map((entry) => entry.mechanism),
          ),
        ),
      ]
        .slice(0, 4)
        .join(' ')
      let counterexamplePapers: Awaited<ReturnType<typeof searchVerifiedCoronalLiterature>> = []
      try {
        counterexamplePapers = await searchVerifiedCoronalLiterature(
          `coronal heating alternative explanation counterexample non-heating background limitation ${mechanismTerms}`,
          6,
        )
      } catch {
        counterexamplePapers = []
      }
      const counterexamplePaperIds = counterexamplePapers.map((paper) => `paper:${paper.id}`)
      allowedSourceIds.push(...counterexamplePaperIds)
      const literatureBlock =
        counterexamplePapers.length > 0
          ? `\n文献中的替代解释与反例线索（仅作上下文线索，不得当作本次观测证据；引用时使用其来源 ID）：${conciseText(
              JSON.stringify(
                counterexamplePapers.map((paper) => ({
                  id: `paper:${paper.id}`,
                  title: paper.title,
                })),
              ),
              3000,
            )}`
          : ''
      return runBoundedEvidenceReview({
        services: input,
        context,
        schedule,
        agentId: 'oracle-model-counterexample-review',
        role: 'oracle',
        allowedSourceIds,
        prompt: `请作为反例审阅者，寻找同一组处理指标是否也能被其他机制、背景活动或数据处理局限解释。只依据提供的指标，不得编造新样本。优先结合文献线索提出可检验的替代解释，并在记录中标注其来源 ID。${literatureBlock}

现象：${phenomenonPrompt(context.phenomenon)}
候选假设：${conciseText(JSON.stringify(hypothesisPromptRows(context.hypotheses)), 7000)}
确定性处理事实：${conciseText(
          JSON.stringify(
            processing.length ? compactProcessingPromptRows(processing) : { available: false },
          ),
          9000,
        )}
按原始事件聚合的确定性证据（必须检查每个 holdout 是否复现或削弱子指标）：${conciseText(
          JSON.stringify(compactEventEvidencePromptRows(context.evidence)),
          10000,
        )}
前序观测质控 / 物理诊断记录：${conciseText(JSON.stringify(priorEvidencePromptRows(context.evidence)), 12000)}
${recentLessonsPromptBlock(context.recentLessons)}
请显式检查前序记录之间是否矛盾、是否把相关性写成因果、是否把可执行建议误写成已完成结果；发现问题必须写入 corrections。
允许来源 ID：${allowedSourceIds.join('、') || '无'}`,
      })
    },
  }
}

type LocalMechanismKey = keyof LocalCoronalAnalysis['diagnostics']

function mechanismKey(hypothesis: ScientificHypothesis): LocalMechanismKey | null {
  const text = hypothesis.mechanismComposition.map((item) => item.mechanism).join(' ')
  const wave = /(波|alfv|湍流|mhd)/i.test(text)
  const reconnection = /(重联|纳耀斑|nanoflare|reconnect|脉冲加热|impulsive heating)/i.test(text)
  if (wave && reconnection) return 'coupled'
  if (reconnection) return 'reconnection'
  if (wave) return 'wave'
  return null
}

/**
 * Codename plus role name for workbench and trace labels, e.g.
 * "Oracle·反证审计智能体". Falls back to the raw key for unknown ids so
 * model-generated agent ids still render.
 */
function agentLabel(key: string): string {
  const identity = SCIENTIFIC_AGENTS.find((agent) => agent.key === key)
  return identity ? `${identity.codename}·${identity.displayName}` : key
}

function predictionIds(hypothesis: ScientificHypothesis): string[] {
  return hypothesis.predictions.map((_, index) => scientificPredictionId(hypothesis.id, index))
}

function localHoldoutPredictionIds(hypothesis: ScientificHypothesis): string[] {
  // The registered cohort design fixes spectroscopy + thermal response as the
  // holdout prediction. Bind that semantic family directly for a correctly
  // scoped process hypothesis, rather than requiring one exact LLM wording
  // such as "distribution" or "flow".
  if (isScopedImpulsiveThermalHypothesis(hypothesis)) {
    const spectroscopyPredictions = hypothesis.predictions.flatMap((statement, index) =>
      impulsivePredictionFamilies(statement).includes('spectroscopy')
        ? [scientificPredictionId(hypothesis.id, index)]
        : [],
    )
    if (spectroscopyPredictions.length > 0) return spectroscopyPredictions
  }
  const key = mechanismKey(hypothesis)
  const pattern =
    key === 'wave'
      ? /(?:171|193|跨通道|AIA|多波段).*(?:相关|周期|功率峰|波动时标)|(?:相关|准?周期|功率峰|波动时标).*(?:171|193|跨通道|AIA|多波段)/i
      : key === 'reconnection'
        ? /(?:94|131|热通道|高温通道|热增强|冷却|时延|DEM|温度|IRIS|Si\s*IV|Doppler|多普勒|光谱).*(?:间歇|峰|变异|增强|亮化|瞬态|短暂|序列|分量|红移|下流|流速)|(?:间歇|峰|变异|增强|亮化|瞬态|短暂|序列|分量|红移|下流|流速).*(?:94|131|热通道|高温通道|热增强|冷却|时延|DEM|温度|IRIS|Si\s*IV|Doppler|多普勒|光谱)/i
        : key === 'coupled'
          ? /(?:同时|联合|共同).*(?:波动|准周期|时序).*(?:热通道|热增强|爆发|磁场|重联)|(?:波动|准周期|时序).*(?:热通道|热增强|爆发|磁场|重联).*(?:同时|联合|共同)/i
          : null
  if (!pattern) return []
  return hypothesis.predictions.flatMap((statement, index) =>
    pattern.test(statement) ? [scientificPredictionId(hypothesis.id, index)] : [],
  )
}

function falsificationConditionIds(hypothesis: ScientificHypothesis): string[] {
  return hypothesis.falsificationConditions.map((_, index) =>
    scientificFalsificationConditionId(hypothesis.id, index),
  )
}

function localEvidenceLineage(
  processing: LocalProcessingResult,
  observableFamily:
    | 'wave_timing'
    | 'thermal_variability'
    | 'magnetic_evolution'
    | 'spectroscopy'
    | 'background_control'
    | 'other',
  methodFamily: string,
) {
  const baselineCaseId = processing.analysis.baseline?.caseId
  return {
    eventGroupId: processing.analysis.target.caseId,
    relatedEventGroupIds: baselineCaseId ? [baselineCaseId] : [],
    rawDataFingerprint: digest({
      manifestSha256: processing.analysis.manifestSha256,
      targetCaseId: processing.analysis.target.caseId,
      targetChecksums: processing.analysis.target.sampledChecksums,
      baselineCaseId: baselineCaseId ?? null,
      baselineChecksums: processing.analysis.baseline?.sampledChecksums ?? {},
      spectroscopyAssetId: processing.analysis.diagnostics.spectroscopy?.sourceAssetId ?? null,
      spectroscopyAssetSha256:
        processing.analysis.diagnostics.spectroscopy?.sourceAssetSha256 ?? null,
    }),
    observableFamily,
    methodFamily,
    analysisSplit: processing.analysis.mode,
  } as const
}

function taskMatchesProcessing(task: ValidationTask, processing: LocalProcessingResult): boolean {
  const executorId = localValidationExecutor(task)
  if (executorId === null) return false
  if (processing.selectionPurpose) {
    if (processing.selectionPurpose === 'cross_event') {
      return (
        executorId === 'coronal-cross-event-holdout-v1' ||
        (executorId === 'coronal-iris-spectroscopy-v1' &&
          processing.analysis.target.caseId === 'ar11899-joint-spectroscopy-20131119')
      )
    }
    return (
      executorId !== 'coronal-cross-event-holdout-v1' &&
      executorId !== 'coronal-iris-spectroscopy-v1'
    )
  }
  // Backward-compatible fallback for persisted/test results created before selectionPurpose existed.
  return processing.analysis.mode === 'holdout'
    ? executorId === 'coronal-cross-event-holdout-v1' ||
        (executorId === 'coronal-iris-spectroscopy-v1' &&
          processing.analysis.target.caseId === 'ar11899-joint-spectroscopy-20131119')
    : executorId !== 'coronal-cross-event-holdout-v1' &&
        executorId !== 'coronal-iris-spectroscopy-v1'
}

export function tasksForHypothesis(
  context: Readonly<EvidenceAgentContext>,
  hypothesis: ScientificHypothesis,
  processing: LocalProcessingResult,
): ValidationTask[] {
  return context.validationTasks.filter((task) => {
    if (!taskMatchesProcessing(task, processing)) return false
    if (
      processing.analysis.mode === 'holdout' &&
      // The registered positive-control spectroscopy task is bound to the
      // AR11899 holdout event itself (not to one hypothesis's holdout
      // prediction), so it must not be filtered by per-hypothesis holdout
      // prediction matching — otherwise it strands with zero evidence.
      task.executorId !== 'coronal-iris-spectroscopy-v1' &&
      !task.predictionIds.some((id) => localHoldoutPredictionIds(hypothesis).includes(id))
    )
      return false
    if (task.hypothesisIds.includes(hypothesis.id) || task.triggeredBy === hypothesis.id)
      return true
    return context.evidence.some(
      (evidence) =>
        evidence.evidenceId === task.triggeredBy && evidence.hypothesisId === hypothesis.id,
    )
  })
}

function diagnosticObserved(
  key: keyof LocalCoronalAnalysis['diagnostics'],
  diagnostic: ObservableDiagnostic,
): string {
  const numberOrUnavailable = (value: unknown): string =>
    typeof value === 'number' && Number.isFinite(value) ? String(value) : '不可计算'
  const booleanOrUnavailable = (value: unknown): string =>
    value === true ? '是' : value === false ? '否' : '不可计算'
  if (key === 'wave') {
    const periods = Array.isArray(diagnostic.periodsSeconds)
      ? diagnostic.periodsSeconds.map((value) => Number(value).toFixed(0)).join('、')
      : '未形成'
    const correlation =
      typeof diagnostic.crossChannelCorrelation === 'number'
        ? diagnostic.crossChannelCorrelation.toFixed(2)
        : '不可计算'
    return `171/193 Å 的候选主周期为 ${periods} 秒，跨通道相关系数 ${correlation}；这是积分强度时序指标，尚未测量传播速度和能流。`
  }
  if (key === 'reconnection') {
    const peaks = Number(diagnostic.hotChannelPeakCount ?? 0)
    const variability =
      typeof diagnostic.hotChannelRelativeVariability === 'number'
        ? diagnostic.hotChannelRelativeVariability.toFixed(3)
        : '不可计算'
    const ratio =
      typeof diagnostic.targetToBackgroundVariabilityRatio === 'number'
        ? diagnostic.targetToBackgroundVariabilityRatio.toFixed(2)
        : '无同区背景比值'
    return `94/131 Å 检出 ${peaks} 个稳健峰，热通道相对变异 ${variability}，目标/背景变异比 ${ratio}；磁场仅使用视向代理量。`
  }
  if (key === 'cooling_sequence') {
    return `预注册的 5 组热到冷通道时延中，可计算 ${Number(diagnostic.usablePairCount ?? 0)} 组，满足冻结判据 ${Number(diagnostic.passingPairCount ?? 0)} 组；已对正时延搜索采用循环移位零分布和 Holm 校正。`
  }
  if (key === 'dem_temperature') {
    const samples = Number(diagnostic.timeSampleCount ?? 0)
    const chiSquare =
      typeof diagnostic.medianReducedChiSquare === 'number'
        ? diagnostic.medianReducedChiSquare.toFixed(2)
        : '不可计算'
    return `六通道正则化 DEM 使用 ${samples} 个共同时间样本，中位约化 χ²=${chiSquare}；该结果约束 ROI 热结构，但不唯一识别加热机制。`
  }
  if (key === 'magnetic_evolution') {
    return diagnostic.physicalMagneticMetricsAvailable
      ? `HMI 已与 AIA 共空间并计算投影视向磁通、G/Mm 梯度和 PIL 长度；无符号磁通中位数为 ${numberOrUnavailable(diagnostic.unsignedLosFluxMedianMx)} Mx，仍不等于矢量自由能或重联率。`
      : '当前 HMI 图像扩展缺少 WCS/物理单位，只完成像素空间磁场变化、梯度与 PIL 邻域代理审计，未形成物理磁通证据。'
  }
  if (key === 'spatial_wave') {
    return `171/193 Å 空间诊断可用波段 ${Number(diagnostic.usableBandCount ?? 0)} 个，周期一致=${booleanOrUnavailable(diagnostic.periodAgreement)}，节点/反节点相容波段 ${Number(diagnostic.standingWaveCompatibleBandCount ?? 0)} 个，表观传播相容波段 ${Number(diagnostic.propagationCompatibleBandCount ?? 0)} 个；自动 ROI 结果不等于沿单环能流测量。`
  }
  if (key === 'event_fluence_distribution') {
    const fit = diagnostic.powerLawProxyFit as Record<string, unknown> | undefined
    return `94/131 Å 合并热事件 ${Number(diagnostic.eventCount ?? 0)} 个、背景事件 ${Number(diagnostic.backgroundEventCount ?? 0)} 个；相对 fluence 尾部分布指数为 ${numberOrUnavailable(fit?.powerLawExponent)}，该量不是物理能量。`
  }
  if (key === 'vector_magnetic_evolution') {
    return `HMI SHARP CEA 矢量记录 ${Number(diagnostic.recordCount ?? 0)} 条，径向磁通演化=${booleanOrUnavailable(diagnostic.resolvedRadialFluxEvolution)}，无符号垂直电流演化=${booleanOrUnavailable(diagnostic.resolvedUnsignedCurrentEvolution)}；未做 NLFFF 外推。`
  }
  if (key === 'magnetic_thermal_association') {
    return `热事件 ${Number(diagnostic.eventCount ?? 0)} 个与 SHARP 记录 ${Number(diagnostic.vectorRecordCount ?? 0)} 条的磁—热循环移位检验 p=${numberOrUnavailable(diagnostic.circularShiftPValue)}，中位磁变化相对热峰时延 ${numberOrUnavailable(diagnostic.medianMagneticDerivativeMinusHotPeakLagSeconds)} 秒；相关不等于重联因果。`
  }
  if (key === 'spectroscopy') {
    return `IRIS Level-2 可读 raster ${Number(diagnostic.rasterCount ?? 0)} 个，文献预定义足点 ROI 内 Si IV 1393.755 Å 的 O I 校准相对 Doppler 速度中位数 ${numberOrUnavailable(diagnostic.medianLiteratureFootpointVelocityKmPerSecond)} km/s；该流动特征必须与独立日冕热诊断联合解释。`
  }
  return diagnostic.jointIndicatorsPresent
    ? '波动时序指标和热通道/磁场代理指标在同一处理窗口内同时出现，但尚未建立因果先后和能量分配。'
    : '当前处理没有同时满足波动与间歇热响应的预设可观测条件。'
}

function diagnosticQuantitativeResults(
  diagnostic: ObservableDiagnostic,
  executorId?: string | null,
): QuantitativeResult[] {
  const parsed = Array.isArray(diagnostic.quantitativeResults)
    ? diagnostic.quantitativeResults.flatMap((candidate) => {
        const result = QuantitativeResultSchema.safeParse(candidate)
        return result.success ? [result.data] : []
      })
    : []
  if (!executorId) return parsed
  // Metric attribution comes from the executor contract (P1-7): the holdout
  // contract keeps every parsed result, an empty prefix filters all rows out
  // (measurement-quality executors), and a prefix filters by metric family.
  const { metricPrefix } = executorContractByExecutorId(executorId) ?? {}
  if (metricPrefix === undefined) return []
  if (metricPrefix === null) return parsed
  return metricPrefix ? parsed.filter((result) => result.metric.startsWith(metricPrefix)) : []
}

type ImpulsivePredictionFamily = 'events' | 'cooling' | 'dem' | 'spectroscopy'

function impulsivePredictionFamilies(statement: string): ImpulsivePredictionFamily[] {
  const families: ImpulsivePredictionFamily[] = []
  if (
    /(?:94|131|热通道|间歇|热事件|fluence|幂律|发生率|event\s+(?:fluence|rate|tail|distribution))/i.test(
      statement,
    )
  )
    families.push('events')
  if (/(?:冷却|时延|335|211|193|171|cool)/i.test(statement)) families.push('cooling')
  if (/(?:DEM|温度|发射量|多温|temperature)/i.test(statement)) families.push('dem')
  if (/(?:IRIS|Si\s*IV|Doppler|多普勒|光谱|红移|下流|流速)/i.test(statement))
    families.push('spectroscopy')
  return families
}

function isScopedImpulsiveThermalHypothesis(hypothesis: ScientificHypothesis): boolean {
  const mechanism = hypothesis.mechanismComposition.map((item) => item.mechanism).join(' ')
  const coreClaim = [hypothesis.statement, mechanism].join(' ')
  const scopedImpulsive =
    /(?:低频|间歇|脉冲|impulsive)/i.test(mechanism) && /(?:加热|heating)/i.test(mechanism)
  const specificMechanism = /(?:磁重联|重联|纳耀斑|nanoflare|reconnect)/i
  const explicitlyNonUnique = /(?:非唯一|不唯一|仅相容|只相容|不能区分|机制未定|未限定)/i
  const cohortScoped = /(?:所选.{0,8}样本|跨事件|队列|多活动区|sample|cohort|cross-event)/i.test(
    `${hypothesis.statement} ${hypothesis.scope}`,
  )
  const overSpecificCoreClaim = specificMechanism.test(coreClaim)
  const overSpecificPrediction = hypothesis.predictions.some(
    (prediction) => specificMechanism.test(prediction) && !explicitlyNonUnique.test(prediction),
  )
  return (
    scopedImpulsive &&
    cohortScoped &&
    !overSpecificCoreClaim &&
    !overSpecificPrediction &&
    hypothesis.predictions.length > 0 &&
    hypothesis.predictions.every((statement) => impulsivePredictionFamilies(statement).length > 0)
  )
}

/** Keep the human-readable claim population consistent with its audited scope. */
export function normalizeScopedImpulsiveStatement(
  hypothesis: ScientificHypothesis,
): ScientificHypothesis {
  if (!isScopedImpulsiveThermalHypothesis(hypothesis)) return hypothesis
  const statementCohort = /(?:所选.{0,8}样本|跨事件|队列|多活动区|sample|cohort|cross-event)/i.test(
    hypothesis.statement,
  )
  // A cohort statement whose scope contradicts it ("仅适用于 AR11158 发现集")
  // is a model wording error: the statement already claims the cross-event
  // cohort, so the scope is normalized to match. Without this, the planner
  // never schedules validation/holdout processing and the cohort evidence
  // chain starves.
  const scopeContradicts = /(?:仅适用|不扩展到跨事件|仅限.{0,6}单|单事件)/i.test(
    hypothesis.scope ?? '',
  )
  if (statementCohort && !scopeContradicts) return hypothesis
  const withoutSingleRegionPrefix = hypothesis.statement.replace(/^(?:NOAA\s*)?AR\s*\d+\s*/i, '')
  const normalizedStatement = statementCohort
    ? hypothesis.statement
    : `所选跨事件样本中${withoutSingleRegionPrefix}`
  const normalizedScope = `所选跨事件样本（验证集 + 留出集），不适用于单事件范围；验证与留出事件由 prometheus.plan 的跨事件任务确定`
  return {
    ...hypothesis,
    statement: normalizedStatement,
    scope: normalizedScope,
  }
}

function eventPredictionMatchesDiagnostic(
  statement: string,
  diagnostic: ObservableDiagnostic | undefined,
): boolean {
  if (
    diagnostic?.observableStatus !== 'support' ||
    diagnosticQuantitativeResults(diagnostic).length === 0
  )
    return false
  const mentionsDistribution = /(?:fluence|幂律|指数|分布|发生率)/i.test(statement)
  if (!mentionsDistribution) return true
  const exponent = diagnosticQuantitativeResults(diagnostic).find(
    (result) => result.metric === 'aia_hot_event_relative_fluence_power_law_exponent',
  )
  if (!exponent) return false

  const lessThan = statement.match(
    /指数[^0-9<≤]{0,12}(?:小于|低于|不超过|<|≤)\s*([0-9]+(?:\.[0-9]+)?)/i,
  )
  if (lessThan) return exponent.upperBound < Number(lessThan[1])
  const greaterThan = statement.match(
    /指数[^0-9>≥]{0,12}(?:大于|高于|不少于|>|≥)\s*([0-9]+(?:\.[0-9]+)?)/i,
  )
  if (greaterThan) return exponent.lowerBound > Number(greaterThan[1])
  const range = statement.match(
    /指数[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)\s*(?:-|–|—|至|到)\s*([0-9]+(?:\.[0-9]+)?)/i,
  )
  if (range) {
    const lower = Number(range[1])
    const upper = Number(range[2])
    return (
      exponent.lowerBound >= Math.min(lower, upper) && exponent.upperBound <= Math.max(lower, upper)
    )
  }
  return true
}

function predictionSupportedFamilies(
  statement: string,
  diagnostics: LocalCoronalAnalysis['diagnostics'],
): ImpulsivePredictionFamily[] {
  const families = impulsivePredictionFamilies(statement)
  const supported = families.filter((family) => {
    if (family === 'events') {
      return /(?:fluence|幂律|指数|分布|发生率)/i.test(statement)
        ? eventPredictionMatchesDiagnostic(statement, diagnostics.event_fluence_distribution)
        : eventPredictionMatchesDiagnostic(statement, diagnostics.event_fluence_distribution) ||
            eventPredictionMatchesDiagnostic(statement, diagnostics.reconnection)
    }
    const diagnostic =
      family === 'cooling'
        ? diagnostics.cooling_sequence
        : family === 'dem'
          ? diagnostics.dem_temperature
          : diagnostics.spectroscopy
    return (
      diagnostic?.observableStatus === 'support' &&
      diagnosticQuantitativeResults(diagnostic).length > 0
    )
  })
  return supported.length === families.length ? supported : []
}

export function cohortMechanismEvidence(
  context: Readonly<EvidenceAgentContext>,
  processingResults: readonly LocalProcessingResult[],
): EvidenceRecord[] {
  return context.hypotheses.flatMap((hypothesis) => {
    if (!isScopedImpulsiveThermalHypothesis(hypothesis)) return []
    const predictions = hypothesis.predictions.map((statement, index) => ({
      id: scientificPredictionId(hypothesis.id, index),
      families: impulsivePredictionFamilies(statement),
    }))
    const candidates = processingResults.flatMap((processing) => {
      if (
        processing.analysis.target.role === 'background_control' ||
        processing.analysis.mode === 'discovery'
      )
        return []
      const diagnostics = processing.analysis.diagnostics
      const supported = new Set<ImpulsivePredictionFamily>()
      const supportsWithQuantitativeResult = (diagnostic?: ObservableDiagnostic) =>
        diagnostic?.observableStatus === 'support' &&
        diagnosticQuantitativeResults(diagnostic).length > 0
      if (
        supportsWithQuantitativeResult(diagnostics.reconnection) ||
        supportsWithQuantitativeResult(diagnostics.event_fluence_distribution)
      )
        supported.add('events')
      if (supportsWithQuantitativeResult(diagnostics.cooling_sequence)) supported.add('cooling')
      if (supportsWithQuantitativeResult(diagnostics.dem_temperature)) supported.add('dem')
      if (supportsWithQuantitativeResult(diagnostics.spectroscopy)) supported.add('spectroscopy')
      const hasImpulsiveSignature = supported.has('events') || supported.has('spectroscopy')
      if (!hasImpulsiveSignature || supported.size < 2) return []

      const supportedPredictions = predictions.map((prediction, index) => ({
        ...prediction,
        supportedFamilies: predictionSupportedFamilies(hypothesis.predictions[index]!, diagnostics),
      }))
      const coveredPredictionIds = supportedPredictions
        .filter((prediction) => prediction.supportedFamilies.length > 0)
        .map((prediction) => prediction.id)
      if (coveredPredictionIds.length === 0) return []
      const predictionMatchedFamilies = new Set(
        supportedPredictions.flatMap((prediction) => prediction.supportedFamilies),
      )
      const hasMatchedImpulsiveSignature =
        predictionMatchedFamilies.has('events') || predictionMatchedFamilies.has('spectroscopy')
      if (!hasMatchedImpulsiveSignature) return []
      const matchedSupported = new Set(
        [...supported].filter(
          (family) =>
            predictionMatchedFamilies.has(family) || family === 'cooling' || family === 'dem',
        ),
      )
      if (matchedSupported.size < 2) return []
      const diagnosticRows = [
        ...(matchedSupported.has('events')
          ? [diagnostics.reconnection, diagnostics.event_fluence_distribution]
          : []),
        ...(matchedSupported.has('cooling') ? [diagnostics.cooling_sequence] : []),
        ...(matchedSupported.has('dem') ? [diagnostics.dem_temperature] : []),
        ...(matchedSupported.has('spectroscopy') ? [diagnostics.spectroscopy] : []),
      ].filter(
        (diagnostic): diagnostic is ObservableDiagnostic =>
          diagnostic?.observableStatus === 'support',
      )
      const quantitativeResults = diagnosticRows
        .flatMap((diagnostic) => diagnosticQuantitativeResults(diagnostic))
        .filter(
          (result, index, rows) =>
            rows.findIndex((candidate) => candidate.metric === result.metric) === index,
        )
      if (quantitativeResults.length === 0) return []

      const methodFamily = matchedSupported.has('spectroscopy')
        ? 'iris-doppler-plus-coronal-thermal-response'
        : matchedSupported.has('cooling')
          ? 'hot-event-tail-plus-ordered-cooling'
          : 'hot-event-tail-plus-regularized-dem'
      const observableFamily = matchedSupported.has('spectroscopy')
        ? ('spectroscopy' as const)
        : matchedSupported.has('cooling')
          ? ('wave_timing' as const)
          : ('thermal_variability' as const)
      return [
        {
          processing,
          supported: matchedSupported,
          methodFamily,
          observableFamily,
          coveredPredictionIds,
          quantitativeResults,
        },
      ]
    })
    const eventIds = new Set(
      candidates.map((candidate) => candidate.processing.analysis.target.caseId),
    )
    const methodFamilies = new Set(candidates.map((candidate) => candidate.methodFamily))
    const observableFamilies = new Set(candidates.map((candidate) => candidate.observableFamily))
    const coveredPredictionIds = new Set(
      candidates.flatMap((candidate) => candidate.coveredPredictionIds),
    )
    const cohortReady =
      eventIds.size >= 3 &&
      methodFamilies.size >= 2 &&
      observableFamilies.size >= 2 &&
      candidates.some((candidate) => candidate.processing.analysis.mode === 'holdout') &&
      predictions.every((prediction) => coveredPredictionIds.has(prediction.id))
    if (!cohortReady) return []

    return candidates.map((candidate) => {
      const processing = candidate.processing
      const usesSpectroscopy = candidate.supported.has('spectroscopy')
      const spectroscopySampleId =
        typeof processing.analysis.diagnostics.spectroscopy?.sourceAssetId === 'string'
          ? processing.analysis.diagnostics.spectroscopy.sourceAssetId
          : null
      return EvidenceRecordSchema.parse({
        evidenceId: `e-impulsive-cohort-${digest({
          hypothesisId: hypothesis.id,
          processingRunId: processing.processingRunId,
          methodFamily: candidate.methodFamily,
        }).slice(0, 16)}`,
        hypothesisId: hypothesis.id,
        agentId: 'explorer-coronal-diagnostics',
        status: 'support',
        evidenceRole: 'mechanism_discriminating',
        contradictionScope: 'diagnostic_specificity',
        claim:
          `在预注册的跨事件框架中，${processing.analysis.target.label} 同时满足脉冲/流动特征与独立热响应，` +
          '因此支持“所选样本属于低频脉冲热过程而非严格近稳态热过程”这一受限机制层级；不据此认定具体磁重联或纳耀斑。',
        observed: `通过的诊断族：${[...candidate.supported].join('、')}；方法族：${candidate.methodFamily}。`,
        method: candidate.methodFamily,
        sourceIds: [LOCAL_CORONAL_SOURCE_ID],
        sampleIds: [
          ...processing.analysis.target.sampleIds,
          ...(usesSpectroscopy && spectroscopySampleId ? [spectroscopySampleId] : []),
        ],
        predictionIds: candidate.coveredPredictionIds,
        falsificationConditionIds: falsificationConditionIds(hypothesis),
        provenance: processing.provenance,
        lineage: localEvidenceLineage(
          processing,
          candidate.observableFamily,
          candidate.methodFamily,
        ),
        metrics: {
          cohortRule: {
            minIndependentEvents: 3,
            minMethodFamilies: 2,
            minObservableFamilies: 2,
            requireHoldout: true,
            requireAllPredictions: true,
          },
          passedDiagnosticFamilies: [...candidate.supported],
          eventCount: eventIds.size,
          methodFamilyCount: methodFamilies.size,
          observableFamilyCount: observableFamilies.size,
        },
        quantitativeResults: candidate.quantitativeResults,
        uncertainty:
          '区间来自各诊断的预注册重采样或统计模型；不同事件仍存在活动区选择和自动 ROI 的系统差异。',
        limitations: [
          '结论只区分低频脉冲热过程与严格近稳态热过程，不区分磁重联、纳耀斑、波致耗散或其耦合。',
          ...processing.analysis.limitations,
        ],
        round: context.round,
      })
    })
  })
}

function localDiagnosticsAgent(
  input: DefaultScientificServicesInput,
  load: LocalProcessingLoader,
): EvidenceAgent {
  return {
    id: 'explorer-coronal-diagnostics',
    label: `${agentLabel('explore')}：FITS 可观测量分析`,
    executionKind: 'deterministic',
    capabilities: ['observation-analysis', 'timeseries-analysis', 'image-analysis'],
    canRun: (context) => context.round === 1 || hasRunnableLocalTask(context),
    run: async (context) => {
      const processingResults = await load(context)
      if (processingResults.length === 0) {
        return {
          limitations: ['没有匹配到可执行的本地活动区窗口，未创建处理运行。'],
        }
      }
      const evidence: EvidenceRecord[] = []
      for (const processing of processingResults) {
        evidence.push(
          EvidenceRecordSchema.parse({
            evidenceId: `e-wcs-audit-${digest({ processingRunId: processing.processingRunId }).slice(0, 16)}`,
            hypothesisId: null,
            agentId: 'explorer-coronal-diagnostics',
            status: 'unknown',
            evidenceRole: 'diagnostic_boundary',
            contradictionScope: 'data_quality',
            claim:
              '已完成 AIA WCS 配准与统一 ROI 质量审计；该步骤只保证测量坐标的一致性，不支持任何加热机制。',
            observed: `AIA 配准就绪=${String(processing.analysis.target.alignment.aiaWcsRegistrationReady)}，配准帧 ${processing.analysis.target.alignment.aiaRegistered}，回退帧 ${processing.analysis.target.alignment.aiaFallback}；HMI 配准就绪=${String(processing.analysis.target.alignment.hmiWcsRegistrationReady)}。`,
            method: 'astropy-linear-wcs-reprojection-to-frozen-aia-193-roi',
            sourceIds: [LOCAL_CORONAL_SOURCE_ID],
            sampleIds: processing.analysis.target.sampleIds,
            predictionIds: [],
            falsificationConditionIds: [],
            provenance: processing.provenance,
            lineage: localEvidenceLineage(
              processing,
              'other',
              'aia-wcs-registration-quality-audit',
            ),
            metrics: processing.analysis.target.alignment,
            quantitativeResults: [],
            limitations: processing.analysis.target.alignment.hmiWcsRegistrationReady
              ? ['AIA/HMI 已共空间到冻结 ROI；WCS 配准仍未处理 PSF、差分旋转与亚像素残差。']
              : [
                  'AIA 已统一 ROI，但 HMI record 元数据旁车未通过校验，不能进行 AIA-HMI 物理共空间分析。',
                ],
            round: context.round,
          }),
        )
        for (const hypothesis of context.hypotheses) {
          const matchingTasks = tasksForHypothesis(context, hypothesis, processing)
          const taskRows: Array<ValidationTask | undefined> =
            context.round === 1 && matchingTasks.length === 0 ? [undefined] : matchingTasks
          for (const task of taskRows) {
            const executorId = task ? localValidationExecutor(task) : null
            // Mechanism classification and the quality-precondition flag come
            // from the executor contract (P1-7) instead of an inline switch.
            const contract = executorContractByExecutorId(executorId)
            const key: LocalMechanismKey | null =
              contract && contract.mechanismKey !== null
                ? contract.mechanismKey
                : mechanismKey(hypothesis)
            const wcsAudit = contract?.qualityPreconditionOnly === true
            if (!key && !wcsAudit) {
              evidence.push(
                EvidenceRecordSchema.parse({
                  evidenceId: `e-diagnostic-unclassified-${digest({
                    hypothesisId: hypothesis.id,
                    taskId: task?.taskId ?? null,
                    processingRunId: processing.processingRunId,
                  }).slice(0, 16)}`,
                  hypothesisId: hypothesis.id,
                  ...(task ? { taskId: task.taskId } : {}),
                  agentId: 'explorer-coronal-diagnostics',
                  status: 'unknown',
                  evidenceRole: 'diagnostic_boundary',
                  claim: `假设“${hypothesis.statement}”没有映射到已实现的确定性诊断。`,
                  observed: '本轮未将未分类机制强制解释为已实现机制，FITS 指标只作为数据边界记录。',
                  method: 'mechanism-classification-boundary',
                  sourceIds: [LOCAL_CORONAL_SOURCE_ID],
                  sampleIds: processing.analysis.target.sampleIds,
                  predictionIds: [],
                  falsificationConditionIds: [],
                  provenance: processing.provenance,
                  lineage: localEvidenceLineage(
                    processing,
                    'other',
                    'mechanism-classification-boundary',
                  ),
                  quantitativeResults: [],
                  limitations: [
                    '需要先明确机制与可观测预测的映射，再选择确定性诊断执行器。',
                    ...processing.analysis.limitations,
                  ],
                  round: context.round,
                }),
              )
              continue
            }
            const diagnostic: ObservableDiagnostic = wcsAudit
              ? {
                  observableStatus: processing.analysis.target.alignment.aiaWcsRegistrationReady
                    ? 'support'
                    : 'unknown',
                  alignment: processing.analysis.target.alignment,
                  quantitativeResults: [],
                  boundary: 'WCS 配准成功是分析质量条件，不是任何加热机制的支持证据。',
                }
              : (processing.analysis.diagnostics[key!] ?? {
                  observableStatus: 'unknown',
                  boundary: `处理产物尚未包含 ${String(key)} 诊断。`,
                })
            const status =
              executorId === 'coronal-background-variability-v1' ||
              executorId === 'coronal-wcs-unified-roi-v2'
                ? ('unknown' as const)
                : diagnostic.observableStatus
            const observed = wcsAudit
              ? `AIA WCS 配准就绪=${String(processing.analysis.target.alignment.aiaWcsRegistrationReady)}，配准帧 ${processing.analysis.target.alignment.aiaRegistered}，回退帧 ${processing.analysis.target.alignment.aiaFallback}；统一 ROI 参考通道为 193 Å。`
              : diagnosticObserved(key!, diagnostic)
            evidence.push(
              EvidenceRecordSchema.parse({
                evidenceId: `e-diagnostic-${digest({
                  hypothesisId: hypothesis.id,
                  taskId: task?.taskId ?? null,
                  processingRunId: processing.processingRunId,
                  executorId,
                }).slice(0, 16)}`,
                hypothesisId: hypothesis.id,
                ...(task ? { taskId: task.taskId } : {}),
                agentId: 'explorer-coronal-diagnostics',
                status,
                evidenceRole:
                  status === 'support' ? 'prediction_consistent' : 'diagnostic_boundary',
                claim:
                  status === 'support'
                    ? `确定性 FITS 处理与“${hypothesis.statement}”的一项非唯一可观测预测相符；该记录不具有机制区分力。`
                    : task
                      ? `确定性 FITS 处理已完成任务“${task.objective}”，但结果尚不足以支持或反驳机制。`
                      : `确定性 FITS 处理尚未形成足以支持或反驳“${hypothesis.statement}”的可重复指标。`,
                observed,
                method: 'astropy-wcs + robust-roi-timeseries + preregistered-scipy-diagnostics',
                sourceIds: [LOCAL_CORONAL_SOURCE_ID],
                sampleIds: processing.analysis.target.sampleIds,
                predictionIds: task?.predictionIds.length
                  ? filterPredictionIdsByCapability(executorId, hypothesis, task.predictionIds)
                  : predictionIds(hypothesis)
                      .filter((id) =>
                        executorSupportsPrediction(
                          executorId,
                          predictionStatementForId(hypothesis, id) ?? '',
                        ),
                      )
                      .slice(0, 1),
                falsificationConditionIds:
                  task?.falsificationConditionIds.filter((id) =>
                    falsificationConditionIds(hypothesis).includes(id),
                  ) ?? [],
                provenance: processing.provenance,
                lineage: localEvidenceLineage(
                  processing,
                  key === 'wave' || key === 'cooling_sequence'
                    ? 'wave_timing'
                    : key === 'spatial_wave'
                      ? 'wave_timing'
                      : key === 'reconnection' || key === 'dem_temperature'
                        ? 'thermal_variability'
                        : key === 'event_fluence_distribution'
                          ? 'thermal_variability'
                          : key === 'magnetic_evolution'
                            ? 'magnetic_evolution'
                            : key === 'vector_magnetic_evolution'
                              ? 'magnetic_evolution'
                              : key === 'magnetic_thermal_association'
                                ? 'magnetic_evolution'
                                : key === 'spectroscopy'
                                  ? 'other'
                                  : 'other',
                  key === 'cooling_sequence'
                    ? 'preregistered-positive-lag-cooling-sequence'
                    : key === 'spatial_wave'
                      ? 'automatic-roi-fourier-phase-time-distance'
                      : key === 'dem_temperature'
                        ? 'regularized-six-channel-aia-dem'
                        : key === 'event_fluence_distribution'
                          ? 'robust-hot-event-relative-fluence-tail-fit'
                          : key === 'magnetic_evolution'
                            ? 'jsoc-metadata-aia-coregistered-projected-los-magnetometry'
                            : key === 'vector_magnetic_evolution'
                              ? 'hmi-sharp-cea-vector-current-proxies'
                              : key === 'magnetic_thermal_association'
                                ? 'hmi-sharp-hot-event-circular-shift-association'
                                : key === 'spectroscopy'
                                  ? 'iris-level2-oi-calibrated-relative-si-iv-doppler'
                                  : wcsAudit
                                    ? 'aia-linear-wcs-unified-roi-audit'
                                    : key === 'wave'
                                      ? 'periodogram-cross-channel-timing'
                                      : key === 'reconnection'
                                        ? 'robust-hot-channel-peak-analysis'
                                        : 'joint-proxy-analysis',
                ),
                metrics: diagnostic,
                quantitativeResults: diagnosticQuantitativeResults(diagnostic, executorId),
                uncertainty:
                  '自动 ROI、降采样 WCS 重投影、有限 cadence 与非唯一代理指标构成主要不确定度。',
                limitations: [diagnostic.boundary, ...processing.analysis.limitations],
                round: context.round,
              }),
            )
          }
        }
      }
      evidence.push(...cohortMechanismEvidence(context, processingResults))
      const completedTasks = context.validationTasks.flatMap((task) => {
        const related = evidence.filter((item) => item.taskId === task.taskId)
        if (related.length === 0) return []
        return {
          ...task,
          status: 'completed' as const,
          resultEvidenceIds: related.map((item) => item.evidenceId),
          detectability: task.detectability
            ? evaluateDetectability(task.detectability, related)
            : undefined,
        }
      })
      for (const processing of processingResults) {
        input.emitChunk?.({
          type: 'custom',
          kind: 'scientific.processing-result',
          stage: 'explorer',
          round: context.round,
          processingRunId: processing.processingRunId,
          snapshotId: processing.snapshotId,
          caseId: processing.analysis.target.caseId,
          caseLabel: processing.analysis.target.label,
          mode: processing.analysis.mode,
          usedObservationCount: processing.analysis.target.usedObservationCount,
          preprocessing: processing.analysis.preprocessing,
          analysisDesign: processing.analysis.analysisDesign,
          baselineCaseLabel: processing.analysis.baseline?.label ?? null,
          diagnostics: processing.analysis.diagnostics,
          metricsArtifactId: processing.metricsArtifactId,
          figureArtifactId: processing.figureArtifactId,
          figureUrl: `/api/projects/${encodeURIComponent(input.projectId)}/artifacts/${processing.figureArtifactId}/content`,
          limitations: processing.analysis.limitations,
        } as never)
      }
      const allLimitations = [
        ...new Set(processingResults.flatMap((item) => item.analysis.limitations)),
      ]
      const totalReadFailures = processingResults.reduce(
        (sum, item) => sum + item.analysis.target.readFailures.length,
        0,
      )
      // Traceability: bind the data-quality correction to the concrete
      // evidence rows derived from affected processing runs, so downstream
      // audits can re-check those rows instead of treating the finding as
      // unaddressable context. Failed files are excluded before metrics, so
      // the records stay valid (evidenceAction stays 'none').
      const readFailureRunIds = new Set(
        processingResults
          .filter((item) => item.analysis.target.readFailures.length > 0)
          .map((item) => item.processingRunId),
      )
      const readFailureEvidenceIds = evidence
        .filter((item) => item.provenance && readFailureRunIds.has(item.provenance.processingRunId))
        .map((item) => item.evidenceId)
      // Correction→action bridge: the data-quality finding above must not stay
      // a note. Register the concrete follow-up (re-fetch + re-verify) as a
      // planned task so prometheus.plan tracks it like any other registered work item.
      const refetchFingerprint = digest({
        kind: 'fits-read-failure-refetch',
        runIds: [...readFailureRunIds].sort(),
      })
      const refetchTask =
        totalReadFailures > 0
          ? [
              {
                taskId: `task-refetch-${refetchFingerprint.slice(0, 12)}`,
                route: 'explorer' as const,
                type: 'analysis' as const,
                objective:
                  '复核处理产物中的 readFailures 记录，重新获取未通过读取或抽样 SHA-256 校验的 FITS 文件，并重跑受影响窗口的指标。',
                hypothesisIds: [],
                predictionIds: [],
                falsificationConditionIds: [],
                requiredSourceIds: [LOCAL_CORONAL_SOURCE_ID],
                requiredData: [
                  `重新获取异常文件（涉及 ${readFailureRunIds.size} 个处理运行、${totalReadFailures} 个文件级异常）`,
                ],
                requiredFacilities: ['JSOC 导出队列与本地校验管线'],
                readiness: 'requires_data' as const,
                expectedDuration: '导出与校验完成后数小时',
                successCriteria: ['受影响处理运行的全部文件通过读取与抽样 SHA-256 校验'],
                failureCriteria: ['重取后仍失败的文件登记为不可用样本并从指标样本中排除'],
                discriminatingOutcomes: ['校验全部通过', '仍存在不可用文件'],
                triggeredBy: `round-${context.round}-fits-read-failure`,
                detectability: preregisteredLocalDetectability(),
                status: 'planned' as const,
                resultEvidenceIds: [],
                round: context.round,
                fingerprint: refetchFingerprint,
              },
            ]
          : []
      return {
        evidence,
        validationTasks: [...completedTasks, ...refetchTask],
        verifiedSourceIds: [LOCAL_CORONAL_SOURCE_ID],
        limitations: allLimitations,
        corrections:
          totalReadFailures > 0
            ? [
                {
                  stage: 'B-data-quality',
                  severity: 'warning',
                  message: `有 ${totalReadFailures} 个抽样 FITS 读取或校验异常。`,
                  action:
                    '异常文件未进入指标计算；已登记重取任务，复核处理产物中的 readFailures 后再扩大样本。',
                  affectedIds: readFailureEvidenceIds,
                },
              ]
            : [],
      }
    },
  }
}

export function localCounterexampleAgent(load: LocalProcessingLoader): EvidenceAgent {
  return {
    id: 'oracle-local-counterexample',
    label: `${agentLabel('oracle')}：同活动区背景对照`,
    executionKind: 'deterministic',
    capabilities: ['counterexample-search', 'cross-validation', 'fact-check'],
    canRun: (context) =>
      context.round === 1 ||
      context.validationTasks.some(
        (task) => localValidationExecutor(task) === 'coronal-background-variability-v1',
      ),
    run: async (context) => {
      const processing = (await load(context)).find((item) => Boolean(item.analysis.baseline))
      if (!processing?.analysis.baseline) {
        return {
          notes: ['当前活动区没有独立背景窗口，未把其他活动区误作反例。'],
          limitations: ['缺少同活动区背景对照。'],
        }
      }
      const baseline = processing.analysis.baseline
      const ratio = processing.analysis.diagnostics.reconnection.targetToBackgroundVariabilityRatio
      const hasComparableBackground = typeof ratio === 'number' && ratio <= 1.2
      const targetHypotheses =
        context.round === 1
          ? context.hypotheses
          : context.hypotheses.filter((hypothesis) =>
              context.validationTasks.some(
                (task) =>
                  task.hypothesisIds.includes(hypothesis.id) &&
                  localValidationExecutor(task) === 'coronal-background-variability-v1',
              ),
            )
      const evidence: EvidenceRecord[] = targetHypotheses.map((hypothesis) => {
        const key = mechanismKey(hypothesis)
        const contradictsSpecificity = key !== null && key !== 'wave' && hasComparableBackground
        const task = context.validationTasks.find(
          (item) =>
            item.hypothesisIds.includes(hypothesis.id) &&
            localValidationExecutor(item) === 'coronal-background-variability-v1',
        )
        const ratioResults = diagnosticQuantitativeResults(
          processing.analysis.diagnostics.reconnection,
          'coronal-background-variability-v1',
        )
        // A specificity failure bound to a pre-registered fatal condition is a
        // critical-prediction contradiction (gate-eligible); an unbound one is
        // only a diagnostic-specificity note the elimination gate must ignore.
        const boundFalsificationIds = contradictsSpecificity
          ? task?.falsificationConditionIds.length
            ? task.falsificationConditionIds
            : falsificationConditionIds(hypothesis).slice(0, 1)
          : []
        return {
          evidenceId: `e-counterexample-${digest({
            hypothesisId: hypothesis.id,
            processingRunId: processing.processingRunId,
          }).slice(0, 16)}`,
          hypothesisId: hypothesis.id,
          ...(task ? { taskId: task.taskId } : {}),
          agentId: 'oracle-local-counterexample',
          status: contradictsSpecificity ? ('contradict' as const) : ('unknown' as const),
          evidenceRole: 'diagnostic_boundary' as const,
          contradictionScope:
            boundFalsificationIds.length > 0
              ? ('critical_prediction' as const)
              : ('diagnostic_specificity' as const),
          claim: contradictsSpecificity
            ? boundFalsificationIds.length > 0
              ? '同活动区背景窗口出现相近热通道变异，预注册的关键证伪条件（该诊断的特异性丧失）被可复核测量命中。'
              : '同活动区背景窗口出现相近热通道变异，削弱该指标对当前机制的特异性。'
            : '同活动区背景对照尚未构成可复核反例。',
          observed:
            typeof ratio === 'number'
              ? `目标窗口与背景窗口的热通道变异比为 ${ratio.toFixed(2)}。`
              : '目标窗口和背景窗口不能形成稳定的热通道变异比值。',
          method: 'same-active-region background-window comparison',
          sourceIds: [LOCAL_CORONAL_SOURCE_ID],
          sampleIds: baseline.sampleIds,
          predictionIds: task?.predictionIds.length
            ? task.predictionIds
            : predictionIds(hypothesis).slice(0, 1),
          falsificationConditionIds: boundFalsificationIds,
          provenance: processing.provenance,
          lineage: localEvidenceLineage(
            processing,
            'background_control',
            'same-active-region-background-control',
          ),
          metrics: { targetToBackgroundVariabilityRatio: ratio ?? null },
          quantitativeResults: ratioResults,
          uncertainty: '背景窗口与目标窗口并非严格事件匹配样本，只用于检验指标特异性。',
          limitations: [
            '该对照反驳的是单一诊断的特异性，不直接反驳加热机制本身。',
            ...processing.analysis.limitations,
          ],
          round: context.round,
        }
      })
      return { evidence, verifiedSourceIds: [LOCAL_CORONAL_SOURCE_ID] }
    },
  }
}

function localProcessingFactCheckAgent(load: LocalProcessingLoader): EvidenceAgent {
  return {
    id: 'oracle-processing-fact-check',
    label: `${agentLabel('oracle')}：处理溯源复核`,
    executionKind: 'deterministic',
    capabilities: ['fact-check'],
    canRun: (context) => context.round === 1 || hasRunnableLocalTask(context),
    run: async (context) => {
      const processing = await load(context)
      if (processing.length === 0) return { limitations: ['没有处理运行可供溯源复核。'] }
      const failures = processing.flatMap((item) => [
        ...item.analysis.target.readFailures,
        ...(item.analysis.baseline?.readFailures ?? []),
      ])
      const failureRunIds = processing
        .filter(
          (item) =>
            item.analysis.target.readFailures.length > 0 ||
            (item.analysis.baseline?.readFailures.length ?? 0) > 0,
        )
        .map((item) => item.processingRunId)
      return {
        notes: processing.map(
          (item) =>
            `已登记快照 ${item.snapshotId}、处理运行 ${item.processingRunId} 和两个带校验和的产物。`,
        ),
        limitations:
          failures.length > 0 ? [`处理过程中记录 ${failures.length} 个文件级异常。`] : [],
        corrections:
          failures.length > 0
            ? [
                {
                  stage: 'B-provenance',
                  severity: 'warning',
                  message: '部分 FITS 文件未通过读取或抽样 SHA-256 核验。',
                  action: '保持受影响指标为待验证，并在扩大数据前重新获取异常文件。',
                  affectedIds: failureRunIds,
                },
              ]
            : [],
      }
    },
  }
}

/**
 * Deterministic read-out of the registered supplement analysis products
 * (EIS CHIANTI density spectroscopy, NuSTAR solar-geometry count-rate chain,
 * IRIS method replication). Every product carries
 * `mechanismEvidencePermitted: false`, so the resulting evidence stays
 * `unknown` / `diagnostic_boundary`: visible to the whole loop as
 * positive-control description, never gate-ready mechanism support.
 */
function supplementDiagnosticsAgent(input: DefaultScientificServicesInput): EvidenceAgent {
  return {
    id: 'explorer-supplement-diagnostics',
    label: `${agentLabel('explore')}：补充包派生产物审阅`,
    executionKind: 'deterministic',
    capabilities: ['observation-analysis', 'spectrum-analysis'],
    // Supplement products are immutable, manifest-backed read-outs. They
    // establish a boundary once; repeating them in every round creates no new
    // information and used to inflate the evidence ledger.
    canRun: (context) => context.round === 1,
    run: async (context) => {
      const diagnostics = await loadSupplementAnalysisDiagnostics()
      if (diagnostics.status !== 'ready' || diagnostics.products.length === 0) {
        return { limitations: [...diagnostics.diagnosticBoundaries] }
      }
      const evidence: EvidenceRecord[] = []
      const corrections: EvidenceAgentCorrection[] = []
      for (const product of diagnostics.products) {
        if (!product.fileSha256Matches) {
          corrections.push({
            stage: 'B-provenance',
            kind: 'provenance',
            severity: 'warning',
            message: `补充派生产物 ${product.kind} 的 SHA-256 与补充包登记值不一致，已拒绝定量读取。`,
            action: '重新生成产物并更新补充包 manifest 后再进入科学闭环。',
            affectedIds: [product.relativePath],
          })
          continue
        }
        if (product.quantitativeResults.length === 0) {
          // Hash-verified but interval-free (e.g. a single-raster IRIS method
          // replication whose frozen bootstrap criterion is underpowered):
          // still surface it as a boundary record so the loop can see that
          // the method was registered and attempted, not silently missing.
          evidence.push(
            EvidenceRecordSchema.parse({
              evidenceId: `e-supplement-${digest({
                // Bind the immutable product identity. The same product must
                // retain its evidence id across rounds so state upsert can
                // recognize it as previously observed.
                runId: input.runId,
                kind: product.kind,
                caseId: product.caseId,
                sha256: product.registeredSha256,
              }).slice(0, 16)}`,
              agentId: 'explorer-supplement-diagnostics',
              status: 'unknown',
              evidenceRole: 'diagnostic_boundary',
              claim: `注册补充产物 ${product.kind}（${product.analysisVersion}）已通过校验和与契约校验，但未产出带区间指标：冻结判据样本量不足，功效不足以支持定量陈述。`,
              observed: `输入资产 ${product.inputAssetIds.join('、') || '（未登记）'}；无 quantitativeResults（判据未达统计要求，非反证）。`,
              method: product.analysisVersion,
              sourceIds: [LOCAL_CORONAL_SOURCE_ID],
              predictionIds: [],
              falsificationConditionIds: [],
              provenance: {
                processingRunId: `supplement-${product.kind}-${product.registeredSha256.slice(0, 12)}`,
                dataSnapshotIds: [product.caseId ?? `supplement-${product.kind}`],
                artifactIds: [product.relativePath],
                generatedBy: 'supplement-analysis-products',
                deterministic: true,
              },
              lineage: {
                eventGroupId: product.caseId ?? `supplement-${product.kind}`,
                relatedEventGroupIds: [],
                rawDataFingerprint: product.registeredSha256,
                observableFamily: product.kind.startsWith('iris-method-replication')
                  ? ('spectroscopy' as const)
                  : ('other' as const),
                methodFamily: product.analysisVersion,
                analysisSplit: 'discovery',
              },
              metrics: {
                kind: product.kind,
                analysisVersion: product.analysisVersion,
                mechanismEvidencePermitted: product.mechanismEvidencePermitted,
              },
              quantitativeResults: [],
              uncertainty: '判据样本不足造成的功效边界；补充独立事件后可重新评估。',
              limitations: [
                ...product.boundaries,
                'mechanismEvidencePermitted=false：该产物不得用于机制支持或淘汰。',
              ],
              round: context.round,
            }),
          )
          continue
        }
        const observableFamily = product.kind.startsWith('iris-method-replication')
          ? ('spectroscopy' as const)
          : product.kind.startsWith('eis-versioned-line-fitting')
            ? ('spectroscopy' as const)
            : ('other' as const)
        evidence.push(
          EvidenceRecordSchema.parse({
            evidenceId: `e-supplement-${digest({
              // Bind run identity + round so ids stay unique across runs of
              // the same project (the persistence layer rejects collisions).
              runId: input.runId,
              round: context.round,
              kind: product.kind,
              caseId: product.caseId,
              sha256: product.registeredSha256,
            }).slice(0, 16)}`,
            agentId: 'explorer-supplement-diagnostics',
            status: 'unknown',
            evidenceRole: 'diagnostic_boundary',
            claim: `注册补充产物 ${product.kind}（${product.analysisVersion}）已完成冻结链分析并登记入补充包 manifest；该产物为正控/描述性诊断，不构成机制证据。`,
            observed: `派生产物 quantitativeResults 共 ${product.quantitativeResults.length} 项带区间指标（${product.quantitativeResults
              .map((result) => result.metric)
              .join(
                '、',
              )}）；输入资产 ${product.inputAssetIds.join('、') || '（未登记）'}；SHA-256 校验一致。`,
            method: product.analysisVersion,
            sourceIds: [LOCAL_CORONAL_SOURCE_ID],
            predictionIds: [],
            falsificationConditionIds: [],
            provenance: {
              processingRunId: `supplement-${product.kind}-${product.registeredSha256.slice(0, 12)}`,
              dataSnapshotIds: [product.caseId ?? `supplement-${product.kind}`],
              artifactIds: [product.relativePath],
              generatedBy: 'supplement-analysis-products',
              deterministic: true,
            },
            lineage: {
              eventGroupId: product.caseId ?? `supplement-${product.kind}`,
              relatedEventGroupIds: [],
              rawDataFingerprint: product.registeredSha256,
              observableFamily,
              methodFamily: product.analysisVersion,
              analysisSplit: 'discovery',
            },
            metrics: {
              kind: product.kind,
              analysisVersion: product.analysisVersion,
              mechanismEvidencePermitted: product.mechanismEvidencePermitted,
            },
            quantitativeResults: product.quantitativeResults,
            uncertainty:
              '正控/描述性产物的区间来自冻结 Python 链的 bootstrap/精确泊松计算；机制解释仍被注册边界禁止。',
            limitations: [
              ...product.boundaries,
              'mechanismEvidencePermitted=false：该产物不得用于机制支持或淘汰。',
            ],
            round: context.round,
          }),
        )
      }
      return {
        evidence,
        corrections,
        limitations: [
          ...diagnostics.diagnosticBoundaries,
          '补充派生产物只作为正控/描述性诊断进入证据层，不改变任何假设的门禁计数。',
        ],
      }
    },
  }
}

async function synthesizeModelConclusion(
  input: DefaultScientificServicesInput,
  context: Readonly<SynthesisContext>,
  schedule: ModelScheduler,
): Promise<string> {
  const modelConfig = input.agentConfigs?.sisyphus?.modelConfig ?? input.modelConfig
  const result = await schedule(() =>
    runScientificModelTask({
      projectId: input.projectId,
      runId: input.runId,
      agentId: 'sisyphus-scientific-synthesis',
      role: 'sisyphus',
      modelConfig,
      schema: ModelConclusionSchema,
      prompt: `请根据当前 LangGraph State 形成一段有边界的日冕加热机制比较结论。

现象：${phenomenonPrompt(context.phenomenon)}
候选假设：${conciseText(JSON.stringify(hypothesisPromptRows(context.hypotheses)), 8000)}
证据记录：${conciseText(
        JSON.stringify(
          context.evidence.map((item) => ({
            evidenceId: item.evidenceId,
            hypothesisId: item.hypothesisId,
            status: item.status,
            claim: item.claim,
            observed: item.observed,
            method: item.method,
            sourceIds: item.sourceIds,
            hasDeterministicProvenance: Boolean(item.provenance),
            metrics: item.metrics,
            limitations: item.limitations,
          })),
        ),
        14000,
      )}

规则：
- 只有 status=support/contradict 且带确定性 provenance 的记录可作为机制证据；unknown 只能说明一致性、歧义或缺口。
- 不得宣称已证明因果、主导占比或普遍规律。
- conclusion 给出当前窗口内最有依据的比较结论；reasoningSummary 说明依据了哪些记录以及为何控制结论强度。`,
      emitChunk: input.emitChunk,
      abortSignal: context.signal,
      maxOutputTokens: 2400,
      round: context.round,
    }),
  )
  input.emitChunk?.({
    type: 'custom',
    kind: 'scientific.reasoning-summary',
    stage: 'oracle',
    round: context.round,
    agentId: 'sisyphus-scientific-synthesis',
    title: '模型结论收敛依据',
    summary: result.reasoningSummary,
  } as never)
  return result.conclusion
}

async function planModelValidation(
  input: DefaultScientificServicesInput,
  context: Readonly<PlanningContext>,
  schedule: ModelScheduler,
): Promise<ValidationTask[]> {
  const modelConfig = input.agentConfigs?.prometheus?.modelConfig ?? input.modelConfig
  const result = await schedule(() =>
    runScientificModelTask({
      projectId: input.projectId,
      runId: input.runId,
      agentId: 'prometheus-scientific-planner',
      role: 'prometheus',
      modelConfig,
      schema: ModelValidationPlanSchema,
      prompt: `请把当前结论中的关键不确定性转成完整、可执行、能区分候选机制的下一步验证矩阵。

现象：${phenomenonPrompt(context.phenomenon)}
当前结论：${context.conclusion}
候选假设：${conciseText(JSON.stringify(hypothesisPromptRows(context.hypotheses)), 8000)}
证据与缺口：${conciseText(
        JSON.stringify(
          context.evidence.map((item) => ({
            evidenceId: item.evidenceId,
            hypothesisId: item.hypothesisId,
            status: item.status,
            claim: item.claim,
            limitations: item.limitations,
            sourceIds: item.sourceIds,
          })),
        ),
        12000,
      )}

规则：
- 一次提交完整的验证矩阵。优先覆盖尚未执行的预测；允许同一预测绑定多个事先登记、彼此正交的诊断，但不得在看到结果后追加代理量来挑选有利结论。
- 每项任务必须绑定现有 hypothesisId、至少一个 predictionId 和至少一个
  falsificationConditionId；ID 必须逐字复制自上方候选假设，不得自行拼接。
  一项任务只能绑定它实际检验的预测和证伪条件，不得批量填入该假设的全部 ID。
- diagnosticId 是不可扩展的执行契约，只能选择：
  - aia-171-193-timeseries-v1：现有 ROI 的 171/193 跨通道时延、互相关和单一候选主周期；
  - aia-94-131-hot-channel-variability-v1：94/131 稳健峰值数和相对变异度；
  - aia-target-background-variability-v1：目标/同活动区背景的热通道相对变异比较；
  - aia-cross-event-holdout-v1：在独立活动区事件上，以冻结的预处理版本和阈值复测同一候选机制；
  - aia-wcs-unified-roi-v2：把 AIA 重投影到冻结的 193 Å WCS 参考网格并审计统一 ROI；
  - aia-cooling-sequence-v2：预注册 94/131→335→211→193→171 Å 正时延并做 Holm 校正；
  - aia-dem-inversion-v1：六通道共同 ROI 中位强度的正则化 DEM、拟合残差与温度不确定度；
  - aia-event-threshold-sensitivity-v2：在固定 prominence 网格上复测事件检测稳定性；
  - hmi-magnetic-metadata-audit-v2：校验 JSOC record 元数据旁车并计算共空间投影视向磁通、G/Mm 梯度和 PIL 长度；
  - aia-spatial-wave-v1：在冻结 ROI 的 171/193 Å 图像上计算周期相位相干、节点/反节点振幅对比、自动时距轴和表观传播速度；
  - aia-event-fluence-distribution-v1：构建 94/131 Å 稳健热事件目录，计算相对强度 fluence、发生率和有限样本幂律尾部拟合；
  - hmi-sharp-vector-v1：使用已校验 SHARP CEA Br/Bt/Bp、分量误差和消歧置信度，计算径向磁通、水平场、垂直电流和电流螺度代理；
  - aia-hmi-temporal-association-v1：以循环移位零分布检验 94/131 Å 热峰与 SHARP 磁通变化率的时序关联；
  - iris-relative-doppler-v1：在冻结 AR11899 留出事件上使用 IRIS Level-2 和 O I 波长校正，计算 Si IV 高亮区相对参考区 Doppler 位移及 bootstrap 区间；
  - external：上述范围没有覆盖的任何诊断。
- 优先复用本地来源 ${LOCAL_CORONAL_SOURCE_ID}；确需新增数据时，用 future: 开头的清晰来源需求。
- 任何包含人工沿单环掩膜、逐像素/空间分辨 DEM、未由 iris-relative-doppler-v1 覆盖的光谱诊断、NLFFF/日冕自由能、真实辐射能或能流、因果重联率、多尺度/多周期分解、
  阿尔芬/声学时标、能量闭合或 MHD 的任务必须选择 external。自动 ROI 的空间相干/表观传播只能选择 aia-spatial-wave-v1；
  相对 fluence 不能写成物理能量；SHARP 矢量代理不能写成日冕自由能。上述本地 diagnosticId
  必须使用 route=B、type=analysis；external 才可按缺口选择其他 route/type。
- 不得把多个执行器能力或 external 步骤混入一个本地执行任务；应拆分任务。
- 不得把“再让模型思考”本身当作验证；model-update 只能在已有标注或处理产物可用于训练时使用。
- reasoningSummary 说明任务排序和预算取舍。`,
      emitChunk: input.emitChunk,
      abortSignal: context.signal,
      maxOutputTokens: 2800,
      round: context.round,
    }),
  )

  const hypothesisIds = new Set(context.hypotheses.map((item) => item.id))
  // Only the same executor/prediction pair is considered already tested.
  // Orthogonal diagnostics may be pre-registered for one prediction in the
  // same batch; this is comprehensive testing, not post-hoc shopping.
  const locallyCompletedDiagnosticKeys = new Set(
    context.context.validationTasks
      .filter(
        (task) =>
          task.status === 'completed' && Boolean(task.executorId) && task.executorId !== 'external',
      )
      .flatMap((task) =>
        task.hypothesisIds.flatMap((hypothesisId) =>
          task.predictionIds.map(
            (predictionId) => `${task.executorId}|${hypothesisId}|${predictionId}`,
          ),
        ),
      ),
  )
  const tasks = result.tasks
    .filter((task) => hypothesisIds.has(task.hypothesisId))
    .flatMap((task) => {
      const hypothesis = context.hypotheses.find((item) => item.id === task.hypothesisId)!
      const validPredictionIds = new Set(
        task.diagnosticId === 'aia-cross-event-holdout-v1'
          ? localHoldoutPredictionIds(hypothesis)
          : predictionIds(hypothesis),
      )
      const validFalsificationConditionIds = new Set(falsificationConditionIds(hypothesis))
      const boundPredictionIds = [
        ...new Set(task.predictionIds.filter((id) => validPredictionIds.has(id))),
      ]
      const boundFalsificationConditionIds = [
        ...new Set(
          task.falsificationConditionIds.filter((id) => validFalsificationConditionIds.has(id)),
        ),
      ]
      if (boundPredictionIds.length === 0 || boundFalsificationConditionIds.length === 0) {
        return []
      }
      if (
        task.diagnosticId === 'aia-cross-event-holdout-v1' &&
        context.evidence.some(
          (evidence) =>
            evidence.hypothesisId === task.hypothesisId &&
            evidence.lineage?.analysisSplit === 'holdout' &&
            boundPredictionIds.some((predictionId) =>
              evidence.predictionIds.includes(predictionId),
            ),
        )
      ) {
        // A rerun of the same frozen holdout event is not independent
        // evidence. Keep the previous result and request a genuinely new
        // event or diagnostic instead of manufacturing another task.
        return []
      }
      const relatedEvidence = [...context.evidence]
        .reverse()
        .find((item) => item.hypothesisId === task.hypothesisId)
      const executorId = MODEL_DIAGNOSTIC_EXECUTORS[task.diagnosticId]
      const locallyRegistered = executorId !== 'external'
      if (
        locallyRegistered &&
        boundPredictionIds.some((predictionId) =>
          locallyCompletedDiagnosticKeys.has(`${executorId}|${task.hypothesisId}|${predictionId}`),
        )
      )
        return []
      // An explicit local executor is the source of truth for routing. Models
      // may describe the scientific action as an "observation", but the
      // runtime action is a deterministic B-stage analysis over an already
      // registered local source.
      const route = locallyRegistered ? ('explorer' as const) : task.route
      const type = locallyRegistered ? ('analysis' as const) : task.type
      const requiredSourceIds = locallyRegistered
        ? [...new Set([...task.requiredSourceIds, LOCAL_CORONAL_SOURCE_ID])]
        : [...new Set(task.requiredSourceIds.map(canonicalValidationSourceId))]
      const readiness: NonNullable<ValidationTask['readiness']> = locallyRegistered
        ? 'executable_now'
        : type === 'human-review'
          ? 'human_review'
          : requiredSourceIds.some((sourceId) => sourceId.startsWith('future:'))
            ? 'requires_data'
            : 'external'
      const requiredData = requiredSourceIds.map((sourceId) =>
        sourceId === LOCAL_CORONAL_SOURCE_ID
          ? '本地清单中已校验的 AIA/HMI FITS 观测窗口'
          : `来源或数据需求：${sourceId}`,
      )
      const requiredFacilities = locallyRegistered
        ? ['本地确定性 FITS 分析执行器（CPU 可运行）']
        : type === 'human-review'
          ? ['领域专家复核']
          : type === 'simulation'
            ? ['外部数值模拟或前向建模环境']
            : ['外部数据处理环境或尚未注册的诊断执行器']
      const objective = locallyRegistered
        ? task.diagnosticId === 'aia-171-193-timeseries-v1'
          ? `计算当前 ROI 的 AIA 171/193 跨通道互相关、时延和单一候选主周期；检验 ${boundPredictionIds.join('、')}。`
          : task.diagnosticId === 'aia-94-131-hot-channel-variability-v1'
            ? `计算当前 ROI 的 AIA 94/131 稳健峰值数和相对变异度；检验 ${boundPredictionIds.join('、')}。`
            : task.diagnosticId === 'aia-target-background-variability-v1'
              ? `比较目标窗口与同活动区背景窗口的热通道相对变异；检验 ${boundPredictionIds.join('、')}。`
              : task.diagnosticId === 'aia-wcs-unified-roi-v2'
                ? `将全部 AIA 通道重投影到冻结的 193 Å WCS 参考网格并审计统一 ROI；检验 ${boundPredictionIds.join('、')}。`
                : task.diagnosticId === 'aia-cooling-sequence-v2'
                  ? `按预注册顺序计算 94/131→335→211→193→171 Å 正冷却时延并进行 Holm 校正；检验 ${boundPredictionIds.join('、')}。`
                  : task.diagnosticId === 'aia-dem-inversion-v1'
                    ? `对冻结共同 ROI 的 94/131/171/193/211/335 Å 强度执行正则化 DEM，并报告拟合残差与温度不确定度；检验 ${boundPredictionIds.join('、')}。`
                    : task.diagnosticId === 'aia-event-threshold-sensitivity-v2'
                      ? `在冻结的 prominence 阈值网格上复测热通道事件数稳定性；检验 ${boundPredictionIds.join('、')}。`
                      : task.diagnosticId === 'hmi-magnetic-metadata-audit-v2'
                        ? `校验 HMI JSOC 元数据并报告共空间投影视向磁通、梯度与 PIL 长度及其边界；检验 ${boundPredictionIds.join('、')}。`
                        : task.diagnosticId === 'aia-spatial-wave-v1'
                          ? `在冻结 ROI 的 171/193 Å 图像上计算空间相干、节点/反节点代理、自动时距轴和表观传播速度；检验 ${boundPredictionIds.join('、')}。`
                          : task.diagnosticId === 'aia-event-fluence-distribution-v1'
                            ? `构建 94/131 Å 热事件目录并计算相对 fluence、发生率和幂律尾部拟合；检验 ${boundPredictionIds.join('、')}。`
                            : task.diagnosticId === 'hmi-sharp-vector-v1'
                              ? `使用已校验 HMI SHARP CEA 矢量场计算径向磁通、水平场、垂直电流和不确定度代理；检验 ${boundPredictionIds.join('、')}。`
                              : task.diagnosticId === 'aia-hmi-temporal-association-v1'
                                ? `用循环移位零分布检验 94/131 Å 热峰与 SHARP 径向磁通变化率的时序关联；检验 ${boundPredictionIds.join('、')}。`
                                : task.diagnosticId === 'iris-relative-doppler-v1'
                                  ? `在冻结 AR11899 留出事件上用 O I 校正的 IRIS Si IV 高亮区相对参考区 Doppler 位移和 bootstrap 区间检验 ${boundPredictionIds.join('、')}。`
                                  : `在独立活动区留出事件上使用冻结的预处理版本和诊断阈值复测候选机制；检验 ${boundPredictionIds.join('、')}。`
        : task.scientificPurpose
      if (locallyRegistered) {
        for (const predictionId of boundPredictionIds) {
          locallyCompletedDiagnosticKeys.add(`${executorId}|${task.hypothesisId}|${predictionId}`)
        }
      }
      const fingerprint = digest({
        hypothesisId: task.hypothesisId,
        diagnosticId: task.diagnosticId,
        executorId,
        route,
        type,
        objective,
        requiredSourceIds,
        discriminatingOutcomes: task.discriminatingOutcomes,
        predictionIds: boundPredictionIds,
        falsificationConditionIds: boundFalsificationConditionIds,
      })
      return [
        {
          taskId: `task-model-${fingerprint.slice(0, 12)}`,
          executorId,
          route,
          type,
          objective,
          hypothesisIds: [task.hypothesisId],
          predictionIds: boundPredictionIds,
          falsificationConditionIds: boundFalsificationConditionIds,
          requiredSourceIds,
          requiredData,
          requiredFacilities,
          readiness,
          expectedDuration: locallyRegistered
            ? '单个本地事件通常 1–10 分钟（不含模型推理）'
            : '依赖项到位后预计 1–4 周；提交前需用实测运行时间替换',
          successCriteria: task.discriminatingOutcomes,
          failureCriteria: boundFalsificationConditionIds.map((conditionId) => {
            const index = falsificationConditionIds(hypothesis).indexOf(conditionId)
            return hypothesis.falsificationConditions[index] ?? `满足证伪条件 ${conditionId}`
          }),
          ...(readiness === 'executable_now'
            ? {}
            : {
                blockedReason:
                  readiness === 'requires_data'
                    ? '所需 future: 数据尚未登记到本地数据清单。'
                    : '当前仓库未注册该诊断的确定性执行器。',
              }),
          discriminatingOutcomes: task.discriminatingOutcomes,
          triggeredBy: relatedEvidence?.evidenceId ?? task.hypothesisId,
          status: 'planned' as const,
          resultEvidenceIds: [],
          round: context.round,
          fingerprint,
        },
      ]
    })
  input.emitChunk?.({
    type: 'custom',
    kind: 'scientific.reasoning-summary',
    stage: 'prometheus',
    round: context.round,
    agentId: 'prometheus-scientific-planner',
    title: '模型验证计划依据',
    summary: result.reasoningSummary,
  } as never)
  // Per-hypothesis holdout coverage: one holdout planned for another
  // hypothesis must not silently skip the cohort hypothesis's own cross-event
  // replication (the 2026-08-29 regression showed a cohort hypothesis with
  // zero covered predictions because the single global holdout check passed).
  const holdoutCoveredHypotheses = new Set(
    tasks
      .filter((task) => task.executorId === 'coronal-cross-event-holdout-v1')
      .flatMap((task) => task.hypothesisIds),
  )
  const holdoutTasks = buildCrossEventHoldoutTasks(context).filter((task) =>
    task.hypothesisIds.every((hypothesisId) => !holdoutCoveredHypotheses.has(hypothesisId)),
  )
  const registeredTasks = buildRegisteredLocalDiagnosticTasks(context)
  const deterministicSuite = [...holdoutTasks, ...registeredTasks]
  const deterministicCoverage = new Set(
    deterministicSuite.flatMap((task) =>
      task.predictionIds.map((predictionId) => `${task.executorId}|${predictionId}`),
    ),
  )
  const supplementalTasks = tasks.filter(
    (task) =>
      task.executorId === 'external' ||
      !task.predictionIds.every((predictionId) =>
        deterministicCoverage.has(`${task.executorId}|${predictionId}`),
      ),
  )
  const completenessTasks = buildExternalCompletenessTasks(context, supplementalTasks)
  const comprehensiveTasks = mergeSharedExecutableTasks([
    ...deterministicSuite,
    ...supplementalTasks,
    ...completenessTasks,
  ])
  if (comprehensiveTasks.length > 0) return comprehensiveTasks

  // Model output may be structurally valid yet entirely filtered because the
  // same local prediction has already been tested. Preserve a concrete
  // external follow-up for unresolved hypotheses instead of ending with no
  // next plan at all.
  return context.round > 1 ? buildTasks(context, true) : []
}

function preregisteredLocalDetectability(input?: {
  effectMetric: string
  unit: string
  minimumMeaningfulEffect: number
}): NonNullable<ValidationTask['detectability']> {
  return {
    effectMetric: input?.effectMetric ?? 'unregistered-diagnostic-effect',
    unit: input?.unit ?? 'unregistered',
    alpha: 0.05,
    targetPower: 0.8,
    minimumMeaningfulEffect: input?.minimumMeaningfulEffect ?? 0.5,
    independentEventCount: 0,
    minimumIndependentEventCount: PREREGISTERED_MINIMUM_INDEPENDENT_EVENTS,
    adequate: false,
    assumptions: [
      'Independent units are active-region event groups, not image frames.',
      'No null or negative result is mechanism-falsifying until achieved power and minimum detectable effect are reported.',
      ...(input
        ? [
            `The minimum meaningful effect was frozen for ${input.effectMetric} before gate evaluation.`,
          ]
        : [
            'This task has no registered quantitative effect metric and cannot pass the power gate.',
          ]),
    ],
  }
}

/**
 * Ensure every active candidate leaves the same planning pass with a concrete
 * discriminating follow-up. The model can propose better external work, but a
 * missing model row must not leave one mechanism with no next validation path.
 */
export function buildExternalCompletenessTasks(
  context: Readonly<PlanningContext>,
  existingTasks: readonly ValidationTask[],
): ValidationTask[] {
  const externallyCoveredHypothesisIds = new Set(
    existingTasks
      .filter((task) => task.executorId === 'external' || task.readiness !== 'executable_now')
      .flatMap((task) => task.hypothesisIds),
  )
  return context.hypotheses
    .filter(
      (hypothesis) =>
        hypothesis.status !== 'revised' &&
        hypothesis.status !== 'eliminated' &&
        !externallyCoveredHypothesisIds.has(hypothesis.id),
    )
    .map((hypothesis) => {
      const key = mechanismKey(hypothesis)
      const mechanismText = hypothesis.mechanismComposition.map((item) => item.mechanism).join(' ')
      const processLevel =
        isScopedImpulsiveThermalHypothesis(hypothesis) ||
        (/(?:低频|间歇|脉冲|impulsive)/i.test(mechanismText) &&
          /(?:加热|heating)/i.test(mechanismText) &&
          !/(?:磁重联|重联|纳耀斑|nanoflare|reconnect)/i.test(mechanismText))
      const representedFamilies = mechanismFamiliesInText(
        `${hypothesis.statement} ${mechanismText}`,
      )
      const openWorldSpecification = representedFamilies
        .map((family) => OPEN_WORLD_FOLLOWUP_SPECIFICATIONS[family])
        .find(Boolean)
      const requiredSourceIds = processLevel
        ? ['future:independent-event-spectroscopy', 'future:temperature-density-diagnostics']
        : key === 'coupled'
          ? ['future:matched-mhd-forward-model', 'future:component-ablation-study']
          : (openWorldSpecification?.sourceIds ?? ['future:expert-open-world-hypothesis-review'])
      const objective = processLevel
        ? '在新增独立活动区上联合温度、密度和光谱诊断，区分低频脉冲热过程与近稳态热过程，并完成预注册功效计算。'
        : key === 'coupled'
          ? '用匹配观测几何与仪器响应的 MHD 前向模型执行波动、重联及耦合项消融比较，检验耦合是否提供独立解释增益。'
          : (openWorldSpecification?.objective ??
            '由领域专家冻结该开放世界候选的物理定义、原子预测和致命证伪条件。')
      const type: ValidationTask['type'] =
        key === 'coupled' ? 'simulation' : (openWorldSpecification?.type ?? 'human-review')
      const readiness: NonNullable<ValidationTask['readiness']> =
        type === 'human-review' ? 'human_review' : 'requires_data'
      const hypothesisPredictionIds = predictionIds(hypothesis)
      const hypothesisFalsificationIds = falsificationConditionIds(hypothesis)
      const fingerprint = digest({
        kind: 'complete-external-gap-matrix',
        hypothesisId: hypothesis.id,
        objective,
        requiredSourceIds,
        hypothesisPredictionIds,
        hypothesisFalsificationIds,
      })
      return {
        taskId: `task-gap-${fingerprint.slice(0, 12)}`,
        executorId: 'external',
        route: 'explorer',
        type,
        objective,
        hypothesisIds: [hypothesis.id],
        predictionIds: hypothesisPredictionIds,
        falsificationConditionIds: hypothesisFalsificationIds,
        requiredSourceIds,
        requiredData: requiredSourceIds.map((sourceId) => `待补充数据或产物：${sourceId}`),
        requiredFacilities:
          type === 'human-review'
            ? ['领域专家裁决与预注册环境']
            : type === 'simulation'
              ? ['MHD/前向模拟与仪器响应卷积环境']
              : ['外部太阳观测数据服务与定量分析环境'],
        readiness,
        expectedDuration:
          type === 'human-review'
            ? '预计 1–3 个工作日'
            : '数据取得后预计 1–4 周；提交前需用实测周期替换',
        successCriteria: [...hypothesis.predictions],
        failureCriteria: [...hypothesis.falsificationConditions],
        blockedReason:
          type === 'human-review'
            ? '需要领域专家冻结机制定义与原子预测。'
            : '所需 future: 数据或模拟产物尚未登记到本地数据清单。',
        detectability: preregisteredLocalDetectability(),
        discriminatingOutcomes: [...hypothesis.predictions, ...hypothesis.falsificationConditions],
        triggeredBy:
          [...context.evidence]
            .reverse()
            .find((evidence) => evidence.hypothesisId === hypothesis.id)?.evidenceId ??
          `round-${context.round}-complete-gap-matrix`,
        status: 'planned',
        resultEvidenceIds: [],
        round: context.round,
        fingerprint,
      }
    })
}

/**
 * A registered local executor performs one shared computation over the frozen
 * processing products. Merge all hypothesis bindings before scheduling so a
 * second mechanism cannot cause the same diagnostic to be recomputed.
 */
export function mergeSharedExecutableTasks(tasks: readonly ValidationTask[]): ValidationTask[] {
  const sharedByExecutor = new Map<string, ValidationTask[]>()
  const passthrough: ValidationTask[] = []
  const order: Array<{ kind: 'shared'; groupKey: string } | { kind: 'task'; index: number }> = []

  for (const task of tasks) {
    if (task.readiness !== 'executable_now' || !task.executorId || task.executorId === 'external') {
      order.push({ kind: 'task', index: passthrough.length })
      passthrough.push(task)
      continue
    }
    const groupKey = `${task.executorId}|${task.detectability?.effectMetric ?? 'no-effect-metric'}`
    const group = sharedByExecutor.get(groupKey)
    if (group) {
      group.push(task)
    } else {
      sharedByExecutor.set(groupKey, [task])
      order.push({ kind: 'shared', groupKey })
    }
  }

  const merged = new Map<string, ValidationTask>()
  for (const [groupKey, group] of sharedByExecutor) {
    const first = group[0]!
    const executorId = first.executorId!
    const hypothesisIds = [...new Set(group.flatMap((task) => task.hypothesisIds))]
    const mergedPredictionIds = [...new Set(group.flatMap((task) => task.predictionIds))]
    const mergedFalsificationIds = [
      ...new Set(group.flatMap((task) => task.falsificationConditionIds)),
    ]
    const objective = `${first.objective} 该执行器在本轮只运行一次，并共享检验 ${mergedPredictionIds.join('、')}。`
    const requiredSourceIds = [...new Set(group.flatMap((task) => task.requiredSourceIds))]
    const fingerprint = digest({
      kind: 'shared-local-executor',
      executorId,
      hypothesisIds,
      predictionIds: mergedPredictionIds,
      falsificationConditionIds: mergedFalsificationIds,
      requiredSourceIds,
    })
    merged.set(groupKey, {
      ...first,
      taskId: `task-shared-${fingerprint.slice(0, 12)}`,
      objective,
      hypothesisIds,
      predictionIds: mergedPredictionIds,
      falsificationConditionIds: mergedFalsificationIds,
      requiredSourceIds,
      requiredData: [...new Set(group.flatMap((task) => task.requiredData ?? []))],
      requiredFacilities: [...new Set(group.flatMap((task) => task.requiredFacilities ?? []))],
      successCriteria: [...new Set(group.flatMap((task) => task.successCriteria ?? []))],
      failureCriteria: [...new Set(group.flatMap((task) => task.failureCriteria ?? []))],
      discriminatingOutcomes: [...new Set(group.flatMap((task) => task.discriminatingOutcomes))],
      triggeredBy: `round-${first.round}-shared-executor-matrix`,
      detectability: first.detectability ?? preregisteredLocalDetectability(),
      status: 'planned',
      resultEvidenceIds: [],
      fingerprint,
    })
  }

  return order.map((entry) =>
    entry.kind === 'task' ? passthrough[entry.index]! : merged.get(entry.groupKey)!,
  )
}

function buildCrossEventHoldoutTasks(context: Readonly<PlanningContext>): ValidationTask[] {
  const candidates = context.hypotheses.filter(
    (hypothesis) =>
      hypothesis.status !== 'revised' &&
      hypothesis.status !== 'eliminated' &&
      !context.evidence.some(
        (evidence) =>
          evidence.hypothesisId === hypothesis.id && evidence.lineage?.analysisSplit === 'holdout',
      ),
  )
  const eligible = candidates.flatMap((hypothesis) => {
    const key = mechanismKey(hypothesis)
    const predictionId = localHoldoutPredictionIds(hypothesis)[0]
    const falsificationConditionId = falsificationConditionIds(hypothesis)[0]
    return key && predictionId && falsificationConditionId
      ? [{ hypothesis, key, predictionId, falsificationConditionId }]
      : []
  })
  return eligible.map(({ hypothesis, key, predictionId, falsificationConditionId }) => {
    const objective = `在独立活动区留出事件上使用冻结参数复测 ${predictionId} 的${key === 'wave' ? '171/193 Å 时序' : key === 'reconnection' ? '94/131 Å 热通道' : '波动—热响应联合'}子指标；不根据留出结果修改 ROI、阈值或假设，也不把子指标复现写成完整机制成立。`
    const fingerprint = digest({
      executorId: 'coronal-cross-event-holdout-v1',
      hypothesisId: hypothesis.id,
      predictionId,
      falsificationConditionId,
      key,
      objective,
      selectionPolicy: 'different-active-region-non-background-case',
    })
    const detectability =
      key === 'wave'
        ? preregisteredLocalDetectability({
            effectMetric: 'aia_171_193_selected_lag_correlation',
            unit: '1',
            minimumMeaningfulEffect: 0.3,
          })
        : preregisteredLocalDetectability({
            effectMetric: 'aia_94_131_relative_variability',
            unit: '1',
            minimumMeaningfulEffect: 0.2,
          })
    return {
      taskId: `task-holdout-${fingerprint.slice(0, 12)}`,
      executorId: 'coronal-cross-event-holdout-v1',
      route: 'explorer',
      type: 'analysis',
      objective,
      hypothesisIds: [hypothesis.id],
      predictionIds: [predictionId],
      falsificationConditionIds: [falsificationConditionId],
      requiredSourceIds: [LOCAL_CORONAL_SOURCE_ID],
      requiredData: ['本地清单中不同活动区的 AIA 多波段留出事件'],
      requiredFacilities: ['本地确定性 FITS 分析执行器（CPU 可运行）'],
      readiness: 'executable_now',
      expectedDuration: '多个 holdout 任务共享一次数据读取，通常 1–20 分钟',
      successCriteria: [
        key === 'wave'
          ? `独立事件复现 ${predictionId} 的 171/193 Å 时序子指标；这不是能流证据。`
          : `独立事件复现 ${predictionId} 的 94/131 Å 热通道子指标；这不是重联证据。`,
      ],
      failureCriteria: [
        `达到登记功效后未复现该子指标，仅削弱 ${falsificationConditionId} 对应的子预测。`,
      ],
      discriminatingOutcomes: [
        `${predictionId} 的跨事件子指标复现`,
        `${predictionId} 的跨事件子指标在充分功效下不复现`,
      ],
      triggeredBy:
        [...context.evidence].reverse().find((evidence) => evidence.hypothesisId === hypothesis.id)
          ?.evidenceId ?? `round-${context.round}-holdout-policy`,
      detectability,
      status: 'planned',
      resultEvidenceIds: [],
      round: context.round,
      fingerprint,
    }
  })
}

export function buildRegisteredLocalDiagnosticTasks(
  context: Readonly<PlanningContext>,
): ValidationTask[] {
  const specifications = [
    {
      executorId: 'coronal-wcs-unified-roi-v2',
      predictionPattern: /./,
      falsificationPattern: /./,
      objective:
        '将全部 AIA 通道重投影到冻结的 193 Å WCS 参考网格并审计统一 ROI；该任务只建立测量坐标一致性。',
    },
    {
      executorId: 'coronal-timeseries-lag-v1',
      predictionPattern: /(?:171|193|时延|相位|周期|波动|传播)/i,
      falsificationPattern: /(?:171|193|时延|相位|周期|波动|传播|不相关)/i,
      objective: '计算冻结 ROI 的 AIA 171/193 跨通道互相关、时延和单一候选主周期。',
      detectability: {
        effectMetric: 'aia_171_193_selected_lag_correlation',
        unit: '1',
        minimumMeaningfulEffect: 0.3,
      },
    },
    {
      executorId: 'coronal-hot-channel-variability-v1',
      predictionPattern: /(?:94|131|热通道|间歇|脉冲|增亮|重联|纳耀斑)/i,
      falsificationPattern: /(?:94|131|热通道|间歇|脉冲|增亮|重联|纳耀斑|稳态)/i,
      objective: '计算冻结 ROI 的 AIA 94/131 稳健峰值数和相对变异度。',
      detectability: {
        effectMetric: 'aia_94_131_relative_variability',
        unit: '1',
        minimumMeaningfulEffect: 0.2,
      },
    },
    {
      executorId: 'coronal-background-variability-v1',
      predictionPattern: /(?:94|131|热通道|间歇|脉冲|增亮|重联|纳耀斑)/i,
      falsificationPattern: /(?:94|131|热通道|背景|对照|间歇|脉冲|增亮)/i,
      objective: '比较目标窗口与同活动区冻结背景窗口的热通道相对变异。',
      detectability: {
        effectMetric: 'target_to_background_hot_channel_variability_ratio',
        unit: 'ratio',
        minimumMeaningfulEffect: 0.25,
      },
    },
    {
      executorId: 'coronal-dem-inversion-v1',
      predictionPattern: /(?:DEM|温度|热结构|多温|高温成分|发射量)/i,
      falsificationPattern: /(?:DEM|温度|热结构|多温|高温成分|发射量)/i,
      objective:
        '对冻结共同 ROI 的六通道 AIA 中位强度执行正则化 DEM，报告温度、发射量、约化 χ² 和显式不确定度。',
      detectability: {
        effectMetric: 'aia_dem_em_weighted_log10_temperature',
        unit: 'log10(K)',
        minimumMeaningfulEffect: 0.1,
      },
    },
    {
      executorId: 'coronal-cooling-sequence-v2',
      predictionPattern: /(?:冷却|时延|热演化|94|131|335|211)/i,
      falsificationPattern: /(?:冷却|时延|热演化|通道顺序|温度)/i,
      objective:
        '按预注册顺序计算 94/131→335→211→193→171 Å 正冷却时延，并用循环移位零分布与 Holm 校正评估稳定性。',
      detectability: {
        effectMetric: 'aia_cooling_193_to_171_lag_correlation',
        unit: '1',
        minimumMeaningfulEffect: 0.3,
      },
    },
    {
      executorId: 'coronal-event-threshold-sensitivity-v2',
      predictionPattern: /(?:94|131|热通道|间歇性增强|间歇增亮)/i,
      falsificationPattern: /(?:94|131|热通道|间歇性增强|间歇增亮|事件阈值)/i,
      objective: '在冻结的 prominence 阈值网格 1.25/1.50/1.75/2.00 上复测热通道事件数敏感性。',
    },
    {
      executorId: 'coronal-hmi-magnetic-audit-v2',
      predictionPattern: /(?:HMI|磁通|磁场|磁梯度|PIL|重联)/i,
      falsificationPattern: /(?:HMI|磁通|磁场|磁梯度|PIL|重联)/i,
      objective:
        '校验 HMI JSOC record 元数据旁车，计算共空间投影视向磁通、G/Mm 梯度和 PIL 长度；缺少物理元数据时保持 unknown。',
    },
    {
      executorId: 'coronal-spatial-wave-v1',
      predictionPattern: /(?:空间相干|节点|反节点|传播|相位差|驻波|波列)/i,
      falsificationPattern: /(?:空间相干|节点|反节点|传播|相位差|驻波|波列)/i,
      objective:
        '在冻结 ROI 的 171/193 Å 降采样图像上计算周期相位相干、节点/反节点振幅对比、自动时距轴和表观传播速度。',
      detectability: {
        effectMetric: 'aia_spatial_apparent_propagation_speed',
        unit: 'km/s',
        minimumMeaningfulEffect: 20,
      },
    },
    {
      executorId: 'coronal-event-fluence-distribution-v1',
      predictionPattern: /(?:事件能量|能量分布|fluence|幂律|事件率|发生率|纳耀斑风暴)/i,
      falsificationPattern: /(?:事件能量|能量分布|fluence|幂律|事件率|发生率|纳耀斑风暴)/i,
      objective:
        '构建 94/131 Å 稳健热事件目录，计算相对强度 fluence、发生率和有限样本幂律尾部拟合。',
      detectability: {
        effectMetric: 'aia_hot_event_relative_fluence_power_law_exponent',
        unit: '1',
        minimumMeaningfulEffect: 0.5,
      },
    },
    {
      executorId: 'coronal-hmi-sharp-vector-v1',
      predictionPattern: /(?:SHARP|矢量磁场|径向磁通|水平场|垂直电流|电流螺度)/i,
      falsificationPattern: /(?:SHARP|矢量磁场|径向磁通|水平场|垂直电流|电流螺度)/i,
      objective:
        '使用已校验 HMI SHARP CEA Br/Bt/Bp、分量误差和消歧置信度，计算径向磁通、水平场和垂直电流代理。',
    },
    {
      executorId: 'coronal-aia-hmi-temporal-association-v1',
      predictionPattern:
        /(?:磁场|磁通|电流).*(?:热增亮|热通道|94|131)|(?:热增亮|热通道|94|131).*(?:磁场|磁通|电流)/i,
      falsificationPattern:
        /(?:磁场|磁通|电流).*(?:热增亮|热通道|94|131)|(?:热增亮|热通道|94|131).*(?:磁场|磁通|电流)/i,
      objective: '用循环移位零分布检验 94/131 Å 热峰与 SHARP 无符号径向磁通变化率的时序关联。',
    },
    {
      executorId: 'coronal-iris-spectroscopy-v1',
      predictionPattern: /(?:IRIS|Si\s*IV|Doppler|多普勒|光谱|红移|下流|流速)/i,
      falsificationPattern: /(?:IRIS|Si\s*IV|Doppler|多普勒|光谱|红移|下流|流速)/i,
      objective:
        '在预注册 AR11899 留出事件中读取 IRIS Level-2 raster，以 O I 1355.5988 Å 校正波长漂移，并报告 Si IV 高亮区相对参考区 Doppler 速度及 raster-bootstrap 区间。',
      detectability: {
        effectMetric: 'iris_si_iv_literature_footpoint_doppler_velocity',
        unit: 'km/s',
        minimumMeaningfulEffect: 2,
      },
    },
  ] as const
  const activeHypotheses = context.hypotheses.filter(
    (hypothesis) => hypothesis.status !== 'revised' && hypothesis.status !== 'eliminated',
  )
  return specifications.flatMap((specification) => {
    const bindings = activeHypotheses.flatMap((hypothesis) => {
      const matchedPredictionIndexes = hypothesis.predictions
        .map((statement, index) => ({ statement, index }))
        .filter(({ statement }) => specification.predictionPattern.test(statement))
        .filter(({ statement }) => executorSupportsPrediction(specification.executorId, statement))
        .map(({ index }) => index)
      if (matchedPredictionIndexes.length === 0) return []
      const matchedFalsificationIndex = hypothesis.falsificationConditions.findIndex((statement) =>
        specification.falsificationPattern.test(statement),
      )
      const falsificationIndex = Math.max(0, matchedFalsificationIndex)
      return matchedPredictionIndexes.map((predictionIndex) => ({
        hypothesis,
        predictionId: scientificPredictionId(hypothesis.id, predictionIndex),
        falsificationId: scientificFalsificationConditionId(hypothesis.id, falsificationIndex),
        successCriterion: hypothesis.predictions[predictionIndex]!,
        failureCriterion: hypothesis.falsificationConditions[falsificationIndex]!,
      }))
    })
    if (bindings.length === 0) return []
    const hypothesisIds = [...new Set(bindings.map((binding) => binding.hypothesis.id))]
    const predictionIds = [...new Set(bindings.map((binding) => binding.predictionId))]
    const falsificationConditionIds = [
      ...new Set(bindings.map((binding) => binding.falsificationId)),
    ]
    const objective = `${specification.objective} 并行检验 ${predictionIds.join('、')}；该任务完成不等于机制得到支持。`
    const fingerprint = digest({
      executorId: specification.executorId,
      hypothesisIds,
      predictionIds,
      falsificationConditionIds,
      objective,
    })
    return [
      {
        taskId: `task-local-${fingerprint.slice(0, 12)}`,
        executorId: specification.executorId,
        route: 'explorer' as const,
        type: 'analysis' as const,
        objective,
        hypothesisIds,
        predictionIds,
        falsificationConditionIds,
        requiredSourceIds: [LOCAL_CORONAL_SOURCE_ID],
        requiredData: ['本地清单中已校验的 AIA/HMI/IRIS FITS 观测窗口'],
        requiredFacilities: ['本地确定性 FITS 分析执行器（CPU 可运行）'],
        readiness: 'executable_now' as const,
        expectedDuration: '同一轮统一处理并复用中间产物，通常 1–20 分钟',
        successCriteria: bindings.map((binding) => binding.successCriterion),
        failureCriteria: bindings.map((binding) => binding.failureCriterion),
        discriminatingOutcomes: bindings.flatMap((binding) => [
          binding.successCriterion,
          binding.failureCriterion,
        ]),
        triggeredBy: `round-${context.round}-comprehensive-diagnostic-matrix`,
        detectability: preregisteredLocalDetectability(
          'detectability' in specification ? specification.detectability : undefined,
        ),
        status: 'planned' as const,
        resultEvidenceIds: [],
        round: context.round,
        fingerprint,
      },
    ]
  })
}

// Per-run registered human-review tasks were removed by team decision
// (2026-08-29): governance review is maintained as a versioned dossier at
// docs/expert-review/human-review-dossier.md instead of as deferred work in
// every run's task list. The `human-review` task type remains valid for
// model-planned (prometheus.plan) review work.

const OPEN_WORLD_FOLLOWUP_SPECIFICATIONS: Record<
  string,
  {
    type: ValidationTask['type']
    objective: string
    sourceIds: string[]
    facilities: string[]
  }
> = {
  'wave-energy-transport': {
    type: 'observation',
    objective: '补充环路径、日冕密度、传播速度、阻尼长度与能流，检验波能是否闭合热损失。',
    sourceIds: ['future:manual-loop-kinematics', 'future:coronal-density-measurement'],
    facilities: ['高时间分辨率成像、事件匹配光谱与环路径复核'],
  },
  'reconnection-nanoflare': {
    type: 'observation',
    objective: '补充事件匹配硬 X 射线和磁拓扑变化，检验重联/纳耀斑特异预测。',
    sourceIds: ['future:event-matched-hard-xray', 'future:magnetic-topology-forward-model'],
    facilities: ['硬 X 射线观测与磁场拓扑外推环境'],
  },
  'turbulent-cascade': {
    type: 'simulation',
    objective: '执行匹配几何和仪器响应的湍流前向模型，并与多尺度光谱/热结构联合比较。',
    sourceIds: ['future:turbulence-forward-model', 'future:multi-ion-spectroscopy'],
    facilities: ['MHD/湍流模拟器与多离子光谱'],
  },
  'magnetic-braiding-current-sheets': {
    type: 'simulation',
    objective: '补充足点运动与编织 MHD 前向模拟，检验薄电流层和热事件空间统计。',
    sourceIds: ['future:footpoint-motion-tracking', 'future:braiding-mhd-forward-model'],
    facilities: ['高分辨率磁图、足点追踪与三维 MHD'],
  },
  'thermal-nonequilibrium': {
    type: 'observation',
    objective: '补充完整长周期多通道/304 Å 凝结观测与环流体模型，检验热非平衡循环。',
    sourceIds: ['future:long-duration-condensation-window', 'future:loop-hydrodynamic-model'],
    facilities: ['长时段 EUV 观测与环流体模拟'],
  },
  'quasi-steady-heating': {
    type: 'observation',
    objective: '补充长时段背景稳定性和能量平衡测量，检验近稳态加热。',
    sourceIds: ['future:long-duration-steady-baseline', 'future:coronal-energy-balance'],
    facilities: ['长时段多波段观测与热损失估计'],
  },
  'compressive-shocks': {
    type: 'observation',
    objective: '联合环路径运动学、密度和 Doppler 相位关系，区分慢模压缩/弱冲击与横向波。',
    sourceIds: ['future:loop-path-kinematics', 'future:density-velocity-phase-spectroscopy'],
    facilities: ['高 cadence 成像和事件匹配光谱'],
  },
  'chromospheric-upflows-spicules': {
    type: 'observation',
    objective: '补充共时 IRIS/EIS 蓝翼非对称、Doppler 和 AIA 前沿，区分上流供质与波传播。',
    sourceIds: ['future:co-temporal-iris-eis-upflows', 'future:aia-spectroscopy-coregistration'],
    facilities: ['共时 IRIS/EIS/AIA 观测'],
  },
  'flux-emergence-cancellation': {
    type: 'observation',
    objective: '补充高 cadence 矢量磁图与拓扑演化，检验磁通涌现/消失是否领先热事件。',
    sourceIds: ['future:high-cadence-vector-magnetograms', 'future:topology-evolution-model'],
    facilities: ['高 cadence 矢量磁图与拓扑外推'],
  },
  'kinetic-particle-heating': {
    type: 'observation',
    objective: '补充多离子温度、线宽和速度分布，检验质量荷比相关的离子优先加热。',
    sourceIds: ['future:multi-ion-temperature-spectroscopy', 'future:kinetic-forward-model'],
    facilities: ['多离子高分辨率光谱与动理学模型'],
  },
  'conductive-evaporative-response': {
    type: 'observation',
    objective: '联合温度时延、DEM 与蒸发/凝结 Doppler，检验传导—蒸发—辐射响应轨迹。',
    sourceIds: [
      'future:event-matched-evaporation-spectroscopy',
      'future:hydrodynamic-response-model',
    ],
    facilities: ['事件匹配光谱和流体响应模型'],
  },
}

function buildOpenWorldFollowupTasks(context: Readonly<PlanningContext>): ValidationTask[] {
  const relatedEvidence = (hypothesisId: string) =>
    [...context.evidence].reverse().find((item) => item.hypothesisId === hypothesisId)
      ?.evidenceId ?? 'round-' + context.round + '-followup'
  return context.hypotheses.flatMap((hypothesis) => {
    const text = `${hypothesis.statement} ${hypothesis.mechanismComposition.map((item) => item.mechanism).join(' ')}`
    const detectedFamilies = mechanismFamiliesInText(text)
    const families =
      detectedFamilies.length > 0 ? detectedFamilies : ['unclassified-open-world-alternative']
    return families.map((family) => {
      const specification = OPEN_WORLD_FOLLOWUP_SPECIFICATIONS[family] ?? {
        type: 'human-review' as const,
        objective: '由领域专家冻结该开放世界候选的术语、原子预测和致命证伪条件。',
        sourceIds: ['future:expert-open-world-hypothesis-review'],
        facilities: ['领域专家与预注册环境'],
      }
      const objective = `${specification.objective}；针对“${hypothesis.statement}”`
      const fingerprint = digest({
        hypothesis: hypothesis.id,
        family,
        objective,
        sourceIds: specification.sourceIds,
        kind: 'open-world-external-followup',
      })
      const humanReview = specification.type === 'human-review'
      return {
        taskId: 'task-followup-' + fingerprint.slice(0, 12),
        executorId: 'external',
        route: 'explorer' as const,
        type: specification.type,
        objective,
        hypothesisIds: [hypothesis.id],
        predictionIds: predictionIds(hypothesis),
        falsificationConditionIds: falsificationConditionIds(hypothesis),
        requiredSourceIds: specification.sourceIds,
        requiredData: specification.sourceIds.map((sourceId) => `待补充数据或产物：${sourceId}`),
        requiredFacilities: specification.facilities,
        readiness: humanReview ? ('human_review' as const) : ('requires_data' as const),
        expectedDuration: '数据/设施就绪后预计 1–4 周；提交前需以实测周期替换',
        successCriteria: [...hypothesis.predictions],
        failureCriteria: [...hypothesis.falsificationConditions],
        // Every planned task carries a preregistered detectability contract so
        // a future elimination verdict can be checked against frozen α, power
        // and minimum-effect thresholds instead of post-hoc choices.
        detectability: preregisteredLocalDetectability(),
        blockedReason: humanReview
          ? '候选属于开放世界残余机制，需专家冻结定义后再选择执行器。'
          : '任务依赖尚未登记到本地清单的 future: 数据或模拟产物。',
        discriminatingOutcomes: [...hypothesis.predictions, ...hypothesis.falsificationConditions],
        triggeredBy: relatedEvidence(hypothesis.id),
        status: 'planned' as const,
        resultEvidenceIds: [],
        round: context.round,
        fingerprint,
      }
    })
  })
}

function buildTasks(context: Readonly<PlanningContext>, localGrounded = false): ValidationTask[] {
  if (localGrounded && context.round === 1) {
    const holdoutTasks = buildCrossEventHoldoutTasks(context)
    return [...holdoutTasks, ...buildRegisteredLocalDiagnosticTasks(context)]
  }
  if (localGrounded && context.round > 1) {
    return buildOpenWorldFollowupTasks(context)
  }
  const sources = [
    ...new Set([
      ...sourceIds(context.phenomenon),
      ...context.hypotheses.flatMap((hypothesis) => hypothesis.sourceIds),
    ]),
  ]
  const type: ValidationTask['type'] = sources.length > 0 ? 'analysis' : 'history-search'
  return context.hypotheses.map((hypothesis) => {
    const related = context.evidence.find((item) => item.hypothesisId === hypothesis.id)
    const key = mechanismKey(hypothesis)
    const diagnostic =
      key === null
        ? '先澄清该候选机制的物理定义以及它与可观测预测、证伪条件之间的映射'
        : key === 'wave'
          ? '复测 AIA 171/193 Å 时序的主周期、跨通道相关和稳定性，并明确不能替代传播速度与能流测量'
          : key === 'reconnection'
            ? '复测 AIA 94/131 Å 间歇峰、目标/背景变异比和 HMI 视向磁场代理量'
            : '在同一窗口联合复测波动、热通道与磁场代理量，检查联合指标是否稳定出现'
    const objective =
      sources.length > 0
        ? `${diagnostic}；对应候选：“${hypothesis.statement}”`
        : `根据现象查找可用的多波段观测和数值模拟资料，再检查“${hypothesis.statement}”的可观测预测`
    const fingerprint = digest({ hypothesis: hypothesis.id, objective, sources })
    return {
      taskId: `task-${fingerprint.slice(0, 12)}`,
      route: key === null ? ('librarian' as const) : ('explorer' as const),
      type,
      objective,
      hypothesisIds: [hypothesis.id],
      predictionIds: predictionIds(hypothesis),
      falsificationConditionIds: falsificationConditionIds(hypothesis),
      requiredSourceIds: sources,
      requiredData:
        sources.length > 0
          ? sources.map((sourceId) => `已登记或待解析来源：${sourceId}`)
          : ['与候选预测匹配的多波段观测或模拟数据'],
      requiredFacilities: [
        sources.includes(LOCAL_CORONAL_SOURCE_ID)
          ? '本地 FITS 分析环境；执行前需确认诊断已注册'
          : '外部数据检索与分析环境',
      ],
      readiness: sources.length === 0 ? 'requires_data' : 'unassessed',
      expectedDuration: sources.length === 0 ? '数据取得后评估' : '执行器确认后预计数分钟至数小时',
      successCriteria: [...hypothesis.predictions],
      failureCriteria: [...hypothesis.falsificationConditions],
      ...(sources.length === 0 ? { blockedReason: '当前没有与预测绑定的已登记数据来源。' } : {}),
      discriminatingOutcomes: [...hypothesis.predictions, ...hypothesis.falsificationConditions],
      triggeredBy: related?.evidenceId ?? `round-${context.round}-unknown`,
      status: 'planned' as const,
      resultEvidenceIds: [],
      round: context.round,
      fingerprint,
    }
  })
}

/** Registered metric prefixes used to attribute evidence to diagnostic families. */
const LOCAL_METRIC_FAMILIES: ReadonlyArray<readonly [string, string]> = [
  ['aia_cooling_', '冷却时延'],
  ['aia_dem_', 'DEM 热结构'],
  ['aia_spatial_', '空间相干/传播'],
  ['aia_hot_event_', '事件目录'],
  ['aia_94_131_', '热通道变异'],
  ['aia_171_193_', '跨通道时延'],
  ['target_to_background_', '背景对照'],
  ['hmi_projected_', '视向磁场'],
  ['hmi_sharp_hot_event_', '磁—热关联'],
  ['hmi_sharp_', '矢量磁场'],
  ['iris_', 'IRIS 光谱'],
]

function localCandidateKey(hypothesisId: string): string | null {
  const match = /^h-local-(.+)-([0-9a-f]{10})$/.exec(hypothesisId)
  return match?.[1] ?? null
}

const LOCAL_FAMILY_LABELS: Record<string, string> = {
  wave: '波动耗散',
  'wave-kinematics': '波动运动学',
  reconnection: '间歇性重联',
  'nanoflare-power-law': '纳耀斑事件统计',
  'magnetic-thermal-coupling': '磁—热时序耦合',
  coupled: '耦合机制',
  'thermal-nonequilibrium': '热非平衡循环',
  'dem-evolution': 'DEM 热结构演化',
  'turbulent-cascade': '磁湍流级联',
  'spectroscopic-nonthermal': '光谱非热诊断',
  'steady-baseline': '近稳态对照',
  'thermal-process-cohort': '跨事件热过程（作用域受限）',
}

function synthesizeLocalConclusion(context: {
  hypotheses: readonly ScientificHypothesis[]
  evidence: readonly EvidenceRecord[]
}): string {
  const familyLabel = (hypothesis: ScientificHypothesis): string => {
    const key = localCandidateKey(hypothesis.id)
    if (key && LOCAL_FAMILY_LABELS[key]) return LOCAL_FAMILY_LABELS[key]
    const mechanism = mechanismKey(hypothesis)
    return mechanism === 'wave'
      ? '波动耗散'
      : mechanism === 'reconnection'
        ? '间歇性重联'
        : mechanism === 'coupled'
          ? '耦合机制'
          : (LOCAL_FAMILY_LABELS[key ?? ''] ?? '未分类机制')
  }
  const metricFamiliesOf = (evidence: readonly EvidenceRecord[]): string[] => {
    const families = new Set<string>()
    for (const record of evidence) {
      for (const result of record.quantitativeResults) {
        const family = LOCAL_METRIC_FAMILIES.find(([prefix]) => result.metric.startsWith(prefix))
        if (family) families.add(family[1])
      }
    }
    return [...families]
  }
  const rows = context.hypotheses.map((hypothesis) => {
    const related = context.evidence.filter((item) => item.hypothesisId === hypothesis.id)
    const support = related.filter((item) => item.status === 'support')
    const contradict = related.filter((item) => item.status === 'contradict')
    const uncertain = related.filter((item) => item.status === 'unknown')
    const label = familyLabel(hypothesis)
    const detail: string[] = []
    if (support.length > 0) {
      const families = metricFamiliesOf(support)
      const eventGroups = new Set(
        support
          .map((item) => item.lineage?.eventGroupId)
          .filter((value): value is string => Boolean(value)),
      )
      detail.push(
        `${support.length} 条支持类证据${families.length > 0 ? `（指标族：${families.join('、')}）` : ''}` +
          `${eventGroups.size > 0 ? `，覆盖 ${eventGroups.size} 个独立事件组` : ''}`,
      )
    }
    if (contradict.length > 0) {
      const families = metricFamiliesOf(contradict)
      detail.push(
        `${contradict.length} 条背景反例${families.length > 0 ? `（指标族：${families.join('、')}）` : ''}削弱其特异性`,
      )
    }
    if (support.length === 0 && contradict.length === 0) {
      detail.push(
        uncertain.length > 0
          ? `${uncertain.length} 条证据仍为不确定，现有指标不足以区分`
          : '本轮没有绑定该候选的已执行证据',
      )
    }
    return `${label}（${hypothesis.evidenceStrengthGrade}）：${detail.join('；')}`
  })
  const processingEvidence = context.evidence.filter((item) => item.provenance).length
  const withSupport = context.hypotheses.filter((hypothesis) =>
    context.evidence.some(
      (item) => item.hypothesisId === hypothesis.id && item.status === 'support',
    ),
  ).length
  const withCounterexample = context.hypotheses.filter((hypothesis) =>
    context.evidence.some(
      (item) => item.hypothesisId === hypothesis.id && item.status === 'contradict',
    ),
  ).length
  return [
    `本轮基于 ${processingEvidence} 条绑定确定性处理产物的证据比较 ${context.hypotheses.length} 个候选：${withSupport} 个出现支持其部分预测的指标，${withCounterexample} 个存在背景反例。`,
    rows.join('；') + '。',
    '这些结果只评价当前窗口中的可观测预测，不等同于证明加热机制、因果耦合或能量贡献比例。',
  ].join('')
}

export function createDefaultScientificDependencies(
  input: DefaultScientificServicesInput,
): ScientificGraphDependencies {
  const localProcessing = createLocalProcessingLoader(input)
  const scheduleModel = createModelScheduler()
  return {
    generateHypotheses: (context) => generateHypotheses(input, context),
    evidenceAgents: input.localGrounded
      ? [
          localObservationCatalogAgent(),
          localDiagnosticsAgent(input, localProcessing),
          localCounterexampleAgent(localProcessing),
          localProcessingFactCheckAgent(localProcessing),
          supplementDiagnosticsAgent(input),
        ]
      : [
          localObservationCatalogAgent(),
          localDiagnosticsAgent(input, localProcessing),
          localCounterexampleAgent(localProcessing),
          localProcessingFactCheckAgent(localProcessing),
          supplementDiagnosticsAgent(input),
          modelObservationQcAgent(input, scheduleModel),
          modelExplorerAgent(input, localProcessing, scheduleModel),
          modelOracleAgent(input, localProcessing, scheduleModel),
        ],
    planValidation: async (context) => {
      if (input.localGrounded) return buildTasks(context, true)
      try {
        return await planModelValidation(input, context, scheduleModel)
      } catch (error) {
        if (input.abortSignal?.aborted) throw error
        input.emitChunk?.({
          type: 'custom',
          kind: 'scientific.self-correction',
          correction: {
            correctionId: `model-planner-fallback-${context.round}-${Date.now()}`,
            stage: 'prometheus',
            kind: 'execution',
            severity: 'warning',
            message: '模型验证计划未形成可接受的结构化提交，已改用确定性任务规划器。',
            action: '只规划已注册执行器或明确标记的外部缺口；模型的截断任务不进入 State。',
            affectedIds: ['prometheus-scientific-planner'],
            triggeredBy: ['prometheus-scientific-planner'],
            round: context.round,
            agentId: 'prometheus-scientific-planner',
          },
        } as never)
        return buildTasks(context, true)
      }
    },
    canExecuteValidationTask: (task) => localValidationExecutor(task) !== null,
    synthesizeConclusion: async (context) => {
      if (input.localGrounded) return synthesizeLocalConclusion(context)
      try {
        return await synthesizeModelConclusion(input, context, scheduleModel)
      } catch (error) {
        if (input.abortSignal?.aborted) throw error
        input.emitChunk?.({
          type: 'custom',
          kind: 'scientific.self-correction',
          correction: {
            correctionId: `model-synthesis-fallback-${context.round}-${Date.now()}`,
            stage: 'oracle',
            kind: 'execution',
            severity: 'warning',
            message: '模型综合结论未形成可接受的结构化提交，已改用受约束的确定性结论。',
            action: '按逐假设状态和证据角色生成有限结论；模型截断文字不进入 State。',
            affectedIds: ['sisyphus-scientific-synthesis'],
            triggeredBy: ['sisyphus-scientific-synthesis'],
            round: context.round,
            agentId: 'sisyphus-scientific-synthesis',
          },
        } as never)
        return synthesizeLocalConclusion(context)
      }
    },
    verifyProvenance: async (evidence: EvidenceRecord) =>
      verifyLocalEvidenceProvenance(input.projectId, evidence),
  }
}

export function parsePhenomenon(input: PhenomenonInput): PhenomenonInput {
  const parsed = PhenomenonInputSchema.parse(input)
  const { inputDigest: _claimedDigest, ...canonical } = parsed
  return {
    ...canonical,
    inputDigest: digest(canonical),
  }
}

export function datasetDirectory(): string {
  return getDatasetDir()
}
