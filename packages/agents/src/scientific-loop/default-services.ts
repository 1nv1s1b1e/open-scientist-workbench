import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getDatasetDir, type AgentRuntimeConfig, type ModelArg } from '@open-scientist/config'
import {
  assessCoronalDataCoverage,
  LOCAL_CORONAL_SOURCE_ID,
  searchVerifiedCoronalLiterature,
  searchCoronalObservationCases,
  verifyCoronalDataPack,
} from '@open-scientist/tools'
import {
  PhenomenonInputSchema,
  ScientificHypothesisSchema,
  ScientificCorrectionSchema,
  type EvidenceRecord,
  type PhenomenonInput,
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
  findings: z.array(z.object({
    hypothesisId: z.string().min(1),
    assessment: z.enum(['supports_prediction', 'challenges_prediction', 'insufficient']),
    claim: z.string().min(1),
    observed: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).max(8).default([]),
    limitations: z.array(z.string().min(1)).max(5).default([]),
  })).max(8),
  corrections: z.array(z.object({
    severity: z.enum(['info', 'warning', 'error']),
    message: z.string().min(1),
    action: z.string().min(1),
    affectedIds: z.array(z.string().min(1)).max(8).default([]),
  })).max(6).default([]),
})

const ModelConclusionSchema = z.object({
  conclusion: z.string().min(1),
  reasoningSummary: z.string().min(1),
})

const ModelValidationPlanSchema = z.object({
  reasoningSummary: z.string().min(1),
  tasks: z.array(z.object({
    hypothesisId: z.string().min(1),
    executorId: z.enum([
      'coronal-timeseries-lag-v1',
      'coronal-background-variability-v1',
      'coronal-hot-channel-variability-v1',
      'external',
    ]),
    route: z.enum(['A', 'B']),
    type: z.enum(['observation', 'analysis', 'history-search', 'simulation', 'model-update', 'human-review']),
    objective: z.string().min(1),
    requiredSourceIds: z.array(z.string().min(1)).max(10).default([]),
    discriminatingOutcomes: z.array(z.string().min(1)).min(1).max(8),
  })).min(1).max(6),
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


function sourceIds(phenomenon: PhenomenonInput): string[] {
  return [...new Set(phenomenon.observations.map((item) => item.sourceId))]
}

function inferredActiveRegion(phenomenon: PhenomenonInput): string | undefined {
  if (phenomenon.activeRegion?.trim()) return phenomenon.activeRegion.trim()
  const match = `${phenomenon.title} ${phenomenon.description}`.match(/(?:NOAA|AR)\s*[-#:]?\s*(\d{4,5})/i)
  return match?.[1]
}

function phenomenonPrompt(phenomenon: PhenomenonInput): string {
  const observations = phenomenon.observations.length > 0
    ? phenomenon.observations.map((item) =>
      `${item.sourceId}（${item.kind}；${item.wavelengthOrBand ?? '波段未提供'}）`,
    ).join('；')
    : '当前没有绑定可执行来源，请先提出数据需求而不要假定观测结果'
  return [
    `科学现象：${phenomenon.title}`,
    phenomenon.description,
    `活动区：${phenomenon.activeRegion ?? '未提供'}`,
    `已登记观测：${observations}`,
    phenomenon.requestedQuestion ?? '',
  ].filter(Boolean).join('\n')
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
    trace.paperCount = papers.length
    for (const paper of papers) {
      const id = asRecord(paper)?.id
      if (typeof id === 'number' || typeof id === 'string') trace.sourceIds.add(`paper:${id}`)
    }
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
    if (cases.length > 0 && typeof output.sourceId === 'string') trace.sourceIds.add(output.sourceId)
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
    correctionId: `correction-a-rag-${digest({ message, round: context.round }).slice(0, 16)}`,
    stage: 'A',
    kind: severity === 'error' ? 'execution' : 'factual',
    severity,
    message,
    action,
    affectedIds: [],
    triggeredBy: ['A.generate', 'librarian'],
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
async function generateLocalGroundedHypotheses(
  input: DefaultScientificServicesInput,
  context: Readonly<HypothesisGenerationContext>,
): Promise<HypothesisGenerationResult> {
  const phenomenon = context.phenomenon
  const activeRegion = inferredActiveRegion(phenomenon)
  const narrative = `${phenomenon.title} ${phenomenon.description} ${phenomenon.requestedQuestion ?? ''}`
  const normalized = narrative.toLowerCase()
  const papers = await searchVerifiedCoronalLiterature(
    `coronal heating Alfvén wave nanoflare active region ${narrative}`,
    8,
  )
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
  const regionLabel = activeRegion ? `AR${activeRegion}` : '当前输入现象'
  const hasWaveCue = /(准周期|传播|波动|振荡|alfv|wave|periodic|oscillat)/i.test(normalized)
  const hasReconnectionCue = /(间歇|增亮|耀斑|重联|极性反转|中性线|94|131|nanoflare|brighten|reconnect|pil)/i.test(normalized)
  const hasTurbulenceCue = /(湍流|非热线宽|谱线增宽|turbulen|non.?thermal|line width)/i.test(normalized)
  const paperSources = (pattern: RegExp, limit = 3) => {
    const selectedIds = papers
      .filter((paper) => pattern.test(`${paper.title} ${paper.abstract ?? ''}`))
      .slice(0, limit)
      .map((paper) => `paper:${paper.id}`)
    return [...new Set([...selectedIds, ...localSourceIds])]
  }
  const candidates: Array<{
    key: string
    statement: string
    composition: Array<{ mechanism: string; role: 'dominant' | 'secondary' | 'coupled' | 'unknown' }>
    predictions: string[]
    falsification: string[]
    sources: string[]
  }> = []

  candidates.push({
    key: 'wave',
    statement: `${regionLabel} 中描述的${hasWaveCue ? '传播或准周期扰动' : '多波段演化'}可由波能沿磁结构传输并耗散解释；当前将其作为与脉冲加热并列的候选，而非既定结论。`,
    composition: [{ mechanism: '阿尔芬波传播、反射与耗散', role: hasWaveCue ? 'dominant' : 'unknown' }],
    predictions: [
      '在统一配准的 AIA 171 Å/193 Å 时序中，沿环结构的扰动应具有可重复的传播速度、相位差或功率峰。',
      '扰动功率或振幅随传播距离衰减，并与热响应时间变化保持稳定关系。',
    ],
    falsification: [
      '完成时间同步、去趋势和空间路径测量后，不存在稳定传播、相位关系或可重复频谱峰。',
    ],
    sources: paperSources(/MHD waves|Alfv[eé]n|non-thermal|coronal heating/i),
  })

  candidates.push({
    key: 'reconnection',
    statement: `${regionLabel} 中描述的${hasReconnectionCue ? '局部热通道增亮与磁场演化' : '热演化'}可由间歇性小尺度重联事件累积解释；需要用事件统计与磁场背景检验。`,
    composition: [{ mechanism: '磁重联与纳耀斑脉冲加热', role: hasReconnectionCue ? 'dominant' : 'unknown' }],
    predictions: [
      '94 Å/131 Å 热通道应出现空间局域、间歇且可重复的增强，并在较冷通道中形成有序时间延迟。',
      '事件位置或频率应与 HMI 磁通演化、强梯度区或极性反转线邻域存在统计关联。',
    ],
    falsification: [
      '完成事件检测、通道响应和磁图配准后，热通道增强既不呈间歇性，也不与磁结构演化相关。',
    ],
    sources: paperSources(/nanoflare|impulsive|Fe XIX|time-dependence/i),
  })

  if ((hasWaveCue && hasReconnectionCue) || hasTurbulenceCue) {
    candidates.push({
      key: 'coupled',
      statement: `${regionLabel} 的现象允许波动传输、湍流级联与间歇性重联耦合：波动负责输运和触发，局地耗散与重联共同形成热响应。`,
      composition: [
        { mechanism: '波动与湍流能量输运', role: 'coupled' },
        { mechanism: '间歇性磁重联', role: 'coupled' },
      ],
      predictions: [
        '传播扰动或频谱变化应在局部热通道增强之前出现，并与磁结构复杂度共同预测事件发生。',
        '按时间窗口分组后，波动指标与重联代理量对热响应的解释力应随活动区状态改变。',
      ],
      falsification: [
        '统一处理后，波动指标、磁场代理量和热响应之间不存在稳定的先后关系或联合增益。',
      ],
      sources: paperSources(/contemporary|Recent advances|Key aspects|coronal heating/i, 4),
    })
  }

  const hypotheses = candidates.map((candidate) => ScientificHypothesisSchema.parse({
    id: `h-local-${candidate.key}-${digest({ phenomenon: phenomenon.phenomenonId, candidate: candidate.key }).slice(0, 10)}`,
    statement: candidate.statement,
    mechanismComposition: candidate.composition,
    predictions: candidate.predictions,
    falsificationConditions: candidate.falsification,
    sourceIds: candidate.sources.length > 0 ? candidate.sources : allSources,
    scope: `基于 ${regionLabel} 的输入文本、本地核验文献和 ${selected?.label ?? '当前可用观测目录'}`,
    confidence: selected && pack.status === 'ready' ? 0.48 : 0.38,
    parentId: null,
    round: context.round,
    status: 'candidate',
  }))

  input.emitChunk?.({
    type: 'custom',
    kind: 'scientific.retrieval',
    stage: 'A',
    round: context.round,
    status: 'grounded',
    message: `本地资料模式完成：检索 ${papers.length} 篇核验文献，匹配 ${matches.cases.length} 个观测窗口；数据包核验 ${pack.verifiedAssetCount}/${pack.expectedAssetCount} 个文件。`,
    sourceCount: allSources.length,
    paperCount: papers.length,
    localCaseCount: matches.cases.length,
    tools: [
      { id: 'searchPapers', label: '本地核验文献', status: 'completed', resultCount: papers.length },
      { id: 'searchHypotheses', label: '历史候选查重', status: 'skipped', resultCount: 0 },
      { id: 'searchLocalSolarData', label: '本地观测检索', status: 'completed', resultCount: matches.cases.length },
      { id: 'checkLocalSolarCoverage', label: '数据覆盖核验', status: 'completed', resultCount: coverage.satisfied.length },
    ],
  } as never)
  input.emitChunk?.({
    type: 'custom',
    kind: 'scientific.reasoning-summary',
    stage: 'A',

    round: context.round,
    agentId: 'librarian',
    title: '本地资料形成候选的依据',
    summary: `根据输入中的波动、热通道和磁场线索选择 ${hypotheses.length} 个对照候选；引用仅来自本地核验文献语料和实际匹配的观测目录。`,
    hypothesisCount: hypotheses.length,
  } as never)
  return { hypotheses }
}


async function generateHypotheses(
  input: DefaultScientificServicesInput,
  context: Readonly<HypothesisGenerationContext>,
): Promise<HypothesisGenerationResult> {
  if (context.round > 1) return { hypotheses: [...context.existingHypotheses] }

  if (input.localGrounded) {
    return generateLocalGroundedHypotheses(input, context)
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
      stage: 'A',
      round: context.round,
      status,
      message,
      sourceCount: retrieval.sourceIds.size,
      paperCount: retrieval.paperCount,
      localCaseCount: retrieval.localCaseCount,
      tools: Object.entries(retrieval.tools).map(([id, state]) => ({
        id,
        label: RETRIEVAL_TOOL_LABELS[id as RetrievalToolName],
        status: state.failed ? 'failed' : state.completed ? 'completed' : state.called ? 'running' : 'skipped',
        resultCount: state.resultCount,
      })),
    } as never)
  }

  try {
    const pool = await librarianWorkflow({
      seed: phenomenonPrompt(context.phenomenon),
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
        stage: 'A',
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

    const retrievalMessage = retrievalStatus === 'grounded'
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
            '检查文献索引、本地数据目录和模型工具调用后重新运行 A 阶段。',
          ),
        ],
      }
    }

    const activeRegion = inferredActiveRegion(context.phenomenon) ?? '当前活动区'
    const converted = pool.hypotheses.flatMap((candidate, index) => {
      const declaredSourceIds = candidate.sourceIds.filter((sourceId) => sourceScope.includes(sourceId))
      const parsed = ScientificHypothesisSchema.safeParse({
        id: candidate.id || `h-librarian-${index + 1}-${digest(candidate).slice(0, 8)}`,
        statement: candidate.statement,
        mechanismComposition: candidate.mechanismComposition?.length
          ? candidate.mechanismComposition
          : [{ mechanism: candidate.mechanism, role: 'unknown' }],
        predictions: candidate.predictions,
        falsificationConditions: candidate.falsificationConditions,
        sourceIds: declaredSourceIds.length > 0 ? declaredSourceIds : sourceScope,
        scope: `仅针对 ${activeRegion} 的现象描述和本轮实际检索来源`,
        confidence: retrievalStatus === 'grounded' ? 0.5 : 0.35,
        parentId: candidate.parentId,
        round: context.round,
        status: 'candidate',
      })
      return parsed.success ? [parsed.data] : []
    })

    if (converted.length === 0) {
      return {
        hypotheses: [],
        corrections: [
          generationCorrection(
            context,
            'error',
            '模型未提交满足结构与来源约束的候选假设。',
            '调整现象描述或模型输出协议后重新运行 A 阶段。',
          ),
        ],
      }
    }

    return retrievalStatus === 'limited'
      ? {
          hypotheses: converted,
          corrections: [
            generationCorrection(
              context,
              'warning',
              '当前候选仅获得部分资料支撑；缺失的文献或观测不作推断。',
              '在进入机制判断前补齐缺失资料，并保持相关证据为 unknown。',
            ),
          ],
        }
      : { hypotheses: converted }
  } catch (error) {
    const message = safeGenerationFailure(error)
    emitRetrieval('blocked', message)
    input.emitChunk?.({
      type: 'custom',
      kind: 'scientific.self-correction',
      stage: 'A',
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
          '检查模型、HelixDB 和本地数据工具后重新运行 A 阶段。',
        ),
      ],
    }
  }
}
function readableUri(uri: string): Promise<boolean> {
  try {
    const path = uri.startsWith('file://')
      ? fileURLToPath(uri)
      : uri
    if (!/^[A-Za-z]:[\\/]|^[\\/]/.test(path)) return Promise.resolve(false)
    return stat(path).then(() => true).catch(() => false)
  } catch {
    return Promise.resolve(false)
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
    claim: `当前不能用已登记数据甄别“${hypothesis.statement}”。`,
    observed: '本轮只完成数据可用性或证据边界检查，尚未得到可重复的机制区分指标。',
    method: agentId,
    sourceIds: sourceIds(context.phenomenon),
    sampleIds: [],
    limitations: [limitation],
    round: context.round,
  }
}
export function localValidationExecutor(task: ValidationTask): string | null {
  if (
    task.type !== 'analysis'
    || !task.requiredSourceIds.includes(LOCAL_CORONAL_SOURCE_ID)
  ) return null
  const objective = task.objective
  // Reject compound tasks as soon as they require any unimplemented step.
  // The current processor does not perform WCS reprojection, manual loop
  // masks, DEM/spectral inversion, multiscale decomposition, event-duration
  // cataloguing, HMI-to-heating correlation, propagation/energy estimates or
  // simulations. A supported substring must never make the whole compound
  // task look executable.
  if (/(?:WCS|重投影|人工.*(?:掩膜|日冕环)|DEM|反演|小波|wavelet|EMD|多尺度|多周期|传播速度|能流|能量闭合|MHD|前向模型|事件持续时间|磁场演化率.*相关|事件频率.*相关)/i.test(objective)) {
    return null
  }
  if (task.executorId === 'external') return null
  const requestedExecutor = task.executorId
  // These are the only task families actually implemented by
  // analyze_coronal_window.py.  Do not treat DEM, wavelet/EMD, WCS,
  // propagation speed, energy closure or MHD requests as completed merely
  // because the generic FITS processor can run.
  if (/(?:171|193).*(?:\u65f6\u5ef6|\u76f8\u4f4d|\u4e92\u76f8\u5173)|(?:\u8de8\u901a\u9053).*(?:\u65f6\u5ef6|\u76f8\u5173)/i.test(objective)) {
    return !requestedExecutor || requestedExecutor === 'coronal-timeseries-lag-v1'
      ? 'coronal-timeseries-lag-v1'
      : null
  }
  if (/(?:\u76ee\u6807|\u6d3b\u52a8).*(?:\u80cc\u666f|\u5bf9\u7167).*(?:\u53d8\u5f02|\u6bd4)|(?:\u80cc\u666f|\u5bf9\u7167).*(?:\u70ed\u901a\u9053|94|131).*(?:\u53d8\u5f02|\u6bd4)/i.test(objective)) {
    return !requestedExecutor || requestedExecutor === 'coronal-background-variability-v1'
      ? 'coronal-background-variability-v1'
      : null
  }
  if (/(?:94|131|\u70ed\u901a\u9053).*(?:\u7a33\u5065\u5cf0|\u5cf0\u503c|\u76f8\u5bf9\u53d8\u5f02|\u95f4\u6b47\u6027)/i.test(objective)) {
    return !requestedExecutor || requestedExecutor === 'coronal-hot-channel-variability-v1'
      ? 'coronal-hot-channel-variability-v1'
      : null
  }
  return null
}

function hasRunnableLocalTask(context: Readonly<EvidenceAgentContext>): boolean {
  return context.validationTasks.some((task) => localValidationExecutor(task) !== null)
}

function localObservationCatalogAgent(): EvidenceAgent {
  return {
    id: 'looker-local-observation-catalog',
    label: 'Looker：本地观测目录审计',
    executionKind: 'deterministic',
    capabilities: ['source-audit', 'observation-analysis', 'timeseries-analysis', 'fact-check'],
    canRun: (context) => context.round === 1 || hasRunnableLocalTask(context),
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
          ? `已定位 ${coverage.case.label}；当前仅确认数据覆盖（可用：${satisfied}；未覆盖：${unavailable}）。尚未执行 WCS 对齐、标定、物理派生指标或光谱诊断，因此不能把覆盖情况升级为机制证据。`
          : '当前本地包未找到与该现象匹配的活动区窗口；不能将其他活动区的观测移作证据。'
        const corrections = [
          ...(pack.status === 'ready' ? [] : [{
            stage: 'B-data-integrity',
            severity: 'error' as const,
            message: '本地日冕观测包完整性未通过。',
            action: '停止使用该包并先修复缺失或尺寸不符的观测文件。',
            affectedIds: pack.missingAssetIds,
          }]),
          ...(coverage.unavailable.length > 0 ? [{
            stage: 'B-fact-correction',
            severity: 'warning' as const,
            message: `本轮没有覆盖：${unavailable}。`,
            action: '将这些诊断写入下一步验证计划，不把缺失诊断解释为支持或反驳。',
          }] : []),
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
          verifiedSourceIds: pack.status === 'ready' ? [LOCAL_CORONAL_SOURCE_ID] : [],
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
          corrections: [{
            stage: 'B-data-tool',
            severity: 'error',
            message: limitation,
            action: '保留 unknown，并在下一轮先修复本地数据工具或 manifest。',
          }],
        }
      }
    },
  }
}

type LocalProcessingLoader = (
  context: Readonly<EvidenceAgentContext>,
) => Promise<LocalProcessingResult | null>

function createLocalProcessingLoader(
  input: DefaultScientificServicesInput,
): LocalProcessingLoader {
  const cache = new Map<string, Promise<LocalProcessingResult | null>>()
  return async (context) => {
    if (context.round > 1 && context.validationTasks.length === 0) return null
    const activeRegion = inferredActiveRegion(context.phenomenon)
    const query = `${context.phenomenon.title} ${context.phenomenon.description}`
    const matches = await searchCoronalObservationCases({ activeRegion, query, limit: 1 })
    const selected = matches.cases[0]
    if (!selected) return null
    const task = context.validationTasks.find((item) => localValidationExecutor(item) !== null)
    const mode = context.round > 1 || task ? 'validation' as const : 'discovery' as const
    const key = `${context.round}:${selected.caseId}:${mode}`
    let pending = cache.get(key)
    if (!pending) {
      pending = runLocalCoronalProcessing({
        projectId: input.projectId,
        runId: input.runId,
        round: context.round,
        caseId: selected.caseId,
        ...(task ? { taskId: task.taskId } : {}),
        mode,
        signal: context.signal,
      })
      cache.set(key, pending)
    }
    return pending
  }
}

type ModelScheduler = <T>(work: () => Promise<T>) => Promise<T>

function createModelScheduler(): ModelScheduler {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>) => {
    const next = tail.then(work, work)
    tail = next.then(() => undefined, () => undefined)
    return next
  }
}

function hypothesisPromptRows(hypotheses: readonly ScientificHypothesis[]) {
  return hypotheses.map((hypothesis) => ({
    id: hypothesis.id,
    statement: hypothesis.statement,
    mechanisms: hypothesis.mechanismComposition,
    predictions: hypothesis.predictions,
    falsificationConditions: hypothesis.falsificationConditions,
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
      const assessment = finding.assessment === 'supports_prediction'
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
        claim: `${assessment}：${finding.claim}`,
        observed: finding.observed,
        method: 'model-assisted-bounded-review',
        sourceIds: [...new Set(finding.sourceIds.filter((sourceId) => allowedSources.has(sourceId)))],
        sampleIds: [],
        limitations: [...new Set([
          ...finding.limitations,
          '该记录是模型对已提供资料的有界解释；未绑定确定性处理溯源，不能升级为支持或反驳证据。',
        ])],
        round: context.round,
      }
    })
  return {
    evidence,
    notes: [review.summary],
    corrections: review.corrections.map((item) => ({
      stage: 'B-model-review',
      severity: item.severity,
      message: item.message,
      action: item.action,
      affectedIds: item.affectedIds,
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
  const modelConfig = input.services.agentConfigs?.[input.role]?.modelConfig ?? input.services.modelConfig
  const review = await input.schedule(() => runScientificModelTask({
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
- 必须核对“前序智能体记录”；若其结论越过数据、来源或处理边界，在 corrections 中指出冲突、受影响 ID 和具体修正动作。
- 不得输出隐藏思维链，只提交可核验的公开工作摘要。`,
    emitChunk: input.services.emitChunk,
    abortSignal: input.context.signal,
    maxOutputTokens: 3600,
    round: input.context.round,
  }))
  return mapModelReview(input.agentId, input.context, review, input.allowedSourceIds)
}

function modelLookerAgent(
  input: DefaultScientificServicesInput,
  schedule: ModelScheduler,
): EvidenceAgent {
  return {
    id: 'looker-model-observation-review',
    label: 'Looker：模型观测语境审阅',
    executionKind: 'model',
    capabilities: ['source-audit', 'observation-analysis', 'fact-check'],
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
        requirements: ['thermal-evolution', 'magnetic-context', 'wave-timescale', 'spectroscopy', 'simulation'],
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
观测目录事实：${conciseText(JSON.stringify({
          packStatus: pack.status,
          verifiedAssets: pack.verifiedAssetCount,
          expectedAssets: pack.expectedAssetCount,
          matchedCases: matches.cases,
          satisfiedDiagnostics: coverage.satisfied,
          unavailableDiagnostics: coverage.unavailable,
          limitations: coverage.limitations,
        }), 7000)}
前序智能体记录（确定性计算优先）：${conciseText(JSON.stringify(priorEvidencePromptRows(context.evidence)), 9000)}
允许来源 ID：${allowedSourceIds.join('、') || '无'}`,
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
    label: 'Explorer：模型诊断比较',
    executionKind: 'model',
    capabilities: ['literature-retrieval', 'timeseries-analysis', 'image-analysis', 'cross-validation'],
    run: async (context) => {
      const query = `${context.phenomenon.title} ${context.phenomenon.description}`
      const [processing, papers] = await Promise.all([
        load(context),
        searchVerifiedCoronalLiterature(`coronal heating ${query}`, 6),
      ])
      const paperSourceIds = papers.map((paper) => `paper:${paper.id}`)
      const allowedSourceIds = [...new Set([
        ...paperSourceIds,
        ...(processing ? [LOCAL_CORONAL_SOURCE_ID] : []),
      ])]
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
确定性处理事实：${conciseText(JSON.stringify(processing ? {
          processingRunId: processing.processingRunId,
          snapshotId: processing.snapshotId,
          target: processing.analysis.target,
          baseline: processing.analysis.baseline,
          diagnostics: processing.analysis.diagnostics,
          limitations: processing.analysis.limitations,
        } : { available: false }), 9000)}
已核验文献：${conciseText(JSON.stringify(papers.map((paper) => ({ id: `paper:${paper.id}`, title: paper.title, abstract: paper.abstract }))), 8000)}
前序智能体记录（用于复核而非复制）：${conciseText(JSON.stringify(priorEvidencePromptRows(context.evidence)), 10000)}
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
    label: 'Oracle：模型反例审阅',
    executionKind: 'model',
    capabilities: ['counterexample-search', 'cross-validation', 'fact-check'],
    run: async (context) => {
      const processing = await load(context)
      const allowedSourceIds = processing ? [LOCAL_CORONAL_SOURCE_ID] : []
      return runBoundedEvidenceReview({
        services: input,
        context,
        schedule,
        agentId: 'oracle-model-counterexample-review',
        role: 'oracle',
        allowedSourceIds,
        prompt: `请作为反例审阅者，寻找同一组处理指标是否也能被其他机制、背景活动或数据处理局限解释。只依据提供的指标，不得编造新样本。

现象：${phenomenonPrompt(context.phenomenon)}
候选假设：${conciseText(JSON.stringify(hypothesisPromptRows(context.hypotheses)), 7000)}
确定性处理事实：${conciseText(JSON.stringify(processing ? {
          processingRunId: processing.processingRunId,
          snapshotId: processing.snapshotId,
          diagnostics: processing.analysis.diagnostics,
          target: {
            caseId: processing.analysis.target.caseId,
            activeRegion: processing.analysis.target.activeRegion,
            usedObservationCount: processing.analysis.target.usedObservationCount,
          },
          baseline: processing.analysis.baseline ? {
            caseId: processing.analysis.baseline.caseId,
            activeRegion: processing.analysis.baseline.activeRegion,
            usedObservationCount: processing.analysis.baseline.usedObservationCount,
          } : null,
          limitations: processing.analysis.limitations,
        } : { available: false }), 9000)}
前序 Looker / Explorer 记录：${conciseText(JSON.stringify(priorEvidencePromptRows(context.evidence)), 12000)}
请显式检查前序记录之间是否矛盾、是否把相关性写成因果、是否把可执行建议误写成已完成结果；发现问题必须写入 corrections。
允许来源 ID：${allowedSourceIds.join('、') || '无'}`,
      })
    },
  }
}

function mechanismKey(hypothesis: ScientificHypothesis): keyof LocalCoronalAnalysis['diagnostics'] {
  const text = hypothesis.mechanismComposition.map((item) => item.mechanism).join(' ')
  const wave = /(波|alfv|湍流|mhd)/i.test(text)
  const reconnection = /(重联|纳耀斑|nanoflare|reconnect)/i.test(text)
  if (wave && reconnection) return 'coupled'
  return reconnection ? 'reconnection' : 'wave'
}

function diagnosticObserved(
  key: keyof LocalCoronalAnalysis['diagnostics'],
  diagnostic: ObservableDiagnostic,
): string {
  if (key === 'wave') {
    const periods = Array.isArray(diagnostic.periodsSeconds)
      ? diagnostic.periodsSeconds.map((value) => Number(value).toFixed(0)).join('、')
      : '未形成'
    const correlation = typeof diagnostic.crossChannelCorrelation === 'number'
      ? diagnostic.crossChannelCorrelation.toFixed(2)
      : '不可计算'
    return `171/193 Å 的候选主周期为 ${periods} 秒，跨通道相关系数 ${correlation}；这是积分强度时序指标，尚未测量传播速度和能流。`
  }
  if (key === 'reconnection') {
    const peaks = Number(diagnostic.hotChannelPeakCount ?? 0)
    const variability = typeof diagnostic.hotChannelRelativeVariability === 'number'
      ? diagnostic.hotChannelRelativeVariability.toFixed(3)
      : '不可计算'
    const ratio = typeof diagnostic.targetToBackgroundVariabilityRatio === 'number'
      ? diagnostic.targetToBackgroundVariabilityRatio.toFixed(2)
      : '无同区背景比值'
    return `94/131 Å 检出 ${peaks} 个稳健峰，热通道相对变异 ${variability}，目标/背景变异比 ${ratio}；磁场仅使用视向代理量。`
  }
  return diagnostic.jointIndicatorsPresent
    ? '波动时序指标和热通道/磁场代理指标在同一处理窗口内同时出现，但尚未建立因果先后和能量分配。'
    : '当前处理没有同时满足波动与间歇热响应的预设可观测条件。'
}

function localDiagnosticsAgent(input: DefaultScientificServicesInput, load: LocalProcessingLoader): EvidenceAgent {
  return {
    id: 'explorer-coronal-diagnostics',
    label: 'Explorer：FITS 可观测量分析',
    executionKind: 'deterministic',
    capabilities: ['observation-analysis', 'timeseries-analysis', 'image-analysis'],
    canRun: (context) => context.round === 1 || hasRunnableLocalTask(context),
    run: async (context) => {
      const processing = await load(context)
      if (!processing) {
        return {
          limitations: ['没有匹配到可执行的本地活动区窗口，未创建处理运行。'],
        }
      }
      const evidence: EvidenceRecord[] = context.hypotheses.map((hypothesis) => {
        const key = mechanismKey(hypothesis)
        const diagnostic = processing.analysis.diagnostics[key]
        const task = context.validationTasks.find((item) => {
          if (localValidationExecutor(item) === null) return false
          if (item.triggeredBy === hypothesis.id) return true
          return context.evidence.some((evidence) =>
            evidence.evidenceId === item.triggeredBy
            && evidence.hypothesisId === hypothesis.id)
        })
        return {
          evidenceId: `e-diagnostic-${digest({
            hypothesisId: hypothesis.id,
            processingRunId: processing.processingRunId,
          }).slice(0, 16)}`,
          hypothesisId: hypothesis.id,
          ...(task ? { taskId: task.taskId } : {}),
          agentId: 'explorer-coronal-diagnostics',
          status: diagnostic.observableStatus,
          claim: diagnostic.observableStatus === 'support'
            ? `确定性 FITS 处理支持“${hypothesis.statement}”的一项非唯一可观测预测。`
            : `确定性 FITS 处理尚未形成足以支持或反驳“${hypothesis.statement}”的可重复指标。`,
          observed: diagnosticObserved(key, diagnostic),
          method: 'astropy-fits + robust-roi-timeseries + scipy-periodogram-and-peak-analysis',
          sourceIds: [LOCAL_CORONAL_SOURCE_ID],
          sampleIds: processing.analysis.target.sampleIds,
          provenance: processing.provenance,
          metrics: diagnostic,
          uncertainty: '自动 ROI、像素坐标近似配准和非唯一代理指标构成主要不确定度。',
          limitations: [diagnostic.boundary, ...processing.analysis.limitations],
          round: context.round,
        }
      })
      const completedTasks = context.validationTasks.flatMap((task) => {
        if (localValidationExecutor(task) === null) return []
        const related = evidence.filter((item) => item.taskId === task.taskId)
        if (related.length === 0) return []
        return {
          ...task,
          status: 'completed' as const,
          resultEvidenceIds: related.map((item) => item.evidenceId),
        }
      })
      input.emitChunk?.({
        type: 'custom',
        kind: 'scientific.processing-result',
        stage: 'B',
        round: context.round,
        processingRunId: processing.processingRunId,
        snapshotId: processing.snapshotId,
        caseId: processing.analysis.target.caseId,
        caseLabel: processing.analysis.target.label,
        mode: processing.analysis.mode,
        usedObservationCount: processing.analysis.target.usedObservationCount,
        baselineCaseLabel: processing.analysis.baseline?.label ?? null,
        diagnostics: processing.analysis.diagnostics,
        metricsArtifactId: processing.metricsArtifactId,
        figureArtifactId: processing.figureArtifactId,
        figureUrl: `/api/projects/${encodeURIComponent(input.projectId)}/artifacts/${processing.figureArtifactId}/content`,
        limitations: processing.analysis.limitations,
      } as never)
      return {
        evidence,
        validationTasks: completedTasks,
        verifiedSourceIds: [LOCAL_CORONAL_SOURCE_ID],
        limitations: processing.analysis.limitations,
        corrections: processing.analysis.target.readFailures.length > 0
          ? [{
              stage: 'B-data-quality',
              severity: 'warning',
              message: `有 ${processing.analysis.target.readFailures.length} 个抽样 FITS 读取或校验异常。`,
              action: '异常文件未进入指标计算；复核处理产物中的 readFailures 后再扩大样本。',
            }]
          : [],
      }
    },
  }
}

function localCounterexampleAgent(load: LocalProcessingLoader): EvidenceAgent {
  return {
    id: 'oracle-local-counterexample',
    label: 'Oracle：同活动区背景对照',
    executionKind: 'deterministic',
    capabilities: ['counterexample-search', 'cross-validation', 'fact-check'],
    canRun: (context) => context.round === 1 || hasRunnableLocalTask(context),
    run: async (context) => {
      const processing = await load(context)
      if (!processing?.analysis.baseline) {
        return {
          notes: ['当前活动区没有独立背景窗口，未把其他活动区误作反例。'],
          limitations: ['缺少同活动区背景对照。'],
        }
      }
      const baseline = processing.analysis.baseline
      const ratio = processing.analysis.diagnostics.reconnection.targetToBackgroundVariabilityRatio
      const hasComparableBackground = typeof ratio === 'number' && ratio <= 1.2
      const evidence: EvidenceRecord[] = context.hypotheses.map((hypothesis) => {
        const key = mechanismKey(hypothesis)
        const contradictsSpecificity = key !== 'wave' && hasComparableBackground
        return {
          evidenceId: `e-counterexample-${digest({
            hypothesisId: hypothesis.id,
            processingRunId: processing.processingRunId,
          }).slice(0, 16)}`,
          hypothesisId: hypothesis.id,
          agentId: 'oracle-local-counterexample',
          status: contradictsSpecificity ? 'contradict' as const : 'unknown' as const,
          claim: contradictsSpecificity
            ? '同活动区背景窗口出现相近热通道变异，削弱该指标对当前机制的特异性。'
            : '同活动区背景对照尚未构成可复核反例。',
          observed: typeof ratio === 'number'
            ? `目标窗口与背景窗口的热通道变异比为 ${ratio.toFixed(2)}。`
            : '目标窗口和背景窗口不能形成稳定的热通道变异比值。',
          method: 'same-active-region background-window comparison',
          sourceIds: [LOCAL_CORONAL_SOURCE_ID],
          sampleIds: baseline.sampleIds,
          provenance: processing.provenance,
          metrics: { targetToBackgroundVariabilityRatio: ratio ?? null },
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
    label: 'Oracle：处理溯源复核',
    executionKind: 'deterministic',
    capabilities: ['fact-check'],
    canRun: (context) => context.round === 1 || hasRunnableLocalTask(context),
    run: async (context) => {
      const processing = await load(context)
      if (!processing) return { limitations: ['没有处理运行可供溯源复核。'] }
      const failures = [
        ...processing.analysis.target.readFailures,
        ...(processing.analysis.baseline?.readFailures ?? []),
      ]
      return {
        notes: [
          `已登记快照 ${processing.snapshotId}、处理运行 ${processing.processingRunId} 和两个带校验和的产物。`,
        ],
        limitations: failures.length > 0 ? [`处理过程中记录 ${failures.length} 个文件级异常。`] : [],
        corrections: failures.length > 0
          ? [{
              stage: 'B-provenance',
              severity: 'warning',
              message: '部分 FITS 文件未通过读取或抽样 SHA-256 核验。',
              action: '保持受影响指标为待验证，并在扩大数据前重新获取异常文件。',
            }]
          : [],
      }
    },
  }
}


function sourceAuditAgent(): EvidenceAgent {
  return {
    id: 'looker-source-audit',
    label: 'Looker：数据来源审计',
    capabilities: ['source-audit', 'fact-check'],
    run: async (context) => {
      const unavailable = []
      for (const observation of context.phenomenon.observations) {
        if (!(await readableUri(observation.uri))) unavailable.push(observation.sourceId)
      }
      const limitation = unavailable.length > 0
        ? `以下来源当前不可直接读取：${unavailable.join('、')}`
        : '当前只登记了来源引用，尚未执行多波段对齐或数值模拟处理。'
      return {
        evidence: context.hypotheses.map((hypothesis) =>
          unknownEvidence('looker-source-audit', context, hypothesis, limitation),
        ),
        limitations: [limitation],
      }
    },
  }
}

function historySearchAgent(): EvidenceAgent {
  return {
    id: 'explorer-history-search',
    label: 'Explorer：历史资料与数据查找',
    capabilities: ['history-search', 'literature-retrieval'],
    run: async (context) => ({
      notes: ['历史资料查找只用于形成数据需求；未登记可复核结果前不生成支持或反驳证据。'],
      limitations: ['历史文献和数据适配器尚未在本运行中返回可复核处理产物。'],
    }),
  }
}

function observationAnalysisAgent(): EvidenceAgent {
  return {
    id: 'explorer-observation-analysis',
    label: 'Explorer：多波段观测分析',
    capabilities: ['observation-analysis', 'timeseries-analysis', 'image-analysis'],
    canRun: async (context) => context.phenomenon.observations.some(
      (item) => /^[A-Za-z]:[\\/]|^[\\/]|^file:\/\//.test(item.uri),
    ),
    run: async (context) => ({
      evidence: context.hypotheses.map((hypothesis) => unknownEvidence(
        'explorer-observation-analysis',
        context,
        hypothesis,
        '观测处理适配器尚未登记快照、处理运行和确定性产物。',
      )),
      limitations: ['存在来源引用，但本轮没有把引用自动解释成观测结论。'],
    }),
  }
}

function counterexampleAgent(): EvidenceAgent {
  return {
    id: 'oracle-counterexample-search',
    label: 'Oracle：反例与事实核验',
    capabilities: ['counterexample-search', 'cross-validation', 'fact-check'],
    run: async (context) => ({
      evidence: context.hypotheses.map((hypothesis) => unknownEvidence(
        'oracle-counterexample-search',
        context,
        hypothesis,
        '尚未登记绑定样本 ID 的可复核反例，不能把数据缺口当作反驳。',
      )),
      notes: ['反例检索保留 unknown，等待样本级证据和数据处理溯源。'],
    }),
  }
}

function factCheckAgent(): EvidenceAgent {
  return {
    id: 'oracle-fact-check',
    label: 'Oracle：事实性校正',
    capabilities: ['fact-check'],
    run: async () => ({
      limitations: ['事实核验仅检查当前 State 中的结构和边界，不替代数据处理或人工文献核对。'],
    }),
  }
}

async function synthesizeModelConclusion(
  input: DefaultScientificServicesInput,
  context: Readonly<SynthesisContext>,
  schedule: ModelScheduler,
): Promise<string> {
  const modelConfig = input.agentConfigs?.sisyphus?.modelConfig ?? input.modelConfig
  const result = await schedule(() => runScientificModelTask({
    projectId: input.projectId,
    runId: input.runId,
    agentId: 'sisyphus-scientific-synthesis',
    role: 'sisyphus',
    modelConfig,
    schema: ModelConclusionSchema,
    prompt: `请根据当前 LangGraph State 形成一段有边界的日冕加热机制比较结论。

现象：${phenomenonPrompt(context.phenomenon)}
候选假设：${conciseText(JSON.stringify(hypothesisPromptRows(context.hypotheses)), 8000)}
证据记录：${conciseText(JSON.stringify(context.evidence.map((item) => ({
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
    }))), 14000)}

规则：
- 只有 status=support/contradict 且带确定性 provenance 的记录可作为机制证据；unknown 只能说明一致性、歧义或缺口。
- 不得宣称已证明因果、主导占比或普遍规律。
- conclusion 给出当前窗口内最有依据的比较结论；reasoningSummary 说明依据了哪些记录以及为何控制结论强度。`,
    emitChunk: input.emitChunk,
    abortSignal: context.signal,
    maxOutputTokens: 2400,
    round: context.round,
  }))
  input.emitChunk?.({
    type: 'custom',
    kind: 'scientific.reasoning-summary',
    stage: 'C',
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
  const result = await schedule(() => runScientificModelTask({
    projectId: input.projectId,
    runId: input.runId,
    agentId: 'prometheus-scientific-planner',
    role: 'prometheus',
    modelConfig,
    schema: ModelValidationPlanSchema,
    prompt: `请把当前结论中的关键不确定性转成少量、可执行、能区分候选机制的下一步验证任务。

现象：${phenomenonPrompt(context.phenomenon)}
当前结论：${context.conclusion}
候选假设：${conciseText(JSON.stringify(hypothesisPromptRows(context.hypotheses)), 8000)}
证据与缺口：${conciseText(JSON.stringify(context.evidence.map((item) => ({
      evidenceId: item.evidenceId,
      hypothesisId: item.hypothesisId,
      status: item.status,
      claim: item.claim,
      limitations: item.limitations,
      sourceIds: item.sourceIds,
    }))), 12000)}

规则：
- 每项任务必须绑定现有 hypothesisId，并说明支持与反驳会分别看到什么。
- 优先复用本地来源 ${LOCAL_CORONAL_SOURCE_ID}；确需新增数据时，用 future: 开头的清晰来源需求。
- executorId 必须显式选择：
  - coronal-timeseries-lag-v1 只支持现有 ROI 上的 171/193 跨通道时延、互相关和单一候选主周期；
  - coronal-background-variability-v1 只支持目标/同活动区背景的热通道相对变异比较；
  - coronal-hot-channel-variability-v1 只支持 94/131 稳健峰值数和相对变异度；
  - 任何包含 WCS、人工掩膜、DEM、事件目录、磁场相关、多尺度/多周期分解、传播速度、能量闭合或 MHD 的任务必须选择 external。
  选择前三个本地 executor 时，route 必须为 B、type 必须为 analysis、requiredSourceIds 必须包含 ${LOCAL_CORONAL_SOURCE_ID}；external 才可按缺口选择其他 route/type。
  不得把多个执行器能力或 external 步骤混入一个本地执行任务；应拆分任务。
- 不得把“再让模型思考”本身当作验证；model-update 只能在已有标注或处理产物可用于训练时使用。
- reasoningSummary 说明任务排序和预算取舍。`,
    emitChunk: input.emitChunk,
    abortSignal: context.signal,
    maxOutputTokens: 2800,
    round: context.round,
  }))

  const hypothesisIds = new Set(context.hypotheses.map((item) => item.id))
  const tasks = result.tasks
    .filter((task) => hypothesisIds.has(task.hypothesisId))
    .map((task) => {
      const relatedEvidence = [...context.evidence].reverse().find((item) => item.hypothesisId === task.hypothesisId)
      const locallyRegistered = task.executorId !== 'external'
      // An explicit local executor is the source of truth for routing. Models
      // may describe the scientific action as an "observation", but the
      // runtime action is a deterministic B-stage analysis over an already
      // registered local source.
      const route = locallyRegistered ? 'B' as const : task.route
      const type = locallyRegistered ? 'analysis' as const : task.type
      const requiredSourceIds = locallyRegistered
        ? [...new Set([...task.requiredSourceIds, LOCAL_CORONAL_SOURCE_ID])]
        : task.requiredSourceIds
      const fingerprint = digest({
        hypothesisId: task.hypothesisId,
        executorId: task.executorId,
        route,
        type,
        objective: task.objective,
        requiredSourceIds,
        discriminatingOutcomes: task.discriminatingOutcomes,
      })
      return {
        taskId: `task-model-${fingerprint.slice(0, 12)}`,
        executorId: task.executorId,
        route,
        type,
        objective: task.objective,
        requiredSourceIds,
        discriminatingOutcomes: task.discriminatingOutcomes,
        triggeredBy: relatedEvidence?.evidenceId ?? task.hypothesisId,
        status: 'planned' as const,
        resultEvidenceIds: [],
        round: context.round,
        fingerprint,
      }
    })
  input.emitChunk?.({
    type: 'custom',
    kind: 'scientific.reasoning-summary',
    stage: 'D',
    round: context.round,
    agentId: 'prometheus-scientific-planner',
    title: '模型验证计划依据',
    summary: result.reasoningSummary,
  } as never)
  return tasks
}

function buildTasks(
  context: Readonly<PlanningContext>,
  localGrounded = false,
): ValidationTask[] {
  if (localGrounded && context.round > 1) {
    const relatedEvidence = (hypothesisId: string) =>
      [...context.evidence].reverse().find((item) => item.hypothesisId === hypothesisId)?.evidenceId
      ?? 'round-' + context.round + '-followup'
    return context.hypotheses.map((hypothesis) => {
      const key = mechanismKey(hypothesis)
      const type: ValidationTask['type'] = key === 'coupled' ? 'simulation' : 'observation'
      const objective = key === 'wave'
        ? '补充至少覆盖多个候选周期的高时间分辨率 171/193 Å 环路径时序，并结合传播速度、相位差和能流估计检验“' + hypothesis.statement + '”'
        : key === 'reconnection'
          ? '补充完整 WCS 配准、矢量磁场和热通道事件统计，检验增亮与磁拓扑演化是否稳定对应；针对“' + hypothesis.statement + '”'
          : '增加与观测窗口对应的 MHD 前向模拟和消融比较，检验波动输运与重联代理量是否产生联合增益；针对“' + hypothesis.statement + '”'
      const requiredSourceIds = key === 'wave'
        ? ['future:aia-long-cadence', 'future:loop-path-kinematics']
        : key === 'reconnection'
          ? ['future:aia-wcs-series', 'future:hmi-vector-field']
          : ['future:mhd-forward-model', 'future:matched-observation-window']
      const fingerprint = digest({
        hypothesis: hypothesis.id,
        objective,
        requiredSourceIds,
        kind: 'external-followup',
      })
      return {
        taskId: 'task-followup-' + fingerprint.slice(0, 12),
        route: 'B' as const,
        type,
        objective,
        requiredSourceIds,
        discriminatingOutcomes: [...hypothesis.predictions, ...hypothesis.falsificationConditions],
        triggeredBy: relatedEvidence(hypothesis.id),
        status: 'planned' as const,
        resultEvidenceIds: [],
        round: context.round,
        fingerprint,
      }
    })
  }
  const sources = [...new Set([
    ...sourceIds(context.phenomenon),
    ...context.hypotheses.flatMap((hypothesis) => hypothesis.sourceIds),
  ])]
  const type: ValidationTask['type'] = sources.length > 0 ? 'analysis' : 'history-search'
  return context.hypotheses.map((hypothesis) => {
    const related = context.evidence.find((item) => item.hypothesisId === hypothesis.id)
    const key = mechanismKey(hypothesis)
    const diagnostic = key === 'wave'
      ? '复测 AIA 171/193 Å 时序的主周期、跨通道相关和稳定性，并明确不能替代传播速度与能流测量'
      : key === 'reconnection'
        ? '复测 AIA 94/131 Å 间歇峰、目标/背景变异比和 HMI 视向磁场代理量'
        : '在同一窗口联合复测波动、热通道与磁场代理量，检查联合指标是否稳定出现'
    const objective = sources.length > 0
      ? `${diagnostic}；对应候选：“${hypothesis.statement}”`
      : `根据现象查找可用的多波段观测和数值模拟资料，再检查“${hypothesis.statement}”的可观测预测`
    const fingerprint = digest({ hypothesis: hypothesis.id, objective, sources })
    return {
      taskId: `task-${fingerprint.slice(0, 12)}`,
      route: 'B' as const,
      type,
      objective,
      requiredSourceIds: sources,
      discriminatingOutcomes: [...hypothesis.predictions, ...hypothesis.falsificationConditions],
      triggeredBy: related?.evidenceId ?? `round-${context.round}-unknown`,
      status: 'planned' as const,
      resultEvidenceIds: [],
      round: context.round,
      fingerprint,
    }
  })
}

function synthesizeLocalConclusion(context: {
  hypotheses: readonly ScientificHypothesis[]
  evidence: readonly EvidenceRecord[]
}): string {
  const rows = context.hypotheses.map((hypothesis) => {
    const related = context.evidence.filter((item) => item.hypothesisId === hypothesis.id)
    const support = related.filter((item) => item.status === 'support').length
    const contradict = related.filter((item) => item.status === 'contradict').length
    const key = mechanismKey(hypothesis)
    const label = key === 'wave' ? '波动耗散' : key === 'reconnection' ? '间歇性重联' : '耦合机制'
    const assessment = support > 0 && contradict === 0
      ? '出现支持其部分可观测预测的指标'
      : contradict > 0
        ? '存在削弱诊断特异性的背景反例'
        : '现有指标仍不足以区分'
    return `${label}：${assessment}`
  })
  const processingEvidence = context.evidence.filter((item) => item.provenance).length
  return [
    `本轮基于 ${processingEvidence} 条绑定确定性处理产物的证据完成比较。`,
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
        ]
      : [
          localObservationCatalogAgent(),
          localDiagnosticsAgent(input, localProcessing),
          localCounterexampleAgent(localProcessing),
          localProcessingFactCheckAgent(localProcessing),
          modelLookerAgent(input, scheduleModel),
          modelExplorerAgent(input, localProcessing, scheduleModel),
          modelOracleAgent(input, localProcessing, scheduleModel),
        ],
    planValidation: (context) => input.localGrounded
      ? buildTasks(context, true)
      : planModelValidation(input, context, scheduleModel),
    canExecuteValidationTask: (task) => localValidationExecutor(task) !== null,
    synthesizeConclusion: (context) => input.localGrounded
      ? synthesizeLocalConclusion(context)
      : synthesizeModelConclusion(input, context, scheduleModel),
    verifyProvenance: async (evidence: EvidenceRecord) =>
      verifyLocalEvidenceProvenance(input.projectId, evidence),
  }
}

export function parsePhenomenon(input: PhenomenonInput): PhenomenonInput {
  return PhenomenonInputSchema.parse(input)
}

export function datasetDirectory(): string {
  return getDatasetDir()
}
