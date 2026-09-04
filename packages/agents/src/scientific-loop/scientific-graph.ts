import { createHash } from 'node:crypto'
import { END, START, StateGraph } from '@langchain/langgraph'
import {
  AgentExecutionSchema,
  EvidenceRecordSchema,
  HypothesisCoverageAuditSchema,
  HypothesisVerificationReportSchema,
  ScientificCorrectionSchema,
  ScientificHumanGateRecordSchema,
  ScientificHypothesisSchema,
  ScientificLoopResultSchema,
  ScientificSteeringRecordSchema,
  ValidationTaskSchema,
  scientificFalsificationConditionId,
  scientificPredictionId,
  type AgentExecution,
  type EvidenceRecord,
  type HypothesisCoverageAudit,
  type HypothesisVerificationReport,
  type ScientificCorrection,
  type ScientificHypothesis,
  type ScientificHumanGateRecord,
  type ScientificLoopResult,
  type ScientificSteeringRecord,
  type ValidationTask,
} from '@open-scientist/schema'
import type { HypothesisClosureReport } from '@open-scientist/schema'
import type { UIMessageChunk } from 'ai'
import {
  createInMemoryScientificRuntime,
  type ScientificGraphRuntime,
} from '../orchestration/langgraph-runtime.ts'
import { buildScientificContext } from './context-builder.ts'
import {
  assessScientificClosure,
  buildOutcomeProfile,
  inferValidationReadiness,
  normalizeValidationReadiness,
  summarizeDataReadiness,
  withPreregisteredDetectability,
} from './closure-gate.ts'
import {
  EXECUTOR_CAPABILITIES,
  executorSupportsPrediction,
  predictionRequiredFamilies,
} from './executor-capabilities.ts'
import {
  auditIndependenceConsistency,
  assessEliminationGate,
  assessSupportGate,
  type EliminationGateAssessment,
  type SupportGateAssessment,
} from './evidence-gate.ts'
import { runLangGraphEvidenceWorkgroup } from './evidence-subgraph.ts'
import type {
  EvidenceAgentCorrection,
  EvidenceAgentExecution,
  EvidenceAgentStateEvent,
  EvidenceWorkgroupResult,
} from './evidence-workgroup.ts'
import { promoteEvidence } from './evidence-promotion.ts'
import { canonicalValidationSourceId } from './validation-source.ts'
import {
  decideNextRoute,
  deduplicateValidationTasks,
  shouldContinueScientificLoop,
  summarizeEvidence,
} from './loop-logic.ts'
import { ScientificGraphStateSchema, type ScientificGraphState } from './graph-state.ts'
import type { ScientificGraphDependencies, ScientificGraphInput } from './services.ts'

export type { ScientificGraphDependencies, ScientificGraphInput }

const DEFAULT_MAX_ROUNDS = 3

export interface ScientificGraphResult extends ScientificLoopResult {
  corrections: ScientificCorrection[]
  limitations: string[]
  agentExecutions: AgentExecution[]
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Scientific loop aborted')
}

function emit(
  input: ScientificGraphInput,
  kind: string,
  payload: Record<string, unknown> = {},
): void {
  input.emitChunk?.({ type: 'custom', kind, ...payload } as UIMessageChunk)
}

function emitNode(
  input: ScientificGraphInput,
  node: string,
  state: 'running' | 'completed',
  round: number,
): void {
  emit(input, 'scientific.node-state', { node, state, round })
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function fallbackHypothesisCoverage(
  hypotheses: readonly ScientificHypothesis[],
): HypothesisCoverageAudit {
  const representedMechanismFamilies = uniqueStrings(
    hypotheses.flatMap((hypothesis) =>
      hypothesis.mechanismComposition.map((component) => component.mechanism),
    ),
  )
  return HypothesisCoverageAuditSchema.parse({
    mode: 'open_world',
    exhaustiveClaim: false,
    fixedMechanismCount: false,
    candidateCount: hypotheses.length,
    retrievalSourceCount: uniqueStrings(hypotheses.flatMap((item) => item.sourceIds)).length,
    retrievedMechanismFamilies: representedMechanismFamilies,
    representedMechanismFamilies,
    unrepresentedMechanismFamilies: [],
    residualAlternativeAllowed: true,
    limitations: [
      '生成服务未返回独立的文献机制覆盖表；当前只审计已生成候选，不能声称穷尽所有物理解释。',
    ],
  })
}

function correctionProblemKey(item: ScientificCorrection): string {
  const normalizedMessage = item.message.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
  const affectedIds = [...item.affectedIds].sort().join(',')
  return `${item.kind}|${item.evidenceAction}|${affectedIds}|${normalizedMessage}`
}

function correctionSemanticKey(item: ScientificCorrection): string {
  // Preserve a genuine severity escalation while collapsing the same finding
  // re-observed in another stage or round.
  return `${correctionProblemKey(item)}|${item.severity}`
}

function mergeWorkgroupResults(
  results: readonly EvidenceWorkgroupResult[],
): EvidenceWorkgroupResult {
  return {
    executions: results.flatMap((item) => item.executions),
    evidence: results.flatMap((item) => item.evidence),
    validationTasks: results.flatMap((item) => item.validationTasks),
    verifiedSourceIds: uniqueStrings(results.flatMap((item) => item.verifiedSourceIds)),
    limitations: results.flatMap((item) => item.limitations),
    notes: results.flatMap((item) => item.notes),
    corrections: results.flatMap((item) => item.corrections),
  }
}

function compactSummary(values: readonly string[], maximum = 1200): string {
  const text = values
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('；')
  return text.length <= maximum ? text : `${text.slice(0, maximum)}…`
}

function correction(
  stage: ScientificCorrection['stage'],
  kind: ScientificCorrection['kind'],
  severity: ScientificCorrection['severity'],
  message: string,
  action: string,
  round: number,
  triggeredBy: readonly string[],
  affectedIds: readonly string[] = [],
  agentId?: string,
  evidenceAction: ScientificCorrection['evidenceAction'] = 'none',
): ScientificCorrection {
  const triggerIds = uniqueStrings(triggeredBy.length > 0 ? triggeredBy : ['round-' + round])
  return ScientificCorrectionSchema.parse({
    correctionId:
      'correction-' +
      digest({
        stage,
        kind,
        severity,
        message,
        action,
        round,
        triggerIds,
        affectedIds,
        agentId,
        evidenceAction,
      }).slice(0, 16),
    stage,
    kind,
    severity,
    message,
    action,
    evidenceAction,
    affectedIds: uniqueStrings(affectedIds),
    triggeredBy: triggerIds,
    round,
    ...(agentId ? { agentId } : {}),
  })
}

function appendCorrections(
  input: ScientificGraphInput,
  current: readonly ScientificCorrection[],
  incoming: readonly ScientificCorrection[],
): ScientificCorrection[] {
  const result = [...current]
  const seen = new Set(result.map((item) => item.correctionId))
  // P1-8 semantic dedup: the same finding restated by another stage pass is
  // one problem, not several — identical (kind, message) is skipped (stage is
  // just where it was re-observed) so corrections counts reflect unique
  // problems, not repeat visits.
  const semanticKeys = new Set(result.map(correctionSemanticKey))
  for (const raw of incoming) {
    const item = ScientificCorrectionSchema.parse({
      ...raw,
      correctionId:
        'correction-' +
        digest({
          runId: input.runId,
          correctionId: raw.correctionId,
        }).slice(0, 16),
    })
    if (seen.has(item.correctionId)) continue
    const semanticKey = correctionSemanticKey(item)
    if (semanticKeys.has(semanticKey)) continue
    seen.add(item.correctionId)
    semanticKeys.add(semanticKey)
    result.push(item)
    emit(input, 'scientific.self-correction', { correction: item })
  }
  return result
}

function appendLimitations(current: readonly string[], incoming: readonly string[]): string[] {
  return uniqueStrings([...current, ...incoming].filter((item) => item.length > 0))
}

function upsertById<T extends { [key: string]: unknown }>(
  current: readonly T[],
  incoming: readonly T[],
  key: keyof T,
): T[] {
  const result = [...current]
  const positions = new Map(result.map((item, index) => [String(item[key]), index]))
  for (const item of incoming) {
    const id = String(item[key])
    const position = positions.get(id)
    if (position === undefined) {
      positions.set(id, result.length)
      result.push(item)
    } else {
      result[position] = item
    }
  }
  return result
}

function validationTaskDeduplicationKey(task: ValidationTask): string {
  if (task.type === 'human-review') return task.fingerprint
  if (!task.executorId || task.executorId === 'external') {
    return digest({
      executorId: task.executorId ?? 'unowned',
      route: task.route,
      type: task.type,
      hypothesisIds: [...task.hypothesisIds].sort(),
      predictionIds: [...task.predictionIds].sort(),
      falsificationConditionIds: [...task.falsificationConditionIds].sort(),
      requiredSourceIds: task.requiredSourceIds.map(canonicalValidationSourceId).sort(),
    })
  }
  return digest({
    executorId: task.executorId,
    route: task.route,
    type: task.type,
    hypothesisIds: [...task.hypothesisIds].sort(),
    predictionIds: [...task.predictionIds].sort(),
    falsificationConditionIds: [...task.falsificationConditionIds].sort(),
    requiredSourceIds: [...task.requiredSourceIds].sort(),
  })
}

/**
 * Semantic key for external/planned tasks that request the same canonical
 * future data need. Different model spellings of one requirement (e.g.
 * `future:iris-spectroscopy-AR11158` vs `future:IRIS-EIS-spectroscopy-ar11158`)
 * collapse onto one key so they can be merged instead of duplicated.
 */
export function externalTaskSemanticKey(task: ValidationTask): string | null {
  if (task.executorId && task.executorId !== 'external') return null
  const futureSources = task.requiredSourceIds
    .filter((sourceId) => sourceId.startsWith('future:'))
    .map(canonicalValidationSourceId)
    .sort()
  if (futureSources.length === 0) return null
  return digest({ route: task.route, type: task.type, futureSources })
}

/** Union requirement coverage into the kept task instead of dropping either. */
export function mergeValidationTaskRequirements(
  existing: ValidationTask,
  incoming: ValidationTask,
): ValidationTask {
  const unionIds = (a: readonly string[], b: readonly string[], canonicalize = false) => [
    ...new Set([...a, ...b].map((id) => (canonicalize ? canonicalValidationSourceId(id) : id))),
  ]
  const hypothesisIds = unionIds(existing.hypothesisIds, incoming.hypothesisIds)
  const predictionIds = unionIds(existing.predictionIds, incoming.predictionIds)
  const falsificationConditionIds = unionIds(
    existing.falsificationConditionIds,
    incoming.falsificationConditionIds,
  )
  const requiredSourceIds = unionIds(existing.requiredSourceIds, incoming.requiredSourceIds, true)
  return {
    ...existing,
    hypothesisIds,
    predictionIds,
    falsificationConditionIds,
    requiredSourceIds,
    fingerprint: digest({
      executorId: existing.executorId,
      route: existing.route,
      type: existing.type,
      hypothesisIds: [...hypothesisIds].sort(),
      predictionIds: [...predictionIds].sort(),
      requiredSourceIds: [...requiredSourceIds].sort(),
    }),
  }
}

function mapAgentCorrection(
  raw: EvidenceAgentCorrection,
  round: number,
  agentId: string,
): ScientificCorrection {
  const lower = raw.stage.toLowerCase() + raw.message.toLowerCase()
  const structuredStages = new Set<ScientificCorrection['stage']>([
    'librarian',
    'self-correction-i',
    'surveyor',
    'explorer',
    'self-correction-ii',
    'oracle',
    'prometheus',
    'memory',
    'data-processing',
  ])
  const stage: ScientificCorrection['stage'] = structuredStages.has(
    raw.stage as ScientificCorrection['stage'],
  )
    ? (raw.stage as ScientificCorrection['stage'])
    : lower.startsWith('a')
      ? 'librarian'
      : lower.startsWith('c')
        ? 'oracle'
        : lower.startsWith('d')
          ? 'prometheus'
          : 'explorer'
  const kind: ScientificCorrection['kind'] = raw.kind
    ? raw.kind
    : /schema|结构/.test(lower)
      ? 'schema'
      : /provenance|溯源|来源/.test(lower)
        ? 'provenance'
        : /execution|执行/.test(lower)
          ? 'execution'
          : 'factual'
  return correction(
    stage,
    kind,
    raw.severity,
    raw.message,
    raw.action,
    round,
    raw.affectedIds?.length ? raw.affectedIds : [agentId],
    raw.affectedIds ?? [],
    agentId,
    raw.evidenceAction ?? 'none',
  )
}

/**
 * Cross-hypothesis reuse audit: the same quantitative metric from the same
 * deterministic processing run must not silently serve as "support" for many
 * competing mechanism candidates at once. Prediction-consistent reuse is
 * allowed, but it is a methodological boundary, so oracle.verify records it as a
 * self-correction listing every affected record. The records themselves stay
 * valid (evidenceAction 'none'): they constrain the shared thermal structure,
 * they just cannot discriminate mechanisms.
 */
function auditSharedDiagnosticSupport(
  evidence: readonly EvidenceRecord[],
  round: number,
): ScientificCorrection[] {
  const groups = new Map<string, { hypothesisIds: Set<string>; evidenceIds: string[] }>()
  for (const record of evidence) {
    if (record.status !== 'support' || !record.hypothesisId || !record.provenance) continue
    for (const result of record.quantitativeResults) {
      const key = `${result.metric}|${record.provenance.processingRunId}`
      const group = groups.get(key) ?? { hypothesisIds: new Set<string>(), evidenceIds: [] }
      group.hypothesisIds.add(record.hypothesisId)
      group.evidenceIds.push(record.evidenceId)
      groups.set(key, group)
    }
  }
  const corrections: ScientificCorrection[] = []
  for (const [key, group] of groups) {
    if (group.hypothesisIds.size < 3) continue
    const separatorIndex = key.indexOf('|')
    const metric = key.slice(0, separatorIndex)
    const processingRunId = key.slice(separatorIndex + 1)
    corrections.push(
      correction(
        'oracle',
        'factual',
        'warning',
        `同一处理运行（${processingRunId}）中的诊断指标 ${metric} 被 ${group.hypothesisIds.size} 个不同机制假设同时标记为预测相容支持；该记录只约束共同热结构，不具机制区分力。`,
        '各假设仍需独立满足机制区分、独立事件与全部预测覆盖义务；不得把共享诊断当成任一单一机制的进展。',
        round,
        [...group.evidenceIds],
        [...group.evidenceIds],
        'oracle.verify',
      ),
    )
  }
  return corrections
}

/**
 * Apply evidence-targeting corrections without deleting the original record.
 * Revoked/downgraded rows remain auditable, but can no longer influence a
 * mechanism decision or evidence-strength assessment.
 */
function adjudicateEvidence(
  records: readonly EvidenceRecord[],
  corrections: readonly ScientificCorrection[],
): EvidenceRecord[] {
  const applicable = corrections.filter(
    (item) =>
      item.evidenceAction !== 'none' && item.severity !== 'info' && item.affectedIds.length > 0,
  )
  if (applicable.length === 0) return [...records]
  return records.map((record) => {
    const matched = applicable.filter((item) => item.affectedIds.includes(record.evidenceId))
    if (matched.length === 0) return record
    const revoked = matched.some((item) => item.evidenceAction === 'revoke')
    // P1-8: a downgrade applied to a record that is already unknown /
    // diagnostic_boundary is a no-op — recording it as a fresh 'downgraded'
    // adjudication manufactured fake self-correction counts.
    if (
      !revoked &&
      record.status === 'unknown' &&
      record.evidenceRole === 'diagnostic_boundary' &&
      record.adjudication?.status !== 'downgraded'
    ) {
      return record
    }
    const reason = uniqueStrings(matched.map((item) => item.message)).join('；')
    return EvidenceRecordSchema.parse({
      ...record,
      status: 'unknown',
      evidenceRole: 'diagnostic_boundary',
      adjudication: {
        status: revoked ? 'revoked' : 'downgraded',
        correctionIds: matched.map((item) => item.correctionId),
        reason,
      },
      limitations: uniqueStrings([
        ...record.limitations,
        `${revoked ? '证据已撤销' : '证据已降级'}：${reason}`,
      ]),
    })
  })
}

function mapAgentExecution(
  execution: EvidenceAgentExecution,
  round: number,
  evidenceIds: readonly string[],
  taskIds: readonly string[],
  stage: AgentExecution['stage'] = 'explorer',
): AgentExecution {
  return AgentExecutionSchema.parse({
    agentId: execution.agentId,
    label: execution.label,
    stage,
    status: execution.status,
    capabilities: execution.capabilities,
    round,
    ...(execution.error ? { error: execution.error } : {}),
    outputHypothesisIds: [],
    outputEvidenceIds: uniqueStrings(evidenceIds),
    outputTaskIds: uniqueStrings(taskIds),
  })
}

function appendStageExecution(
  state: ScientificGraphState,
  execution: AgentExecution,
): AgentExecution[] {
  const parsed = AgentExecutionSchema.parse(execution)
  const key = `${parsed.agentId}:${parsed.stage}:${parsed.round}`
  const existing = new Set(
    state.agentExecutions.map((item) => `${item.agentId}:${item.stage}:${item.round}`),
  )
  return existing.has(key) ? state.agentExecutions : [...state.agentExecutions, parsed]
}

function safeHypotheses(
  candidates: readonly ScientificHypothesis[],
  round: number,
): { hypotheses: ScientificHypothesis[]; corrections: ScientificCorrection[] } {
  const hypotheses: ScientificHypothesis[] = []
  const corrections: ScientificCorrection[] = []
  for (const candidate of candidates) {
    const parsed = ScientificHypothesisSchema.safeParse(candidate)
    if (parsed.success) {
      hypotheses.push(parsed.data)
      continue
    }
    corrections.push(
      correction(
        'librarian',
        'schema',
        'error',
        '候选假设结构校验失败，已拒绝进入 State。',
        '保留校正记录，并要求 Librarian 阶段补齐可观测预测和证伪条件。',
        round,
        ['librarian.generate'],
      ),
    )
  }
  return { hypotheses: upsertById([], hypotheses, 'id'), corrections }
}

function boundedConclusion(
  hypotheses: readonly ScientificHypothesis[],
  evidence: readonly EvidenceRecord[],
): string {
  const activeHypotheses = hypotheses.filter(
    (hypothesis) => hypothesis.status !== 'revised' && hypothesis.status !== 'eliminated',
  )
  const reportableHypotheses = activeHypotheses.length > 0 ? activeHypotheses : hypotheses
  const statusLabel = (hypothesis: ScientificHypothesis): string => {
    const status = hypothesis.status
    if (status === 'supported')
      return isBoundedThermalProcessClaim(hypothesis)
        ? '通过跨事件受限热过程支持门槛（非具体微观机制）'
        : '通过具体机制严格支持门槛'
    if (status === 'provisionally_supported')
      return '阶段性支持（当前证据下相对最优候选，未达严格机制门槛）'
    if (status === 'contradicted') return '反证主导（否认倾向，未达淘汰门槛）'
    if (status === 'deferred_requires_data') return '缺数据待判'
    if (status === 'eliminated') return '已淘汰'
    if (status === 'revised') return '已修订'
    if (status === 'uncertain') return '尚不确定'
    return '候选'
  }
  const statusCounts = new Map<string, number>()
  for (const hypothesis of reportableHypotheses) {
    const label = statusLabel(hypothesis)
    statusCounts.set(label, (statusCounts.get(label) ?? 0) + 1)
  }
  const statusSummary = [...statusCounts.entries()]
    .map(([label, count]) => `${label} ${count} 条`)
    .join('、')
  const hypothesisDetails = reportableHypotheses.map((hypothesis, index) => {
    const relatedEvidence = evidence.filter((item) => item.hypothesisId === hypothesis.id)
    const gate = assessSupportGate(relatedEvidence, {
      requiredPredictionIds: hypothesis.predictions.map((_, index) =>
        scientificPredictionId(hypothesis.id, index),
      ),
    })
    const statement = hypothesis.statement.replace(/\s+/g, ' ').slice(0, 40)
    return `${index + 1}）${statusLabel(hypothesis)}；等级 ${gate.evidenceStrengthGrade}；${gate.supportRecords.length} 条预测相容记录，其中 ${gate.validSupportRecords.length} 条计入严格门槛（事件组 ${gate.eventGroupIds.length} 个）；可审计反例 ${gate.validContradictionRecords.length} 条 — ${statement}${hypothesis.statement.length > 40 ? '…' : ''}`
  })
  const strictlySupportedCount = reportableHypotheses.filter(
    (hypothesis) => hypothesis.status === 'supported',
  ).length
  const provisionallySupportedCount = reportableHypotheses.filter(
    (hypothesis) => hypothesis.status === 'provisionally_supported',
  ).length
  const provisionalNote =
    provisionallySupportedCount > 0
      ? `其中 ${provisionallySupportedCount} 条为阶段性支持（当前证据下相对最优候选）。`
      : ''
  const gateSummary =
    strictlySupportedCount === 0
      ? `当前没有任何候选假设通过严格支持门槛。${provisionalNote}`
      : `当前共有 ${strictlySupportedCount} 个候选假设通过严格支持门槛。${provisionalNote}`
  return [
    `${gateSummary}结果分布：${statusSummary}。`,
    '逐条状态（状态；序数证据等级；预测相容/计入门槛；反例 — 摘要）：',
    hypothesisDetails.join('\n'),
    '证据等级为序数等级、非概率。“预测相容”不等于机制得证；跨事件受限热过程支持也不等于具体磁重联、纳耀斑、波动或耦合机制已被证明。',
  ].join('\n')
}

function buildCorrectionsSummary(
  corrections: readonly ScientificCorrection[],
  evidence: readonly EvidenceRecord[],
): {
  total: number
  uniqueProblemCount: number
  duplicateCorrectionCount: number
  uniqueAffectedEvidenceCount: number
  realDowngradeCount: number
  realRevocationCount: number
} {
  const uniqueProblems = new Set(corrections.map(correctionProblemKey))
  const affectedEvidence = new Set<string>()
  for (const correction of corrections) {
    for (const id of correction.affectedIds ?? []) {
      if (id.startsWith('e-')) affectedEvidence.add(id)
    }
  }
  const realDowngradeCount = evidence.filter(
    (record) => record.adjudication?.status === 'downgraded',
  ).length
  const realRevocationCount = evidence.filter(
    (record) => record.adjudication?.status === 'revoked',
  ).length
  return {
    total: corrections.length,
    uniqueProblemCount: uniqueProblems.size,
    duplicateCorrectionCount: corrections.length - uniqueProblems.size,
    uniqueAffectedEvidenceCount: affectedEvidence.size,
    realDowngradeCount,
    realRevocationCount,
  }
}

const DISPOSITION_REASON_LABELS: Record<string, string> = {
  accepted_bounded_process: '有界过程层支持（机制未定）',
  accepted_specific_mechanism: '具体机制支持',
  rejected_falsified: '已被合格反例淘汰',
  disfavored_not_falsified: '证据不利但未达淘汰功效',
  deferred_requires_data: '缺数据（requires_data）',
  deferred_external_validation: '缺外部执行器/环境',
  deferred_underpowered: '已检验但功效不足',
  incomplete_executable_work: '存在未完成的本轮工作',
  unresolved_no_executable_path: '无可执行路径',
  superseded_by_revision: '被修订版假设取代',
}

function buildHypothesisDispositions(
  hypotheses: readonly ScientificHypothesis[],
  closureReports: readonly HypothesisClosureReport[],
  verificationReports: readonly HypothesisVerificationReport[],
): Array<{
  hypothesisId: string
  statement: string
  primaryStatus: string
  reasonStatus: string
  reasonLabel: string
  evidenceStrengthGrade: string | null
}> {
  const byId = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]))
  const grades = new Map(
    verificationReports.map((report) => [report.hypothesisId, report.evidenceStrengthGrade]),
  )
  return closureReports.map((report) => {
    const hypothesis = byId.get(report.hypothesisId)
    const label = DISPOSITION_REASON_LABELS[report.runDisposition] ?? report.dispositionReason
    return {
      hypothesisId: report.hypothesisId,
      statement: hypothesis?.statement ?? '',
      primaryStatus: hypothesis?.status ?? 'uncertain',
      reasonStatus: report.runDisposition,
      reasonLabel: label,
      evidenceStrengthGrade: grades.get(report.hypothesisId) ?? null,
    }
  })
}

/**
 * Operational closure (P0-3): did every executor, agent and data input in
 * this run actually succeed? Kept strictly separate from workflowClosure
 * (are all hypotheses/tasks disposed) and closureStatus (is the science
 * settled) so a run can never report 'complete' while its own log shows
 * failed agents, failed tasks or unresolved error-severity corrections.
 */
function buildOperationalClosure(state: ScientificGraphState): {
  status: 'complete' | 'degraded'
  agentFailures: Array<{ agentId: string; status: string }>
  failedTaskIds: string[]
  unresolvedErrorCorrectionCount: number
  dataIntegrityErrors: string[]
  reasons: string[]
} {
  const agentFailures = state.agentExecutions
    .filter((execution) => execution.status !== 'completed' && execution.status !== 'skipped')
    .map((execution) => ({ agentId: execution.agentId, status: execution.status }))
  const failedTaskIds = state.validationTasks
    .filter((task) => task.status === 'failed')
    .map((task) => task.taskId)
  const errorCorrections = state.corrections.filter((correction) => correction.severity === 'error')
  const dataIntegrityErrors = errorCorrections
    .filter(
      (correction) => correction.kind === 'provenance' || correction.stage === 'data-processing',
    )
    .map((correction) => correction.message)
  const reasons: string[] = []
  if (agentFailures.length > 0) {
    reasons.push(
      `${agentFailures.length} 个智能体执行未完成（${agentFailures.map((item) => `${item.agentId}:${item.status}`).join('、')}）。`,
    )
  }
  if (failedTaskIds.length > 0) {
    reasons.push(`${failedTaskIds.length} 个本地诊断任务执行失败。`)
  }
  if (errorCorrections.length > 0) {
    reasons.push(`${errorCorrections.length} 条 error 级 correction 未清除。`)
  }
  const status =
    agentFailures.length === 0 && failedTaskIds.length === 0 && errorCorrections.length === 0
      ? 'complete'
      : 'degraded'
  return {
    status,
    agentFailures,
    failedTaskIds,
    unresolvedErrorCorrectionCount: errorCorrections.length,
    dataIntegrityErrors,
    reasons,
  }
}

function resultFromState(state: ScientificGraphState): ScientificGraphResult {
  const terminationReason = state.terminationReason ?? 'no_new_evidence_or_tasks'
  const conclusion =
    state.conclusion.trim() || '未形成可验证结论：当前输入尚未产生满足结构与来源约束的候选假设。'
  const activeHypotheses = state.hypotheses.filter(
    (item) => item.status !== 'revised' && item.status !== 'eliminated',
  )
  const allActiveHypothesesSupported =
    activeHypotheses.length > 0 && activeHypotheses.every((item) => item.status === 'supported')
  const allHypothesesFalsified =
    state.hypotheses.length > 0 && state.hypotheses.every((item) => item.status === 'eliminated')
  const reportableHypotheses = state.hypotheses.filter((item) => item.status !== 'revised')
  const hasSupportedHypothesis = reportableHypotheses.some((item) => item.status === 'supported')
  const hasEliminatedHypothesis = reportableHypotheses.some((item) => item.status === 'eliminated')
  const hasUnresolvedHypothesis = reportableHypotheses.some(
    (item) =>
      item.status === 'candidate' ||
      item.status === 'uncertain' ||
      item.status === 'deferred_requires_data' ||
      item.status === 'contradicted' ||
      item.status === 'provisionally_supported',
  )
  const hasMixedOutcome =
    (hasSupportedHypothesis && (hasEliminatedHypothesis || hasUnresolvedHypothesis)) ||
    (hasEliminatedHypothesis && hasUnresolvedHypothesis)
  const closure = assessScientificClosure({
    hypotheses: state.hypotheses,
    evidence: state.evidence,
    tasks: state.validationTasks,
    verificationReports: state.verificationReports,
  })
  const dataReadiness = summarizeDataReadiness(state.validationTasks)
  const hasExternalWork =
    dataReadiness.externalTaskIds.length > 0 ||
    dataReadiness.humanReviewTaskIds.length > 0 ||
    dataReadiness.unassessedTaskIds.length > 0
  const scientificStatus =
    terminationReason === 'no_valid_hypotheses'
      ? ('blocked' as const)
      : allActiveHypothesesSupported
        ? ('supported' as const)
        : allHypothesesFalsified
          ? ('falsified' as const)
          : hasMixedOutcome
            ? ('mixed' as const)
            : dataReadiness.requiresNewData
              ? ('needs_data' as const)
              : terminationReason === 'no_executable_validation_task' || hasExternalWork
                ? ('needs_external_validation' as const)
                : ('inconclusive' as const)
  const roundBudget = {
    maxRounds: state.maxRounds,
    roundsUsed: state.completedRounds,
    // The budget can be fully consumed even when a stronger scientific stop
    // (for example, no executable validation task) wins the termination reason.
    exhausted: state.completedRounds >= state.maxRounds,
    deferredTaskCount: state.budgetDeferredTaskCount,
  }
  const parsed = ScientificLoopResultSchema.parse({
    runId: state.runId,
    status: terminationReason === 'no_valid_hypotheses' ? 'blocked' : 'completed',
    totalRounds: state.completedRounds,
    hypotheses: state.hypotheses,
    evidence: state.evidence,
    validationTasks: state.validationTasks,
    verificationReports: state.verificationReports,
    closureReports: closure.reports,
    closureStatus: closure.status,
    workflowClosure: closure.workflowClosure,
    operationalClosure: buildOperationalClosure(state),
    correctionsSummary: buildCorrectionsSummary(state.corrections, state.evidence),
    hypothesisDispositions: buildHypothesisDispositions(
      state.hypotheses,
      closure.reports,
      state.verificationReports,
    ),
    hypothesisCoverage: state.hypothesisCoverage,
    outcomeProfile: buildOutcomeProfile(state.hypotheses),
    dataReadiness,
    roundBudget,
    conclusion,
    nextValidationPlan: state.validationTasks.filter((task) => task.status === 'planned'),
    terminationReason,
    scientificStatus,
  })
  return {
    ...parsed,
    corrections: state.corrections,
    limitations: state.limitations,
    agentExecutions: state.agentExecutions,
  }
}

function verificationNextActions(input: {
  eventGroupIds: readonly string[]
  rawDataFingerprints: readonly string[]
  observableFamilies: readonly string[]
  methodFamilies: readonly string[]
  uncoveredPredictionIds: readonly string[]
  untestedPredictionIds: readonly string[]
  hasHoldoutEvidence: boolean
  holdoutAttempted: boolean
  hasQuantitativeMetrics: boolean
  validContradictionCount: number
  policy: SupportGateAssessment['policy']
}): string[] {
  const actions: string[] = []
  if (
    input.eventGroupIds.length < input.policy.minIndependentEvents ||
    input.rawDataFingerprints.length < input.policy.minIndependentEvents
  ) {
    actions.push(
      `补足至少 ${input.policy.minIndependentEvents} 个相互独立的目标事件及原始数据 lineage。`,
    )
  }
  if (input.observableFamilies.length < input.policy.minObservableFamilies) {
    actions.push('加入第二类独立可观测量，避免由单一强度代理量证明机制。')
  }
  if (input.methodFamilies.length < input.policy.minMethodFamilies) {
    actions.push('加入第二种独立分析方法，并报告其与现有结果是否一致。')
  }
  if (input.policy.requireHoldout && !input.hasHoldoutEvidence) {
    actions.push(
      input.holdoutAttempted
        ? '留出复测已执行但未形成有效支持；不要重复计数同一事件，应增加独立事件或改用与预测匹配的诊断。'
        : '在冻结参数的独立留出事件上复测，不得依据结果回调阈值。',
    )
  }
  // Distinguish "never exercised" from "exercised but only prediction-
  // consistent": the former needs a task, the latter needs mechanism-
  // discriminating diagnostics or independent events, not a rerun.
  if (input.policy.requireAllPredictions && input.untestedPredictionIds.length > 0) {
    actions.push(`补测从未执行的预测：${input.untestedPredictionIds.join('、')}。`)
  }
  const testedButUncovered = input.uncoveredPredictionIds.filter(
    (predictionId) => !input.untestedPredictionIds.includes(predictionId),
  )
  if (input.policy.requireAllPredictions && testedButUncovered.length > 0) {
    actions.push(
      `已测但仅有预测相容记录、缺机制区分性支持的预测：${testedButUncovered.join('、')}；需增加机制判别诊断或独立事件，而非重复同一检验。`,
    )
  }
  if (!input.hasQuantitativeMetrics) {
    actions.push('为每条决定性证据补齐点估计、区间和可追溯处理产物。')
  }
  if (input.validContradictionCount > 0) {
    actions.push('先解释或复现实质性反例，反例未解决前不得标记 supported。')
  }
  return actions
}

function isBoundedThermalProcessClaim(hypothesis: ScientificHypothesis): boolean {
  const mechanismText = hypothesis.mechanismComposition.map((item) => item.mechanism).join(' ')
  const coreClaim = `${hypothesis.statement} ${mechanismText}`
  const processLevel = /(?:低频|间歇|脉冲|impulsive)/i.test(coreClaim)
  const cohortScoped = /(?:所选.{0,8}样本|跨事件|队列|多活动区|sample|cohort|cross-event)/i.test(
    `${hypothesis.statement} ${hypothesis.scope}`,
  )
  const claimsSpecificMechanism = /(?:磁重联|重联|纳耀斑|nanoflare|reconnect)/i.test(coreClaim)
  return processLevel && cohortScoped && !claimsSpecificMechanism
}

function verificationSupportTier(
  hypothesis: ScientificHypothesis,
  gate: SupportGateAssessment,
): HypothesisVerificationReport['supportTier'] {
  if (gate.evidenceStrengthGrade === 'conflicted') return 'conflicted'
  if (!gate.supported) return 'not_supported'
  return isBoundedThermalProcessClaim(hypothesis)
    ? 'bounded_process_support'
    : 'specific_mechanism_support'
}

function buildVerificationReport(input: {
  hypothesis: ScientificHypothesis
  gate: SupportGateAssessment
  elimination: EliminationGateAssessment
  relatedRecords: readonly EvidenceRecord[]
  decision: ScientificHypothesis['status']
  round: number
  testedPredictionIds?: readonly string[]
}): HypothesisVerificationReport {
  const reasons = uniqueStrings([...input.gate.reasons, ...input.elimination.reasons])
  const supportGatePassed = input.gate.supported
  const attemptedAnalysisSplits = uniqueStrings(
    input.relatedRecords.flatMap((record) =>
      record.lineage?.analysisSplit ? [record.lineage.analysisSplit] : [],
    ),
  )
  const holdoutAttempted = attemptedAnalysisSplits.includes('holdout')
  // Report coverage in two layers: "exercised by a completed task" (tested)
  // versus "covered by gate-valid mechanism support" (covered). Conflating
  // them made prediction-consistent runs read as if nothing had been tested.
  const requiredPredictionIds = uniqueStrings(
    input.hypothesis.predictions.map((_, index) =>
      scientificPredictionId(input.hypothesis.id, index),
    ),
  )
  const testedPredictionIds = uniqueStrings(
    (input.testedPredictionIds ?? []).filter((predictionId) =>
      requiredPredictionIds.includes(predictionId),
    ),
  )
  const untestedPredictionIds = requiredPredictionIds.filter(
    (predictionId) => !testedPredictionIds.includes(predictionId),
  )
  return HypothesisVerificationReportSchema.parse({
    hypothesisId: input.hypothesis.id,
    round: input.round,
    decision: input.decision,
    evidenceStrengthGrade: input.gate.evidenceStrengthGrade,
    evidenceStrengthSemantics: 'ordinal_evidence_grade_not_probability',
    supportTier: verificationSupportTier(input.hypothesis, input.gate),
    supportEvidenceIds: input.gate.supportRecords.map((record) => record.evidenceId),
    validSupportEvidenceIds: input.gate.validSupportRecords.map((record) => record.evidenceId),
    contradictionEvidenceIds: input.gate.validContradictionRecords.map(
      (record) => record.evidenceId,
    ),
    eventGroupIds: input.gate.eventGroupIds,
    rawDataFingerprints: input.gate.rawDataFingerprints,
    observableFamilies: input.gate.observableFamilies,
    methodFamilies: input.gate.methodFamilies,
    analysisSplits: input.gate.analysisSplits,
    attemptedAnalysisSplits,
    coveredPredictionIds: input.gate.coveredPredictionIds,
    uncoveredPredictionIds: input.gate.uncoveredPredictionIds,
    testedPredictionIds,
    untestedPredictionIds,
    hasHoldoutEvidence: input.gate.hasHoldoutEvidence,
    holdoutAttempted,
    hasQuantitativeEvidence: input.gate.hasQuantitativeMetrics,
    meetsEvidenceCriteria: input.gate.meetsEvidenceCriteria,
    supportGatePassed,
    eliminationGatePassed: input.elimination.eliminated,
    eliminationEvidenceIds: input.elimination.eliminationEvidenceRecords.map(
      (record) => record.evidenceId,
    ),
    coveredFalsificationConditionIds: input.elimination.coveredFalsificationConditionIds,
    decisiveFalsificationConditionIds: input.elimination.decisiveFalsificationConditionIds,
    uncoveredFalsificationConditionIds: input.elimination.uncoveredFalsificationConditionIds,
    eliminationTaskIds: input.elimination.adequateTaskIds,
    eliminationReasons: input.elimination.reasons,
    reasons,
    nextActions: verificationNextActions({
      eventGroupIds: input.gate.eventGroupIds,
      rawDataFingerprints: input.gate.rawDataFingerprints,
      observableFamilies: input.gate.observableFamilies,
      methodFamilies: input.gate.methodFamilies,
      uncoveredPredictionIds: input.gate.uncoveredPredictionIds,
      untestedPredictionIds,
      hasHoldoutEvidence: input.gate.hasHoldoutEvidence,
      holdoutAttempted,
      hasQuantitativeMetrics: input.gate.hasQuantitativeMetrics,
      validContradictionCount: input.gate.validContradictionRecords.length,
      policy: input.gate.policy,
    }),
  })
}

/** Audit records collected from the optional human channel during a run. */
export interface ScientificHumanInteractionRecords {
  steering: ScientificSteeringRecord[]
  gates: ScientificHumanGateRecord[]
}

export function createScientificLoopGraph(
  input: ScientificGraphInput,
  dependencies: ScientificGraphDependencies,
  runtime: ScientificGraphRuntime,
  humanRecords: ScientificHumanInteractionRecords = { steering: [], gates: [] },
) {
  const node = async (
    state: ScientificGraphState,
    name: string,
    work: () => Promise<Partial<ScientificGraphState>> | Partial<ScientificGraphState>,
  ): Promise<Partial<ScientificGraphState>> => {
    throwIfAborted(input.abortSignal)
    // Cooperative human pause: checked at every node boundary so a pause is
    // honored between phases without interrupting an in-flight agent step.
    if (input.humanChannel?.isPaused()) {
      emit(input, 'scientific.human-paused', { node: name, round: state.round })
      await input.humanChannel.waitWhilePaused(input.abortSignal)
      emit(input, 'scientific.human-resumed', { node: name, round: state.round })
    }
    throwIfAborted(input.abortSignal)
    emitNode(input, name, 'running', state.round)
    const update = await work()
    emitNode(input, name, 'completed', state.round)
    return update
  }

  const graph = new StateGraph(ScientificGraphStateSchema)
    .addNode('librarian.generate', async (state) =>
      node(state, 'librarian.generate', async () => {
        const context = buildScientificContext({ stage: 'librarian', state })
        // Drain advisory human steering queued since the last round. Local
        // deterministic generation records it without consuming it; the model
        // path may use it as emphasis. Neither path lets it alter verdicts.
        const steering = input.humanChannel ? input.humanChannel.drainSteering(state.round) : []
        for (const message of steering) {
          emit(input, 'scientific.steering-injected', { round: state.round, message })
          humanRecords.steering.push(
            ScientificSteeringRecordSchema.parse({
              messageId: message.messageId,
              mode: message.mode,
              content: message.content,
              round: state.round,
              injectedAt: message.queuedAt,
            }),
          )
        }
        const generation = await dependencies.generateHypotheses({
          projectId: state.projectId,
          runId: state.runId,
          round: state.round,
          phenomenon: state.phenomenon,
          context,
          existingHypotheses: state.hypotheses,
          ...(steering.length > 0 ? { steering } : {}),
          signal: input.abortSignal,
        })
        const generated = Array.isArray(generation) ? generation : generation.hypotheses
        const generationCorrections = Array.isArray(generation)
          ? []
          : (generation.corrections ?? []).flatMap((item) => {
              const parsed = ScientificCorrectionSchema.safeParse(item)
              return parsed.success ? [parsed.data] : []
            })
        const suppliedCoverage = Array.isArray(generation) ? undefined : generation.coverageAudit
        const checked = safeHypotheses(generated, state.round)
        const hypotheses =
          checked.hypotheses.length > 0
            ? upsertById(state.hypotheses, checked.hypotheses, 'id')
            : state.hypotheses
        const hasRevision = checked.hypotheses.some(
          (item) => item.round === state.round && item.parentId !== null,
        )
        const validationTasks = hasRevision
          ? state.validationTasks.map((task) =>
              task.status === 'planned' && decideNextRoute(task) === 'librarian'
                ? { ...task, status: 'completed' as const }
                : task,
            )
          : state.validationTasks
        for (const hypothesis of checked.hypotheses) {
          emit(input, 'scientific.hypothesis', { round: state.round, hypothesis })
        }
        const currentCoverage = suppliedCoverage
          ? HypothesisCoverageAuditSchema.parse({
              ...suppliedCoverage,
              candidateCount: hypotheses.filter((item) => item.status !== 'revised').length,
            })
          : fallbackHypothesisCoverage(hypotheses)
        emit(input, 'scientific.hypothesis-coverage', {
          round: state.round,
          coverage: currentCoverage,
        })
        return {
          hypotheses,
          hypothesisCoverage: currentCoverage,
          validationTasks,
          agentExecutions: appendStageExecution(state, {
            agentId: 'librarian',
            label: '文献溯源智能体：候选机制生成',
            stage: 'librarian',
            status: 'completed',
            capabilities: ['literature-retrieval', 'observation-analysis', 'fact-check'],
            round: state.round,
            outputHypothesisIds: checked.hypotheses.map((item) => item.id),
            outputEvidenceIds: [],
            outputTaskIds: [],
          }),
          corrections: appendCorrections(input, state.corrections, [
            ...generationCorrections,
            ...checked.corrections,
          ]),
          limitations: appendLimitations(
            state.limitations,
            [...generationCorrections, ...checked.corrections].map((item) => item.message),
          ),
        }
      }),
    )
    .addNode('self-correction-i.verify', async (state) =>
      node(state, 'self-correction-i.verify', () => {
        const valid = state.hypotheses.filter(
          (item) => ScientificHypothesisSchema.safeParse(item).success,
        )
        if (valid.length === 0) {
          const generationFailure = [...state.corrections]
            .reverse()
            .find(
              (item) =>
                item.stage === 'librarian' &&
                item.round === state.round &&
                item.severity === 'error',
            )
          const item =
            generationFailure ??
            correction(
              'librarian',
              'schema',
              'error',
              '本轮没有满足结构约束的候选假设。',
              '停止后续证据判断，要求补充可观测预测、证伪条件或有效输入。',
              state.round,
              ['self-correction-i.verify'],
            )
          return {
            hypotheses: [],
            terminationReason: 'no_valid_hypotheses' as const,
            corrections: generationFailure
              ? state.corrections
              : appendCorrections(input, state.corrections, [item]),
            limitations: appendLimitations(state.limitations, [item.message]),
          }
        }
        // 自校正(I)实质校验：在结构校验之外，检查文献依据与本地可检验性。
        const plausibilityCorrections: ScientificCorrection[] = []
        const executorIds = Object.keys(EXECUTOR_CAPABILITIES)
        for (const hypothesis of valid) {
          if (hypothesis.sourceIds.length === 0) {
            plausibilityCorrections.push(
              correction(
                'librarian',
                'provenance',
                'warning',
                '候选假设未绑定任何文献或观测来源（sourceIds 为空）。',
                '补充文献语料检索，将假设绑定到可核验来源后再参与结论综合。',
                state.round,
                ['self-correction-i.verify'],
                [hypothesis.id],
                'self-correction-i.verify',
              ),
            )
          }
          const checkable = hypothesis.predictions.some((statement) => {
            const required = predictionRequiredFamilies(statement)
            if (required.length === 0) return true
            return executorIds.some((executorId) =>
              executorSupportsPrediction(executorId, statement),
            )
          })
          if (!checkable) {
            plausibilityCorrections.push(
              correction(
                'librarian',
                'execution',
                'warning',
                '候选假设的全部原子预测都超出当前登记执行器的能力范围。',
                '保留为候选并标记为缺数据待判；等待外部数据或新增执行器后再检验。',
                state.round,
                ['self-correction-i.verify'],
                [hypothesis.id],
                'self-correction-i.verify',
              ),
            )
          }
        }
        return {
          hypotheses: valid,
          terminationReason: null,
          corrections:
            plausibilityCorrections.length > 0
              ? appendCorrections(input, state.corrections, plausibilityCorrections)
              : state.corrections,
          limitations: appendLimitations(
            state.limitations,
            plausibilityCorrections.map((item) => item.message),
          ),
        }
      }),
    )
    .addNode('surveyor.analyze', async (state) =>
      node(state, 'surveyor.analyze', () => {
        // Surveyor 全局粗粒度分析：确定性任务优先级排序 + 观测覆盖摘要。
        // 只做排序与摘要，不产生任何证据、结论或裁决。
        const readinessRank: Record<string, number> = {
          executable_now: 0,
          requires_data: 1,
          unassessed: 2,
          external: 3,
          human_review: 4,
        }
        const planned = state.validationTasks.filter((task) => task.status === 'planned')
        const prioritized = [...planned].sort((left, right) => {
          const byReadiness =
            (readinessRank[left.readiness ?? 'unassessed'] ?? 2) -
            (readinessRank[right.readiness ?? 'unassessed'] ?? 2)
          if (byReadiness !== 0) return byReadiness
          const byDetectability = (left.detectability ? 0 : 1) - (right.detectability ? 0 : 1)
          if (byDetectability !== 0) return byDetectability
          return left.taskId.localeCompare(right.taskId)
        })
        const reordered = [
          ...prioritized,
          ...state.validationTasks.filter((task) => task.status !== 'planned'),
        ]
        const highFocus = prioritized
          .filter((task) => (readinessRank[task.readiness ?? 'unassessed'] ?? 2) <= 1)
          .slice(0, 3)
        const summary = compactSummary([
          `第 ${state.round} 轮全局粗粒度分析：候选假设 ${state.hypotheses.length} 条、累计证据 ${state.evidence.length} 条、待执行验证任务 ${planned.length} 项。`,
          highFocus.length > 0
            ? `高关注目标：${highFocus.map((task) => task.objective).join('；')}`
            : '当前没有可本地执行的高关注验证目标。',
        ])
        emit(input, 'scientific.reasoning-summary', {
          stage: 'surveyor',
          round: state.round,
          agentId: 'surveyor-coarse-analysis',
          title: '全局粗粒度分析',
          summary,
        })
        return {
          validationTasks: reordered.some((task, index) => task !== state.validationTasks[index])
            ? reordered
            : state.validationTasks,
          agentExecutions: appendStageExecution(state, {
            agentId: 'looker',
            label: '观测质控智能体：全局粗粒度分析',
            stage: 'surveyor',
            status: 'completed',
            capabilities: ['observation-analysis'],
            round: state.round,
            outputHypothesisIds: [],
            outputEvidenceIds: [],
            outputTaskIds: [],
          }),
        }
      }),
    )
    .addNode('explorer.analyze', async (state) =>
      node(state, 'explorer.analyze', async () => {
        const context = buildScientificContext({ stage: 'explorer', state })
        const registered =
          typeof dependencies.evidenceAgents === 'function'
            ? await dependencies.evidenceAgents({
                projectId: state.projectId,
                runId: state.runId,
                round: state.round,
                phenomenon: state.phenomenon,
                context,
                state,
                signal: input.abortSignal,
              })
            : dependencies.evidenceAgents
        const deterministicAgents = registered.filter((agent) => agent.executionKind !== 'model')
        const modelAgents = registered.filter((agent) => agent.executionKind === 'model')
        const workgroupResults: EvidenceWorkgroupResult[] = []
        const agentKinds = new Map(
          registered.map((agent) => [agent.id, agent.executionKind ?? 'deterministic']),
        )
        const onAgentState = async (event: EvidenceAgentStateEvent) => {
          emit(input, 'scientific.agent-state', {
            ...event,
            executionKind: agentKinds.get(event.agentId) ?? 'deterministic',
            round: state.round,
          })
        }
        const baseContext = {
          phenomenon: context.phenomenon,
          hypotheses: context.hypotheses,
          evidence: [...context.evidence],
          validationTasks: [...context.validationTasks],
          recentCorrections: state.corrections,
          round: context.round,
          signal: input.abortSignal,
        }

        // Data computation and provenance checks remain parallel.  Model
        // workers run afterwards in a deliberate order so every reviewer can
        // inspect real upstream records and the previous model review.
        if (deterministicAgents.length > 0) {
          workgroupResults.push(
            await runLangGraphEvidenceWorkgroup(deterministicAgents, baseContext, {
              signal: input.abortSignal,
              onAgentState,
            }),
          )
        }
        let collaborativeEvidence = [
          ...baseContext.evidence,
          ...workgroupResults.flatMap((item) => item.evidence),
        ]
        let collaborativeTasks = [
          ...baseContext.validationTasks,
          ...workgroupResults.flatMap((item) => item.validationTasks),
        ]
        for (const agent of modelAgents) {
          const result = await runLangGraphEvidenceWorkgroup(
            [agent],
            {
              ...baseContext,
              evidence: collaborativeEvidence,
              validationTasks: collaborativeTasks,
            },
            { signal: input.abortSignal, onAgentState },
          )
          workgroupResults.push(result)
          collaborativeEvidence = [...collaborativeEvidence, ...result.evidence]
          collaborativeTasks = [...collaborativeTasks, ...result.validationTasks]
        }
        const workgroup = mergeWorkgroupResults(workgroupResults)

        const promoted: EvidenceRecord[] = []
        let corrections = state.corrections
        const promotionLimitations: string[] = []
        for (const candidate of workgroup.evidence) {
          const result = await promoteEvidence(candidate, {
            stage: 'explorer',
            round: state.round,
            hypothesisIds: state.hypotheses.map((item) => item.id),
            agentId: candidate.agentId,
            verifyProvenance: dependencies.verifyProvenance
              ? (evidence) => dependencies.verifyProvenance!(evidence, state)
              : undefined,
          })
          corrections = appendCorrections(input, corrections, result.corrections)
          if (result.evidence) {
            promoted.push(result.evidence)
            for (const limitation of result.evidence.limitations) {
              promotionLimitations.push(limitation)
            }
          }
        }

        const workgroupCorrections: ScientificCorrection[] = []
        for (const raw of workgroup.corrections) {
          const item = mapAgentCorrection(raw, state.round, 'evidence-workgroup')
          const normalized = ScientificCorrectionSchema.parse({
            ...item,
            correctionId:
              'correction-' +
              digest({ runId: input.runId, correctionId: item.correctionId }).slice(0, 16),
          })
          workgroupCorrections.push(normalized)
          corrections = appendCorrections(input, corrections, [item])
        }
        for (const execution of workgroup.executions) {
          if (execution.status !== 'failed') continue
          const item = correction(
            'explorer',
            'execution',
            'error',
            `${execution.label} 未能提交可校验的结构化结果：${execution.error ?? '未返回错误说明'}`,
            '保留该智能体为 failed，不采纳其未完成输出；修复模型兼容性或输出预算后重试。',
            state.round,
            [execution.agentId],
            [execution.agentId],
            execution.agentId,
          )
          corrections = appendCorrections(input, corrections, [item])
        }

        const evidence = adjudicateEvidence(
          upsertById(state.evidence, promoted, 'evidenceId'),
          workgroupCorrections,
        )
        const tasks: ValidationTask[] = []
        const taskCorrections: ScientificCorrection[] = []
        for (const candidate of workgroup.validationTasks) {
          const parsed = ValidationTaskSchema.safeParse(candidate)
          if (parsed.success) {
            tasks.push(parsed.data)
          } else {
            taskCorrections.push(
              correction(
                'explorer',
                'schema',
                'error',
                'Explorer 阶段生成的验证任务结构校验失败，已拒绝进入 State。',
                '要求数据处理智能体补齐任务目标和可区分结果。',
                state.round,
                ['explorer.analyze'],
              ),
            )
          }
        }
        corrections = appendCorrections(input, corrections, taskCorrections)
        const currentIds = new Set(state.evidence.map((item) => item.evidenceId))
        // Only stream evidence that was absent before this B pass. Existing
        // records are already in the durable ledger and re-emitting them on
        // every round made the UI look like the scientific result was growing
        // even when no new observation had been produced.
        const emittedEvidenceIds = new Set(
          promoted
            .filter((item) => !currentIds.has(item.evidenceId))
            .map((item) => item.evidenceId),
        )
        for (const item of evidence.filter((record) => emittedEvidenceIds.has(record.evidenceId))) {
          emit(input, 'scientific.evidence', { round: state.round, evidence: item })
        }
        const newEvidenceCount = promoted.filter((item) => !currentIds.has(item.evidenceId)).length
        const executions = workgroup.executions.map((item) => {
          const outputIds = item.output?.evidence?.map((evidence) => evidence.evidenceId) ?? []
          const taskIds = item.output?.validationTasks?.map((task) => task.taskId) ?? []
          return mapAgentExecution(item, state.round, outputIds, taskIds)
        })
        for (const execution of workgroup.executions) {
          if (execution.status === 'skipped') continue
          const output = execution.output
          const evidenceRows =
            output?.evidence?.map(
              (item) =>
                `${item.status === 'support' ? '支持' : item.status === 'contradict' ? '反驳' : '待核验'}：${item.claim}`,
            ) ?? []
          const summary = compactSummary([
            execution.status === 'failed'
              ? `执行失败：${execution.error ?? '未返回错误说明'}`
              : `本轮完成 ${evidenceRows.length} 条证据记录和 ${output?.validationTasks?.length ?? 0} 项后续任务`,
            ...evidenceRows.slice(0, 3),
            ...(output?.notes ?? []).slice(0, 2),
            ...(output?.limitations ?? []).slice(0, 2).map((item) => `边界：${item}`),
          ])
          if (summary) {
            emit(input, 'scientific.reasoning-summary', {
              stage: 'explorer',
              round: state.round,
              agentId: execution.agentId,
              title: `${execution.label}的核验摘要`,
              summary,
            })
          }
        }
        const executionKeys = new Set(
          state.agentExecutions.map((item) => item.agentId + ':' + item.round),
        )
        const mergedExecutions = [...state.agentExecutions]
        for (const execution of executions) {
          const key = execution.agentId + ':' + execution.round
          if (!executionKeys.has(key)) {
            executionKeys.add(key)
            mergedExecutions.push(execution)
          }
        }
        let validationTasks = upsertById(state.validationTasks, tasks, 'taskId')
        const scheduledForThisExecution = new Set(state.roundTaskIds)
        const strandedExecutableTasks = validationTasks.filter(
          (task) => scheduledForThisExecution.has(task.taskId) && task.status === 'planned',
        )
        if (strandedExecutableTasks.length > 0) {
          validationTasks = validationTasks.map((task) =>
            scheduledForThisExecution.has(task.taskId) && task.status === 'planned'
              ? {
                  ...task,
                  status: 'failed' as const,
                  blockedReason:
                    '任务已在本轮调度，但注册执行器没有返回绑定该 taskId 的结果；不得保留为未执行的 executable_now。',
                }
              : task,
          )
          const item = correction(
            'explorer',
            'execution',
            'error',
            `${strandedExecutableTasks.length} 项已调度的本地诊断没有返回任务级结果，已标记 failed。`,
            '检查对应执行器、数据选择和 taskId 绑定；修复后显式重试，不把未完成任务写成观测结论。',
            state.round,
            strandedExecutableTasks.map((task) => task.taskId),
            strandedExecutableTasks.map((task) => task.taskId),
            'explorer.analyze',
          )
          corrections = appendCorrections(input, corrections, [item])
        }
        return {
          evidence,
          validationTasks,
          agentExecutions: mergedExecutions,
          corrections,
          limitations: appendLimitations(state.limitations, [
            ...workgroup.limitations,
            ...promotionLimitations,
          ]),
          newEvidenceCount,
        }
      }),
    )
    .addNode('self-correction-ii.verify', async (state) =>
      node(state, 'self-correction-ii.verify', async () => {
        let corrections = state.corrections
        const evidence: EvidenceRecord[] = []
        const limitations: string[] = []
        for (const candidate of state.evidence) {
          const result = await promoteEvidence(candidate, {
            stage: 'self-correction-ii',
            round: state.round,
            hypothesisIds: state.hypotheses.map((item) => item.id),
            agentId: candidate.agentId,
            verifyProvenance: dependencies.verifyProvenance
              ? (item) => dependencies.verifyProvenance!(item, state)
              : undefined,
          })
          corrections = appendCorrections(input, corrections, result.corrections)
          if (result.evidence) {
            evidence.push(result.evidence)
            limitations.push(...result.evidence.limitations)
          }
        }
        return {
          evidence,
          corrections,
          limitations: appendLimitations(state.limitations, limitations),
        }
      }),
    )
    .addNode('oracle.synthesize', async (state) =>
      node(state, 'oracle.synthesize', async () => {
        const context = buildScientificContext({ stage: 'oracle', state })
        const conclusion = dependencies.synthesizeConclusion
          ? await dependencies.synthesizeConclusion({
              projectId: state.projectId,
              runId: state.runId,
              round: state.round,
              phenomenon: state.phenomenon,
              context,
              hypotheses: context.hypotheses,
              evidence: context.evidence,
              signal: input.abortSignal,
            })
          : boundedConclusion(state.hypotheses, state.evidence)
        let normalizedConclusion =
          conclusion.trim() || boundedConclusion(state.hypotheses, state.evidence)
        const activeHypotheses = state.hypotheses.filter(
          (item) => item.status !== 'revised' && item.status !== 'eliminated',
        )
        const hasSupportedHypothesis = activeHypotheses.some((item) => item.status === 'supported')
        let corrections = state.corrections
        let limitations = state.limitations
        if (hasSupportedHypothesis) {
          const verifiedConclusion = boundedConclusion(state.hypotheses, state.evidence)
          if (
            normalizedConclusion.replace(/\s+/g, ' ') !== verifiedConclusion.replace(/\s+/g, ' ')
          ) {
            const item = correction(
              'oracle',
              'factual',
              'info',
              '模型综合文字与最终逐假设门槛状态不完全一致。',
              '以最终验证状态重新生成受约束结论；保留“预测相容不等于具体机制得证”的边界。',
              state.round,
              ['oracle.verify', 'oracle.synthesize'],
              activeHypotheses.map((item) => item.id),
            )
            corrections = appendCorrections(input, corrections, [item])
          }
          normalizedConclusion = verifiedConclusion
        } else if (
          !hasSupportedHypothesis &&
          /已证明|已证实|确认.*主导|机制成立|得到支持|支持.*机制/.test(normalizedConclusion)
        ) {
          const item = correction(
            'oracle',
            'factual',
            'warning',
            '综合结论把尚未通过证据门槛的候选写成了已支持结论。',
            '按逐假设验证状态收紧结论，并保留未覆盖预测与下一步验证需求。',
            state.round,
            ['oracle.synthesize'],
            activeHypotheses
              .filter((hypothesis) => hypothesis.status !== 'supported')
              .map((item) => item.id),
          )
          normalizedConclusion = boundedConclusion(state.hypotheses, state.evidence)
          corrections = appendCorrections(input, corrections, [item])
          limitations = appendLimitations(limitations, [item.message])
        }
        emit(input, 'scientific.round-summary', {
          round: state.round,
          conclusion: normalizedConclusion,
          evidenceSummary: summarizeEvidence(state.evidence),
        })
        emit(input, 'scientific.reasoning-summary', {
          stage: 'oracle',
          round: state.round,
          agentId: 'sisyphus-synthesis',
          title: '结论如何收敛',
          summary: normalizedConclusion,
        })
        return {
          conclusion: normalizedConclusion,
          corrections,
          limitations,
        }
      }),
    )
    .addNode('oracle.verify', async (state) =>
      node(state, 'oracle.verify', () => {
        let corrections = state.corrections
        const independenceIssues = auditIndependenceConsistency(state.evidence)
        for (const issue of independenceIssues) {
          corrections = appendCorrections(input, corrections, [
            correction(
              'oracle',
              'provenance',
              'warning',
              issue.message,
              'Downgrade the affected evidence until event grouping and raw-data lineage are reconciled.',
              state.round,
              issue.evidenceIds,
              issue.evidenceIds,
              'oracle.verify',
              'downgrade_to_unknown',
            ),
          ])
        }
        const evidence = adjudicateEvidence(state.evidence, corrections)
        corrections = appendCorrections(
          input,
          corrections,
          auditSharedDiagnosticSupport(evidence, state.round),
        )
        const verificationLimitations: string[] = []
        const verificationReports: HypothesisVerificationReport[] = []
        let hasCorroboratedSupport = false
        let hasAuditableContradiction = false
        const outcomes = state.hypotheses.map((hypothesis) => {
          const related = evidence.filter((item) => item.hypothesisId === hypothesis.id)
          const gate = assessSupportGate(related, {
            requiredPredictionIds: hypothesis.predictions.map((_, index) =>
              scientificPredictionId(hypothesis.id, index),
            ),
          })
          const requiredFalsificationConditionIds = hypothesis.falsificationConditions.map(
            (_, index) => scientificFalsificationConditionId(hypothesis.id, index),
          )
          const hypothesisTasks = state.validationTasks.filter((task) =>
            task.hypothesisIds.includes(hypothesis.id),
          )
          const testedPredictionIds = uniqueStrings(
            hypothesisTasks
              .filter((task) => task.status === 'completed')
              .flatMap((task) => task.predictionIds),
          )
          const elimination = assessEliminationGate(related, hypothesisTasks, {
            requiredFalsificationConditionIds,
          })
          if (hypothesis.status === 'revised' || hypothesis.status === 'eliminated') {
            return {
              hypothesis,
              gate,
              elimination,
              related,
              testedPredictionIds,
              support: false,
              contradict: false,
              falsified: false,
              supported: false,
              wasTerminal: true,
              preliminary: hypothesis.status,
            }
          }
          const support = gate.supportRecords.length > 0
          const discriminatingSupport = gate.validSupportRecords.length > 0
          const contradict = gate.validContradictionRecords.length > 0
          const falsified = elimination.eliminated
          const supported = gate.supported
          hasCorroboratedSupport ||= supported
          hasAuditableContradiction ||= contradict
          const preliminary: ScientificHypothesis['status'] = falsified
            ? ('eliminated' as const)
            : supported
              ? ('supported' as const)
              : contradict
                ? ('contradicted' as const)
                : related.length > 0 || support || discriminatingSupport
                  ? ('deferred_requires_data' as const)
                  : ('candidate' as const)
          return {
            hypothesis,
            gate,
            elimination,
            related,
            testedPredictionIds,
            support,
            contradict,
            falsified,
            supported,
            wasTerminal: false,
            preliminary,
          }
        })
        // Relative verdict: among hypotheses that have supporting signal but no
        // auditable contradiction, promote the single strongest to
        // provisionally_supported (阶段性最优候选). This is a within-run ranking,
        // not the strict mechanism-support gate.
        const evidenceGradeOrdinal: Record<string, number> = {
          strong: 5,
          moderate: 4,
          limited: 3,
          conflicted: 2,
          insufficient: 1,
          not_assessed: 0,
        }
        const promotable = outcomes.filter(
          (outcome) =>
            outcome.preliminary === 'deferred_requires_data' &&
            outcome.gate.supportRecords.length > 0,
        )
        const provisionalWinner = promotable
          .slice()
          .sort(
            (a, b) =>
              b.gate.validSupportRecords.length - a.gate.validSupportRecords.length ||
              b.gate.supportRecords.length - a.gate.supportRecords.length ||
              b.related.length - a.related.length ||
              (evidenceGradeOrdinal[b.gate.evidenceStrengthGrade] ?? 0) -
                (evidenceGradeOrdinal[a.gate.evidenceStrengthGrade] ?? 0) ||
              a.hypothesis.id.localeCompare(b.hypothesis.id),
          )[0]
        const hypotheses = outcomes.map((outcome) => {
          const { hypothesis, gate, elimination, related, support, falsified, supported } = outcome
          if (outcome.wasTerminal) {
            verificationReports.push(
              buildVerificationReport({
                hypothesis,
                gate,
                elimination,
                relatedRecords: related,
                decision: hypothesis.status,
                round: state.round,
                testedPredictionIds: outcome.testedPredictionIds,
              }),
            )
            return { ...hypothesis, evidenceStrengthGrade: gate.evidenceStrengthGrade }
          }
          const status: ScientificHypothesis['status'] =
            outcome === provisionalWinner ? 'provisionally_supported' : outcome.preliminary
          verificationReports.push(
            buildVerificationReport({
              hypothesis,
              gate,
              elimination,
              relatedRecords: related,
              decision: status,
              round: state.round,
              testedPredictionIds: outcome.testedPredictionIds,
            }),
          )
          if (support && !supported) {
            const item = correction(
              'oracle',
              'factual',
              'warning',
              `假设“${hypothesis.statement}”尚未形成事件独立、预测绑定且含定量区间的完整证据链，不能升级为 supported。`,
              '归入阶段性支持或缺数据待判；补足独立事件、不同可观测量/方法、留出验证和全部预测覆盖后再复核。',
              state.round,
              gate.supportRecords.map((record) => record.evidenceId),
              [hypothesis.id, ...gate.supportRecords.map((record) => record.evidenceId)],
              'oracle.verify',
            )
            const gateCorrection = ScientificCorrectionSchema.parse({
              ...item,
              correctionId:
                'correction-' +
                digest({
                  runId: input.runId,
                  hypothesisId: hypothesis.id,
                  round: state.round,
                  reasons: gate.reasons,
                }).slice(0, 16),
              message: `Hypothesis “${hypothesis.statement}” failed the support gate: ${gate.reasons.join('; ') || 'evidence or contradiction policy not satisfied'}`,
              action:
                'Keep the hypothesis provisionally supported or deferred until auditability, independence, quantitative evidence, prediction coverage, and contradiction requirements are satisfied.',
            })
            corrections = appendCorrections(input, corrections, [gateCorrection])
            verificationLimitations.push(gateCorrection.message)
          }
          if (falsified) {
            const item = correction(
              'oracle',
              'factual',
              'info',
              `假设“${hypothesis.statement}”已满足严格淘汰门槛，从后续活跃候选池移除。`,
              '保留假设、反例、检验功效和留出集记录用于审计；只有形成带新来源的新修订假设时才重新进入候选池。',
              state.round,
              elimination.eliminationEvidenceRecords.map((record) => record.evidenceId),
              [
                hypothesis.id,
                ...elimination.eliminationEvidenceRecords.map((record) => record.evidenceId),
              ],
              'oracle.verify',
            )
            corrections = appendCorrections(input, corrections, [item])
          }
          return {
            ...hypothesis,
            status,
            evidenceStrengthGrade: gate.evidenceStrengthGrade,
          }
        })
        const eliminatedIds = new Set(
          hypotheses
            .filter((hypothesis) => hypothesis.status === 'eliminated')
            .map((hypothesis) => hypothesis.id),
        )
        const validationTasks = state.validationTasks.map((task) =>
          task.status === 'planned' &&
          task.hypothesisIds.length > 0 &&
          task.hypothesisIds.every((hypothesisId) => eliminatedIds.has(hypothesisId))
            ? {
                ...task,
                status: 'rejected' as const,
                blockedReason: '绑定的候选假设已通过严格淘汰门槛，不再进入活跃执行队列。',
              }
            : task,
        )
        // librarian.generate emits the initial candidate rows. Publish the adjudicated
        // rows again so live/replayed clients do not remain stuck on the
        // pre-verification status while oracle.verify has already reached a verdict.
        for (const hypothesis of hypotheses) {
          emit(input, 'scientific.hypothesis', {
            round: state.round,
            hypothesis,
            adjudicated: true,
          })
        }
        for (const report of verificationReports) {
          emit(input, 'scientific.verification-report', {
            round: state.round,
            report,
          })
        }
        const hasDecisiveEvidence = hasCorroboratedSupport || hasAuditableContradiction
        const adjudicationExecution = {
          agentId: 'sisyphus',
          label: '闭环协调智能体：证据门禁与裁决',
          stage: 'oracle' as const,
          status: 'completed' as const,
          capabilities: ['cross-validation', 'fact-check'],
          round: state.round,
          outputHypothesisIds: hypotheses.map((item) => item.id),
          outputEvidenceIds: evidence.map((item) => item.evidenceId),
          outputTaskIds: [],
        }
        if (
          !hasDecisiveEvidence &&
          /已证明|已证实|确认.*主导|机制成立|得到支持|支持.*机制/.test(state.conclusion)
        ) {
          const item = correction(
            'oracle',
            'factual',
            'warning',
            '结论强度超过当前可验证证据边界。',
            '改写为候选机制和未知状态，并保留下一步验证计划。',
            state.round,
            ['oracle.verify'],
          )
          return {
            conclusion: boundedConclusion(state.hypotheses, evidence),
            corrections: appendCorrections(input, corrections, [item]),
            limitations: appendLimitations(state.limitations, [
              ...verificationLimitations,
              item.message,
            ]),
            hypotheses,
            evidence,
            verificationReports,
            validationTasks,
            agentExecutions: appendStageExecution(state, adjudicationExecution),
          }
        }
        return {
          hypotheses,
          evidence,
          verificationReports,
          validationTasks,
          agentExecutions: appendStageExecution(state, adjudicationExecution),
          corrections,
          limitations: appendLimitations(state.limitations, verificationLimitations),
        }
      }),
    )
    .addNode('prometheus.plan', async (state) =>
      node(state, 'prometheus.plan', async () => {
        const context = buildScientificContext({ stage: 'prometheus', state })
        const planned = dependencies.planValidation
          ? await dependencies.planValidation({
              projectId: state.projectId,
              runId: state.runId,
              round: state.round,
              phenomenon: state.phenomenon,
              context,
              hypotheses: state.hypotheses,
              evidence: state.evidence,
              conclusion: state.conclusion,
              signal: input.abortSignal,
            })
          : []
        const validTasks: ValidationTask[] = []
        let corrections = state.corrections
        for (const candidate of planned) {
          const parsed = ValidationTaskSchema.safeParse(candidate)
          if (parsed.success) {
            validTasks.push(
              withPreregisteredDetectability(normalizeValidationReadiness(parsed.data)),
            )
          } else {
            const item = correction(
              'prometheus',
              'schema',
              'error',
              '下一步验证计划结构校验失败，已拒绝进入下一轮。',
              '要求 Prometheus 阶段补齐可区分结果和触发来源。',
              state.round,
              ['prometheus.plan'],
            )
            corrections = appendCorrections(input, corrections, [item])
          }
        }
        const existingTaskKeys = new Set(state.validationTasks.map(validationTaskDeduplicationKey))
        const stateTaskBySemanticKey = new Map<string, ValidationTask>()
        for (const existing of state.validationTasks) {
          const semanticKey = externalTaskSemanticKey(existing)
          if (semanticKey) stateTaskBySemanticKey.set(semanticKey, existing)
        }
        const mergedStateTasks = new Map<string, ValidationTask>()
        const batchBySemanticKey = new Map<string, ValidationTask>()
        const candidateTasks: ValidationTask[] = []
        for (const task of deduplicateValidationTasks(validTasks)) {
          const key = validationTaskDeduplicationKey(task)
          if (existingTaskKeys.has(key)) continue
          existingTaskKeys.add(key)
          const semanticKey = externalTaskSemanticKey(task)
          if (semanticKey) {
            const stateMatch = stateTaskBySemanticKey.get(semanticKey)
            if (stateMatch) {
              mergedStateTasks.set(
                stateMatch.taskId,
                mergeValidationTaskRequirements(stateMatch, task),
              )
              continue
            }
            const batchMatch = batchBySemanticKey.get(semanticKey)
            if (batchMatch) {
              const merged = mergeValidationTaskRequirements(batchMatch, task)
              batchBySemanticKey.set(semanticKey, merged)
              const index = candidateTasks.findIndex(
                (candidate) => candidate.taskId === batchMatch.taskId,
              )
              if (index >= 0) candidateTasks[index] = merged
              continue
            }
            batchBySemanticKey.set(semanticKey, task)
          }
          candidateTasks.push(task)
        }
        const executableCandidates: ValidationTask[] = []
        const deferredTasks: ValidationTask[] = []
        for (const task of candidateTasks) {
          const inferredReadiness = inferValidationReadiness(task)
          const executable = dependencies.canExecuteValidationTask
            ? await dependencies.canExecuteValidationTask(task)
            : inferredReadiness === 'executable_now' ||
              (inferredReadiness === 'unassessed' && !task.executorId && !task.readiness)
          ;(executable ? executableCandidates : deferredTasks).push(task)
        }
        // A task accepted in the final round can never reach explorer.analyze. Keep
        // deferred/external work as an honest future plan, but do not register
        // new local work that the configured run budget cannot execute.
        const atExecutionBoundary = state.round >= state.maxRounds
        const executableTasks = atExecutionBoundary ? [] : executableCandidates
        const omittedExecutableTasks = atExecutionBoundary ? executableCandidates : []
        const acceptedTaskIds = new Set([
          ...executableTasks.map((task) => task.taskId),
          ...deferredTasks.map((task) => task.taskId),
        ])
        const newTasks = candidateTasks.filter((task) => acceptedTaskIds.has(task.taskId))
        const validationTasks = upsertById(
          state.validationTasks,
          [...mergedStateTasks.values(), ...newTasks],
          'taskId',
        )
        if (mergedStateTasks.size > 0) {
          const item = correction(
            'prometheus',
            'execution',
            'info',
            `prometheus.plan 将 ${mergedStateTasks.size} 项语义重复的外部数据需求合并到既有任务，绑定其假设与预测覆盖而非简单删除。`,
            '以合并后的任务作为该数据需求的唯一追踪入口。',
            state.round,
            [...mergedStateTasks.keys()],
            [...mergedStateTasks.keys()],
            'prometheus.plan',
          )
          corrections = appendCorrections(input, corrections, [item])
        }
        for (const task of newTasks) {
          emit(input, 'scientific.validation-task', {
            round: state.round,
            task,
            route: decideNextRoute(task),
            executableNow: executableTasks.some((item) => item.taskId === task.taskId),
          })
        }
        if (deferredTasks.length > 0) {
          const item = correction(
            'prometheus',
            'execution',
            'warning',
            `本轮有 ${deferredTasks.length} 项验证任务没有已注册的执行器，已保留为 planned，但不会伪装成下一轮已执行工作。`,
            '实现并登记对应数据处理器、模拟器或人工复核入口后，再恢复这些任务。',
            state.round,
            deferredTasks.map((task) => task.triggeredBy),
            deferredTasks.map((task) => task.taskId),
            'prometheus.plan',
          )
          corrections = appendCorrections(input, corrections, [item])
        }
        if (omittedExecutableTasks.length > 0) {
          const item = correction(
            'prometheus',
            'execution',
            'info',
            `最终轮规划器又建议了 ${omittedExecutableTasks.length} 项本地可执行任务；由于已无后续执行轮，这些建议未登记为 planned，避免产生伪待办。`,
            '如需扩展搜索深度，应提高 maxRounds 后重新运行；当前结果仅报告本轮以前已登记并实际执行的本地任务。',
            state.round,
            omittedExecutableTasks.map((task) => task.triggeredBy),
            [],
            'prometheus.plan',
          )
          corrections = appendCorrections(input, corrections, [item])
        }
        // Stale executable work: a task that still claims `executable_now` but
        // that no registered executor can claim is not actually executable.
        // At the execution boundary there is no further explorer.analyze to claim it, so
        // leaving it planned would block workflowClosure forever with a false
        // promise. Downgrade it honestly to requires_data with the reason, so
        // registering the executor later can restore it.
        const staleExecutableTaskIds = new Set<string>()
        if (atExecutionBoundary && dependencies.canExecuteValidationTask) {
          for (const task of validationTasks) {
            if (task.status !== 'planned' || task.readiness !== 'executable_now') continue
            const claimable = await dependencies.canExecuteValidationTask(task)
            if (!claimable) staleExecutableTaskIds.add(task.taskId)
          }
        }
        const finalValidationTasks =
          staleExecutableTaskIds.size === 0
            ? validationTasks
            : validationTasks.map((task) =>
                staleExecutableTaskIds.has(task.taskId)
                  ? {
                      ...task,
                      readiness: 'requires_data' as const,
                      blockedReason:
                        task.blockedReason ??
                        '执行器无法认领该任务（认领失败）；诚实降级为 requires_data，登记执行器后可恢复。',
                    }
                  : task,
              )
        if (staleExecutableTaskIds.size > 0) {
          const item = correction(
            'prometheus',
            'execution',
            'warning',
            `终局发现 ${staleExecutableTaskIds.size} 项登记为 executable_now 的任务没有已注册执行器可认领，已诚实降级为 requires_data 并保留恢复路径，不再阻塞流程闭环。`,
            '实现并登记对应执行器后即可恢复该任务；不得把认领失败伪装成已完成或永久待办。',
            state.round,
            [...staleExecutableTaskIds],
            [...staleExecutableTaskIds],
            'prometheus.plan',
          )
          corrections = appendCorrections(input, corrections, [item])
        }
        emit(input, 'scientific.reasoning-summary', {
          stage: 'prometheus',
          round: state.round,
          agentId: 'prometheus-planner',
          title: '下一步验证计划',
          summary:
            newTasks.length > 0
              ? `${compactSummary(newTasks.slice(0, 4).map((task) => `${task.type}：${task.objective}`))}；其中 ${executableTasks.length} 项当前可执行，${deferredTasks.length} 项等待执行器或外部数据。`
              : omittedExecutableTasks.length > 0
                ? `已到最终执行轮；${omittedExecutableTasks.length} 项新出现的本地建议未登记，避免留下无法执行的 executable_now 任务。`
                : '本轮没有生成新的可区分验证任务，后续不继续消耗计算预算。',
        })
        return {
          validationTasks: finalValidationTasks,
          roundTaskIds: executableTasks.map((task) => task.taskId),
          newTaskCount: executableTasks.length,
          budgetDeferredTaskCount: Math.max(
            state.budgetDeferredTaskCount,
            omittedExecutableTasks.length,
          ),
          completedRounds: Math.max(state.completedRounds, state.round),
          agentExecutions: appendStageExecution(state, {
            agentId: 'prometheus',
            label: '验证设计智能体：任务规划与预算审计',
            stage: 'prometheus',
            status: 'completed',
            capabilities: ['cross-validation', 'fact-check'],
            round: state.round,
            outputHypothesisIds: [],
            outputEvidenceIds: [],
            outputTaskIds: newTasks.map((task) => task.taskId),
          }),
          corrections,
        }
      }),
    )
    .addNode('prometheus.route', async (state) =>
      node(state, 'prometheus.route', async () => {
        const roundTaskIds = new Set(state.roundTaskIds)
        const hasBlockingDeferredTask = state.validationTasks.some(
          (task) =>
            task.round === state.round &&
            task.status === 'planned' &&
            !roundTaskIds.has(task.taskId) &&
            // A human-review item is an intentional external handoff. It is
            // reported in dataReadiness, but does not override the run's
            // computational budget when no human channel is attached.
            task.readiness !== 'human_review',
        )
        const decision = shouldContinueScientificLoop({
          round: state.round,
          maxRounds: state.maxRounds,
          newEvidence: state.newEvidenceCount,
          newTasks: state.newTaskCount,
          hasExecutableTask: state.roundTaskIds.length > 0,
          hasDeferredTask: hasBlockingDeferredTask,
        })
        const nextRoute = state.roundTaskIds
          .map((taskId) => state.validationTasks.find((task) => task.taskId === taskId))
          .filter((task): task is ValidationTask => Boolean(task))
          .some((task) => decideNextRoute(task) === 'librarian')
          ? ('librarian' as const)
          : ('explorer' as const)
        let finalDecision: {
          continue: boolean
          reason: ScientificGraphState['terminationReason']
        } = decision
        // Optional human approval gate: only fires when explicitly armed
        // (`plan_review`). It decides whether the loop continues — it can
        // never change a hypothesis status, a gate verdict, or evidence.
        if (decision.continue && input.humanChannel?.hasGate()) {
          const summary = compactSummary([
            `第 ${state.round} 轮完成；继续原因：${decision.reason}`,
            `新增证据 ${state.newEvidenceCount} 条、新增可执行任务 ${state.newTaskCount} 项`,
            `下一轮路由：${nextRoute}`,
          ])
          emit(input, 'scientific.human-gate-request', {
            round: state.round,
            kind: 'plan_review',
            summary,
          })
          const gate = await input.humanChannel.requestGate(
            { kind: 'plan_review', round: state.round, summary },
            input.abortSignal,
          )
          humanRecords.gates.push(
            ScientificHumanGateRecordSchema.parse({
              gateId: gate.gateId,
              kind: gate.kind,
              round: gate.round,
              summary,
              approved: gate.approved,
              source: gate.source,
              ...(gate.reason !== undefined ? { reason: gate.reason } : {}),
              decidedAt: gate.decidedAt,
            }),
          )
          emit(input, 'scientific.human-gate-result', { round: state.round, gate })
          if (!gate.approved) {
            finalDecision = { continue: false, reason: 'human_halted_at_plan_review' }
          }
        }
        emit(input, 'scientific.route', {
          round: state.round,
          continue: finalDecision.continue,
          reason: finalDecision.reason,
          nextRoute: finalDecision.continue ? nextRoute : 'END',
        })
        return finalDecision.continue
          ? {
              round: state.round + 1,
              nextRoute,
              terminationReason: null,
            }
          : {
              nextRoute: 'END' as const,
              terminationReason: finalDecision.reason,
            }
      }),
    )
    .addEdge(START, 'librarian.generate')
    .addEdge('librarian.generate', 'self-correction-i.verify')
    .addConditionalEdges('self-correction-i.verify', (state) =>
      state.terminationReason === 'no_valid_hypotheses' ? END : 'surveyor.analyze',
    )
    .addEdge('surveyor.analyze', 'explorer.analyze')
    .addEdge('explorer.analyze', 'self-correction-ii.verify')
    .addEdge('self-correction-ii.verify', 'oracle.verify')
    .addEdge('oracle.verify', 'oracle.synthesize')
    .addEdge('oracle.synthesize', 'prometheus.plan')
    .addEdge('prometheus.plan', 'prometheus.route')
    .addConditionalEdges('prometheus.route', (state) => {
      if (state.nextRoute === 'END') return END
      // Every iteration re-enters through surveyor.analyze so later rounds get
      // a fresh deterministic re-prioritization of the task queue, matching the
      // P3 contract that each round starts from the global coarse analysis.
      return state.nextRoute === 'librarian' ? 'librarian.generate' : 'surveyor.analyze'
    })
    .compile({ checkpointer: runtime.checkpointer })

  return graph
}

export async function runScientificLoopGraph(
  input: ScientificGraphInput,
  dependencies: ScientificGraphDependencies,
): Promise<ScientificGraphResult> {
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new Error('maxRounds must be a positive integer')
  }
  const runtime = input.runtime ?? createInMemoryScientificRuntime()
  const humanRecords: ScientificHumanInteractionRecords = { steering: [], gates: [] }
  const graph = createScientificLoopGraph(input, dependencies, runtime, humanRecords)
  const config = runtime.config(input.projectId, input.runId)
  try {
    let phenomenon = input.phenomenon
    if (input.resume && !phenomenon) {
      const checkpoint = await graph.getState(config)
      phenomenon = checkpoint.values?.phenomenon
      if (!phenomenon) {
        throw new Error('No phenomenon is available in the scientific checkpoint')
      }
    }
    if (!phenomenon) {
      throw new Error('phenomenon is required when starting a scientific loop')
    }
    const initialState = {
      projectId: input.projectId,
      runId: input.runId,
      phenomenon,
      round: 1,
      maxRounds,
      hypotheses: [],
      hypothesisCoverage: fallbackHypothesisCoverage([]),
      evidence: [],
      validationTasks: [],
      corrections: [],
      agentExecutions: [],
      limitations: [],
      conclusion: '',
      newEvidenceCount: 0,
      newTaskCount: 0,
      budgetDeferredTaskCount: 0,
      roundTaskIds: [],
      completedRounds: 0,
      nextRoute: 'explorer' as const,
      terminationReason: null,
    }
    if (!input.resume) {
      emit(input, 'scientific.phenomenon', {
        phenomenon,
        inputDigest: phenomenon.inputDigest ?? digest(phenomenon),
        round: 1,
      })
    }
    const state = await graph.invoke(input.resume ? null : initialState, config)
    const result = resultFromState(state as ScientificGraphState)
    return {
      ...result,
      ...(humanRecords.steering.length > 0 ? { humanSteering: humanRecords.steering } : {}),
      ...(humanRecords.gates.length > 0 ? { humanGates: humanRecords.gates } : {}),
    }
  } finally {
    if (!input.runtime) runtime.close()
  }
}
