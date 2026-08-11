import { createHash } from 'node:crypto'
import {
  END,
  START,
  StateGraph,
} from '@langchain/langgraph'
import {
  AgentExecutionSchema,
  EvidenceRecordSchema,
  ScientificCorrectionSchema,
  ScientificHypothesisSchema,
  ScientificLoopResultSchema,
  ValidationTaskSchema,
  type AgentExecution,
  type EvidenceRecord,
  type ScientificCorrection,
  type ScientificHypothesis,
  type ScientificLoopResult,
  type ValidationTask,
} from '@open-scientist/schema'
import type { UIMessageChunk } from 'ai'
import {
  createInMemoryScientificRuntime,
  type ScientificGraphRuntime,
} from '../orchestration/langgraph-runtime.ts'
import { buildScientificContext } from './context-builder.ts'
import { runLangGraphEvidenceWorkgroup } from './evidence-subgraph.ts'
import type {
  EvidenceAgentCorrection,
  EvidenceAgentExecution,
  EvidenceAgentStateEvent,
  EvidenceWorkgroupResult,
} from './evidence-workgroup.ts'
import { promoteEvidence } from './evidence-promotion.ts'
import {
  decideNextRoute,
  deduplicateValidationTasks,
  shouldContinueScientificLoop,
  summarizeEvidence,
} from './loop-logic.ts'
import {
  ScientificGraphStateSchema,
  type ScientificGraphState,
} from './graph-state.ts'
import type {
  ScientificGraphDependencies,
  ScientificGraphInput,
} from './services.ts'

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

function mergeWorkgroupResults(results: readonly EvidenceWorkgroupResult[]): EvidenceWorkgroupResult {
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
  const text = values.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean).join('；')
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
): ScientificCorrection {
  const triggerIds = uniqueStrings(
    triggeredBy.length > 0 ? triggeredBy : ['round-' + round],
  )
  return ScientificCorrectionSchema.parse({
    correctionId: 'correction-' + digest({
      stage,
      kind,
      severity,
      message,
      action,
      round,
      triggerIds,
      affectedIds,
      agentId,
    }).slice(0, 16),
    stage,
    kind,
    severity,
    message,
    action,
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
  for (const item of incoming) {
    if (seen.has(item.correctionId)) continue
    seen.add(item.correctionId)
    result.push(item)
    emit(input, 'scientific.self-correction', { correction: item })
  }
  return result
}

function appendLimitations(
  current: readonly string[],
  incoming: readonly string[],
): string[] {
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

function mapAgentCorrection(
  raw: EvidenceAgentCorrection,
  round: number,
  agentId: string,
): ScientificCorrection {
  const lower = raw.stage.toLowerCase() + raw.message.toLowerCase()
  const stage: ScientificCorrection['stage'] = lower.startsWith('a')
    ? 'A'
    : lower.startsWith('c')
      ? 'C'
      : lower.startsWith('d')
        ? 'D'
        : 'B'
  const kind: ScientificCorrection['kind'] = /schema|结构/.test(lower)
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
  )
}

function mapAgentExecution(
  execution: EvidenceAgentExecution,
  round: number,
  evidenceIds: readonly string[],
  taskIds: readonly string[],
): AgentExecution {
  return AgentExecutionSchema.parse({
    agentId: execution.agentId,
    label: execution.label,
    stage: 'B',
    status: execution.status,
    capabilities: execution.capabilities,
    round,
    ...(execution.error ? { error: execution.error } : {}),
    outputEvidenceIds: uniqueStrings(evidenceIds),
    outputTaskIds: uniqueStrings(taskIds),
  })
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
    corrections.push(correction(
      'A',
      'schema',
      'error',
      '候选假设结构校验失败，已拒绝进入 State。',
      '保留校正记录，并要求 A 阶段补齐可观测预测和证伪条件。',
      round,
      ['A.generate'],
    ))
  }
  return { hypotheses: upsertById([], hypotheses, 'id'), corrections }
}

function safeUnknownEvidence(
  evidence: EvidenceRecord,
  message: string,
): EvidenceRecord {
  return EvidenceRecordSchema.parse({
    ...evidence,
    status: 'unknown',
    limitations: uniqueStrings([...evidence.limitations, message]),
  })
}

function boundedConclusion(
  hypotheses: readonly ScientificHypothesis[],
  evidence: readonly EvidenceRecord[],
): string {
  const summary = summarizeEvidence(evidence)
  if (summary.support === 0 && summary.contradict === 0) {
    return `本轮保留 ${hypotheses.length} 个候选机制组合；现有证据尚未形成支持或反驳任何机制的可重复结果。下一步应优先完成数据对齐、处理和反例核验。`
  }
  return `本轮得到支持 ${summary.support} 条、反驳 ${summary.contradict} 条、未知 ${summary.unknown} 条；结论仅限于已绑定数据处理产物和当前观测窗口，仍需按下一步验证计划复核。`
}

function resultFromState(state: ScientificGraphState): ScientificGraphResult {
  const terminationReason = state.terminationReason ?? 'no_new_evidence_or_tasks'
  const conclusion = state.conclusion.trim() ||
    '未形成可验证结论：当前输入尚未产生满足结构与来源约束的候选假设。'
  const parsed = ScientificLoopResultSchema.parse({
    runId: state.runId,
    status: terminationReason === 'no_valid_hypotheses' ? 'blocked' : 'completed',
    totalRounds: state.completedRounds,
    hypotheses: state.hypotheses,
    evidence: state.evidence,
    validationTasks: state.validationTasks,
    conclusion,
    nextValidationPlan: state.validationTasks.filter((task) => task.status === 'planned'),
    terminationReason,
  })
  return {
    ...parsed,
    corrections: state.corrections,
    limitations: state.limitations,
    agentExecutions: state.agentExecutions,
  }
}

export function createScientificLoopGraph(
  input: ScientificGraphInput,
  dependencies: ScientificGraphDependencies,
  runtime: ScientificGraphRuntime,
) {
  const node = async (
    state: ScientificGraphState,
    name: string,
    work: () => Promise<Partial<ScientificGraphState>> | Partial<ScientificGraphState>,
  ): Promise<Partial<ScientificGraphState>> => {
    throwIfAborted(input.abortSignal)
    emitNode(input, name, 'running', state.round)
    const update = await work()
    emitNode(input, name, 'completed', state.round)
    return update
  }

  const graph = new StateGraph(ScientificGraphStateSchema)
    .addNode('A.generate', async (state) => node(
      state,
      'A.generate',
      async () => {
        const context = buildScientificContext({ stage: 'A', state })
        const generation = await dependencies.generateHypotheses({
          projectId: state.projectId,
          runId: state.runId,
          round: state.round,
          phenomenon: state.phenomenon,
          context,
          existingHypotheses: state.hypotheses,
          signal: input.abortSignal,
        })
        const generated = Array.isArray(generation) ? generation : generation.hypotheses
        const generationCorrections = Array.isArray(generation)
          ? []
          : (generation.corrections ?? []).flatMap((item) => {
            const parsed = ScientificCorrectionSchema.safeParse(item)
            return parsed.success ? [parsed.data] : []
          })
        const checked = safeHypotheses(generated, state.round)
        const hypotheses = checked.hypotheses.length > 0
          ? upsertById(state.hypotheses, checked.hypotheses, 'id')
          : state.hypotheses
        for (const hypothesis of checked.hypotheses) {
          emit(input, 'scientific.hypothesis', { round: state.round, hypothesis })
        }
        return {
          hypotheses,
          corrections: appendCorrections(input, state.corrections, [
            ...generationCorrections,
            ...checked.corrections,
          ]),
          limitations: appendLimitations(
            state.limitations,
            [...generationCorrections, ...checked.corrections].map((item) => item.message),
          ),
        }
      },
    ))
    .addNode('A.verify', async (state) => node(
      state,
      'A.verify',
      () => {
        const valid = state.hypotheses.filter((item) =>
          ScientificHypothesisSchema.safeParse(item).success,
        )
        if (valid.length === 0) {
          const generationFailure = [...state.corrections].reverse().find((item) =>
            item.stage === 'A' && item.round === state.round && item.severity === 'error',
          )
          const item = generationFailure ?? correction(
            'A',
            'schema',
            'error',
            '本轮没有满足结构约束的候选假设。',
            '停止后续证据判断，要求补充可观测预测、证伪条件或有效输入。',
            state.round,
            ['A.verify'],
          )
          return {
            hypotheses: [],
            terminationReason: 'no_valid_hypotheses' as const,
            corrections: generationFailure ? state.corrections : appendCorrections(input, state.corrections, [item]),
            limitations: appendLimitations(state.limitations, [item.message]),
          }
        }
        return {
          hypotheses: valid,
          terminationReason: null,
        }
      },
    ))
    .addNode('B.run', async (state) => node(
      state,
      'B.run',
      async () => {
        const context = buildScientificContext({ stage: 'B', state })
        const registered = typeof dependencies.evidenceAgents === 'function'
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
        const agentKinds = new Map(registered.map((agent) => [
          agent.id,
          agent.executionKind ?? 'deterministic',
        ]))
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
          round: context.round,
          signal: input.abortSignal,
        }

        // Data computation and provenance checks remain parallel.  Model
        // workers run afterwards in a deliberate order so every reviewer can
        // inspect real upstream records and the previous model review.
        if (deterministicAgents.length > 0) {
          workgroupResults.push(await runLangGraphEvidenceWorkgroup(
            deterministicAgents,
            baseContext,
            { signal: input.abortSignal, onAgentState },
          ))
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
            stage: 'B',
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

        for (const raw of workgroup.corrections) {
          const item = mapAgentCorrection(raw, state.round, 'evidence-workgroup')
          corrections = appendCorrections(input, corrections, [item])
        }
        for (const execution of workgroup.executions) {
          if (execution.status !== 'failed') continue
          const item = correction(
            'B',
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

        const evidence = upsertById(state.evidence, promoted, 'evidenceId')
        const tasks: ValidationTask[] = []
        const taskCorrections: ScientificCorrection[] = []
        for (const candidate of workgroup.validationTasks) {
          const parsed = ValidationTaskSchema.safeParse(candidate)
          if (parsed.success) {
            tasks.push(parsed.data)
          } else {
            taskCorrections.push(correction(
              'B',
              'schema',
              'error',
              'B 阶段生成的验证任务结构校验失败，已拒绝进入 State。',
              '要求数据处理智能体补齐任务目标和可区分结果。',
              state.round,
              ['B.run'],
            ))
          }
        }
        corrections = appendCorrections(input, corrections, taskCorrections)
        for (const item of promoted) {
          emit(input, 'scientific.evidence', { round: state.round, evidence: item })
        }
        const currentIds = new Set(state.evidence.map((item) => item.evidenceId))
        const newEvidenceCount = promoted.filter((item) => !currentIds.has(item.evidenceId)).length
        const executions = workgroup.executions.map((item) => {
          const outputIds = item.output?.evidence?.map((evidence) => evidence.evidenceId) ?? []
          const taskIds = item.output?.validationTasks?.map((task) => task.taskId) ?? []
          return mapAgentExecution(item, state.round, outputIds, taskIds)
        })
        for (const execution of workgroup.executions) {
          if (execution.status === 'skipped') continue
          const output = execution.output
          const evidenceRows = output?.evidence?.map((item) =>
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
              stage: 'B',
              round: state.round,
              agentId: execution.agentId,
              title: `${execution.label}的核验摘要`,
              summary,
            })
          }
        }
        const executionKeys = new Set(state.agentExecutions.map((item) => item.agentId + ':' + item.round))
        const mergedExecutions = [...state.agentExecutions]
        for (const execution of executions) {
          const key = execution.agentId + ':' + execution.round
          if (!executionKeys.has(key)) {
            executionKeys.add(key)
            mergedExecutions.push(execution)
          }
        }
        return {
          evidence,
          validationTasks: upsertById(state.validationTasks, tasks, 'taskId'),
          agentExecutions: mergedExecutions,
          corrections,
          limitations: appendLimitations(
            state.limitations,
            [...workgroup.limitations, ...promotionLimitations],
          ),
          newEvidenceCount,
        }
      },
    ))
    .addNode('BC.verify', async (state) => node(
      state,
      'BC.verify',
      async () => {
        let corrections = state.corrections
        const evidence: EvidenceRecord[] = []
        const limitations: string[] = []
        for (const candidate of state.evidence) {
          const result = await promoteEvidence(candidate, {
            stage: 'C',
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
      },
    ))
    .addNode('C.synthesize', async (state) => node(
      state,
      'C.synthesize',
      async () => {
        const context = buildScientificContext({ stage: 'C', state })
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
        const normalizedConclusion = conclusion.trim() || boundedConclusion(state.hypotheses, state.evidence)
        emit(input, 'scientific.round-summary', { round: state.round, conclusion: normalizedConclusion, evidenceSummary: summarizeEvidence(state.evidence) })
        emit(input, 'scientific.reasoning-summary', {
          stage: 'C',
          round: state.round,
          agentId: 'sisyphus-synthesis',
          title: '结论如何收敛',
          summary: normalizedConclusion,
        })
        return {
          conclusion: normalizedConclusion,
        }
      },
    ))
    .addNode('C.verify', async (state) => node(
      state,
      'C.verify',
      () => {
        const summary = summarizeEvidence(state.evidence)
        let corrections = state.corrections
        const verificationLimitations: string[] = []
        let hasCorroboratedSupport = false
        const hypotheses = state.hypotheses.map((hypothesis) => {
          const related = state.evidence.filter((item) => item.hypothesisId === hypothesis.id)
          const supportRecords = related.filter((item) => item.status === 'support')
          const processingRuns = new Set(
            supportRecords.flatMap((item) => item.provenance?.processingRunId ?? []),
          )
          const methods = new Set(supportRecords.map((item) => item.method))
          const support = supportRecords.length > 0
          const contradict = related.some((item) => item.status === 'contradict')
          // A single non-unique diagnostic from one processing run is not
          // enough to promote a mechanism. Require two independently
          // generated processing runs and two methods before `supported`.
          const corroborated = supportRecords.length >= 2
            && processingRuns.size >= 2
            && methods.size >= 2
          hasCorroboratedSupport ||= corroborated && !contradict
          const status = corroborated && !contradict
            ? 'supported' as const
            : support || contradict
              ? 'uncertain' as const
              : 'candidate' as const
          const confidenceDelta = corroborated && !contradict
            ? 0.08
            : contradict
              ? -0.04
              : support
                ? 0.03
                : 0
          if (support && !corroborated) {
            const item = correction(
              'C',
              'factual',
              'warning',
              `假设“${hypothesis.statement}”只有单一处理运行或单一方法的非唯一支持，不能升级为 supported。`,
              '保持 uncertain；补充独立处理运行和不同诊断方法后再复核。',
              state.round,
              supportRecords.map((record) => record.evidenceId),
              [hypothesis.id, ...supportRecords.map((record) => record.evidenceId)],
              'C.verify',
            )
            corrections = appendCorrections(input, corrections, [item])
            verificationLimitations.push(item.message)
          }
          return {
            ...hypothesis,
            status,
            confidence: Math.max(0, Math.min(1, hypothesis.confidence + confidenceDelta)),
          }
        })
        const hasDecisiveEvidence = hasCorroboratedSupport || summary.contradict > 0
        if (!hasDecisiveEvidence && /已证明|已证实|确认.*主导|机制成立|得到支持|支持.*机制/.test(state.conclusion)) {
          const item = correction(
            'C',
            'factual',
            'warning',
            '结论强度超过当前可验证证据边界。',
            '改写为候选机制和未知状态，并保留下一步验证计划。',
            state.round,
            ['C.verify'],
          )
          return {
            conclusion: boundedConclusion(state.hypotheses, state.evidence),
            corrections: appendCorrections(input, corrections, [item]),
            limitations: appendLimitations(state.limitations, [...verificationLimitations, item.message]),
            hypotheses,
          }
        }
        return {
          hypotheses,
          corrections,
          limitations: appendLimitations(state.limitations, verificationLimitations),
        }
      },
    ))
    .addNode('D.plan', async (state) => node(
      state,
      'D.plan',
      async () => {
        const context = buildScientificContext({ stage: 'D', state })
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
            validTasks.push(parsed.data)
          } else {
            const item = correction(
              'D',
              'schema',
              'error',
              '下一步验证计划结构校验失败，已拒绝进入下一轮。',
              '要求 D 阶段补齐可区分结果和触发来源。',
              state.round,
              ['D.plan'],
            )
            corrections = appendCorrections(input, corrections, [item])
          }
        }
        const existingFingerprints = new Set(state.validationTasks.map((task) => task.fingerprint))
        const newTasks = deduplicateValidationTasks(validTasks)
          .filter((task) => !existingFingerprints.has(task.fingerprint))
        const validationTasks = upsertById(state.validationTasks, newTasks, 'taskId')
        const executableTasks: ValidationTask[] = []
        const deferredTasks: ValidationTask[] = []
        for (const task of newTasks) {
          const executable = dependencies.canExecuteValidationTask
            ? await dependencies.canExecuteValidationTask(task)
            : true
          ;(executable ? executableTasks : deferredTasks).push(task)
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
            'D',
            'execution',
            'warning',
            `本轮有 ${deferredTasks.length} 项验证任务没有已注册的执行器，已保留为 planned，但不会伪装成下一轮已执行工作。`,
            '实现并登记对应数据处理器、模拟器或人工复核入口后，再恢复这些任务。',
            state.round,
            deferredTasks.map((task) => task.triggeredBy),
            deferredTasks.map((task) => task.taskId),
            'D.plan',
          )
          corrections = appendCorrections(input, corrections, [item])
        }
        emit(input, 'scientific.reasoning-summary', {
          stage: 'D',
          round: state.round,
          agentId: 'prometheus-planner',
          title: '下一步验证计划',
          summary: newTasks.length > 0
            ? `${compactSummary(newTasks.slice(0, 4).map((task) => `${task.type}：${task.objective}`))}；其中 ${executableTasks.length} 项当前可执行，${deferredTasks.length} 项等待执行器或外部数据。`
            : '本轮没有生成新的可区分验证任务，后续不继续消耗计算预算。',
        })
        return {
          validationTasks,
          roundTaskIds: executableTasks.map((task) => task.taskId),
          newTaskCount: executableTasks.length,
          completedRounds: Math.max(state.completedRounds, state.round),
          corrections,
        }
      },
    ))
    .addNode('D.route', async (state) => node(
      state,
      'D.route',
      () => {
        const roundTaskIds = new Set(state.roundTaskIds)
        const hasDeferredTask = state.validationTasks.some((task) =>
          task.round === state.round
          && task.status === 'planned'
          && !roundTaskIds.has(task.taskId))
        const decision = shouldContinueScientificLoop({
          round: state.round,
          maxRounds: state.maxRounds,
          newEvidence: state.newEvidenceCount,
          newTasks: state.newTaskCount,
          hasExecutableTask: state.roundTaskIds.length > 0,
          hasDeferredTask,
        })
        const nextRoute = state.roundTaskIds
          .map((taskId) => state.validationTasks.find((task) => task.taskId === taskId))
          .filter((task): task is ValidationTask => Boolean(task))
          .some((task) => decideNextRoute(task) === 'A')
          ? 'A' as const
          : 'B' as const
        emit(input, 'scientific.route', {
          round: state.round,
          continue: decision.continue,
          reason: decision.reason,
          nextRoute: decision.continue ? nextRoute : 'END',
        })
        return decision.continue
          ? {
            round: state.round + 1,
            nextRoute,
            terminationReason: null,
          }
          : {
            nextRoute: 'END' as const,
            terminationReason: decision.reason,
          }
      },
    ))
    .addEdge(START, 'A.generate')
    .addEdge('A.generate', 'A.verify')
    .addConditionalEdges('A.verify', (state) =>
      state.terminationReason === 'no_valid_hypotheses' ? END : 'B.run')
    .addEdge('B.run', 'BC.verify')
    .addEdge('BC.verify', 'C.synthesize')
    .addEdge('C.synthesize', 'C.verify')
    .addEdge('C.verify', 'D.plan')
    .addEdge('D.plan', 'D.route')
    .addConditionalEdges('D.route', (state) => {
      if (state.nextRoute === 'END') return END
      return state.nextRoute === 'A' ? 'A.generate' : 'B.run'
    })
    .compile({ checkpointer: runtime.checkpointer })

  return graph
}

export async function runScientificLoopGraph(
  input: ScientificGraphInput,
  dependencies: ScientificGraphDependencies,
): Promise<ScientificGraphResult> {
  const phenomenon = input.phenomenon
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new Error('maxRounds must be a positive integer')
  }
  const runtime = input.runtime ?? createInMemoryScientificRuntime()
  const graph = createScientificLoopGraph(input, dependencies, runtime)
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
      evidence: [],
      validationTasks: [],
      corrections: [],
      agentExecutions: [],
      limitations: [],
      conclusion: '',
      newEvidenceCount: 0,
      newTaskCount: 0,
      roundTaskIds: [],
      completedRounds: 0,
      nextRoute: 'B' as const,
      terminationReason: null,
    }
    emit(input, 'scientific.phenomenon', {
      phenomenon,
      inputDigest: digest(phenomenon),
      round: 1,
    })
    const state = await graph.invoke(
      input.resume ? null : initialState,
      config,
    )
    const result = resultFromState(state as ScientificGraphState)
    emit(input, 'scientific.loop-complete', { result })
    return result
  } finally {
    if (!input.runtime) runtime.close()
  }
}
