import {
  DataReadinessSummarySchema,
  CounterexampleSearchAssessmentSchema,
  HypothesisClosureReportSchema,
  ScientificOutcomeProfileSchema,
  WorkflowClosureSummarySchema,
  scientificFalsificationConditionId,
  scientificPredictionId,
  type DataReadinessSummary,
  type CounterexampleSearchAssessment,
  type EvidenceRecord,
  type HypothesisClosureReport,
  type HypothesisRunDisposition,
  type HypothesisVerificationReport,
  type ScientificHypothesis,
  type ScientificOutcomeProfile,
  type ValidationTask,
  type WorkflowClosureSummary,
} from '@open-scientist/schema'
import { PREREGISTERED_MINIMUM_INDEPENDENT_EVENTS } from './evidence-gate.ts'

export type ValidationReadiness = NonNullable<ValidationTask['readiness']>

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function assessCounterexampleSearch(input: {
  falsificationConditionId: string
  evidence: readonly EvidenceRecord[]
  tasks: readonly ValidationTask[]
}): CounterexampleSearchAssessment {
  const { falsificationConditionId } = input
  const evidence = input.evidence.filter((item) =>
    item.falsificationConditionIds.includes(falsificationConditionId),
  )
  const tasks = input.tasks.filter((task) =>
    task.falsificationConditionIds.includes(falsificationConditionId),
  )
  const acceptedContradiction = evidence.find(
    (item) =>
      item.status === 'contradict' &&
      item.adjudication?.status !== 'revoked' &&
      item.adjudication?.status !== 'downgraded' &&
      (item.contradictionScope === 'mechanism' ||
        item.contradictionScope === 'critical_prediction'),
  )
  const adequatelyTested = tasks.some((task) => {
    if (task.status !== 'completed' || !task.detectability?.adequate) return false
    const resultEvidenceIds = new Set(task.resultEvidenceIds)
    return evidence.some(
      (item) =>
        (resultEvidenceIds.has(item.evidenceId) || item.taskId === task.taskId) &&
        item.quantitativeResults.length > 0,
    )
  })
  const attempted =
    evidence.length > 0 ||
    tasks.some((task) => ['running', 'completed', 'failed', 'rejected'].includes(task.status))
  const status = acceptedContradiction
    ? ('counterexample_detected' as const)
    : adequatelyTested
      ? ('adequately_tested_not_detected' as const)
      : attempted
        ? ('underpowered' as const)
        : ('not_executed' as const)
  const reasons: string[] = []
  if (status === 'counterexample_detected') {
    reasons.push(`已记录可挑战机制或关键预测的反例 ${acceptedContradiction?.evidenceId}。`)
  } else if (status === 'adequately_tested_not_detected') {
    reasons.push('检验达到预注册的功效、最小可检测效应和独立事件数门槛，未检出反例。')
  } else if (status === 'underpowered') {
    reasons.push('已尝试反例搜索，但尚无同时满足功效、效应阈值、独立事件数和定量结果的检验。')
  } else if (tasks.length > 0) {
    const readiness = unique(tasks.map((task) => inferValidationReadiness(task)))
    reasons.push(`反例任务尚未执行；当前就绪状态：${readiness.join('、')}。`)
  } else {
    reasons.push('尚未为该证伪条件登记或执行反例任务。')
  }
  return CounterexampleSearchAssessmentSchema.parse({
    falsificationConditionId,
    status,
    evidenceIds: evidence.map((item) => item.evidenceId),
    taskIds: tasks.map((task) => task.taskId),
    reasons,
  })
}

/** Infer readiness for older stored tasks that predate the explicit field. */
export function inferValidationReadiness(task: ValidationTask): ValidationReadiness {
  if (task.readiness) return task.readiness
  if (task.type === 'human-review') return 'human_review'
  if (task.requiredSourceIds.some((sourceId) => sourceId.startsWith('future:'))) {
    return 'requires_data'
  }
  if (task.executorId && task.executorId !== 'external') return 'executable_now'
  if (task.executorId === 'external') return 'external'
  return 'unassessed'
}

/** Never persist a planner task whose execution ownership is unknown. */
export function normalizeValidationReadiness(task: ValidationTask): ValidationTask {
  if (inferValidationReadiness(task) !== 'unassessed') return task
  return {
    ...task,
    executorId: 'external',
    readiness: 'external',
    blockedReason:
      task.blockedReason ??
      'unclassified_by_planner: no registered executor, future data source, or human-review route was supplied.',
  }
}

const GENERIC_PREREGISTERED_DETECTABILITY = {
  effectMetric: 'unregistered-diagnostic-effect',
  alpha: 0.05,
  targetPower: 0.8,
  minimumMeaningfulEffect: 0.5,
  independentEventCount: 0,
  minimumIndependentEventCount: PREREGISTERED_MINIMUM_INDEPENDENT_EVENTS,
  adequate: false,
  assumptions: [
    'Independent units are active-region event groups, not image frames.',
    'No null or negative result is mechanism-falsifying until achieved power and minimum detectable effect are reported.',
    'This task has no registered quantitative effect metric and cannot pass the power gate.',
  ],
}

/**
 * Every planned task leaves the planning pass with a preregistered
 * detectability contract (frozen α, target power, minimum meaningful effect
 * and independent-event floor, `adequate=false` until executed). Without it,
 * model-planned tasks could never pass the elimination gate's
 * `requireAdequateDetectability` check even after their data arrives, and
 * the plan would silently underwrite post-hoc power choices.
 */
export function withPreregisteredDetectability(task: ValidationTask): ValidationTask {
  if (task.detectability || task.status !== 'planned') return task
  return {
    ...task,
    detectability: { ...GENERIC_PREREGISTERED_DETECTABILITY },
  }
}

export function summarizeDataReadiness(tasks: readonly ValidationTask[]): DataReadinessSummary {
  const planned = tasks.filter((task) => task.status === 'planned')
  const ids = (readiness: ValidationReadiness) =>
    planned
      .filter((task) => inferValidationReadiness(task) === readiness)
      .map((task) => task.taskId)
  const requiresDataTaskIds = ids('requires_data')
  return DataReadinessSummarySchema.parse({
    executableNowTaskIds: ids('executable_now'),
    requiresDataTaskIds,
    externalTaskIds: ids('external'),
    humanReviewTaskIds: ids('human_review'),
    unassessedTaskIds: ids('unassessed'),
    requiresNewData: requiresDataTaskIds.length > 0,
  })
}

export function buildOutcomeProfile(
  hypotheses: readonly ScientificHypothesis[],
): ScientificOutcomeProfile {
  const count = (status: ScientificHypothesis['status']) =>
    hypotheses.filter((hypothesis) => hypothesis.status === status).length
  return ScientificOutcomeProfileSchema.parse({
    total: hypotheses.length,
    candidate: count('candidate'),
    uncertain: count('uncertain'),
    supported: count('supported'),
    provisionallySupported: count('provisionally_supported'),
    contradicted: count('contradicted'),
    deferredRequiresData: count('deferred_requires_data'),
    eliminated: count('eliminated'),
    revised: count('revised'),
  })
}

function reportForHypothesis(input: {
  hypothesis: ScientificHypothesis
  evidence: readonly EvidenceRecord[]
  tasks: readonly ValidationTask[]
  verificationReports: readonly HypothesisVerificationReport[]
}): HypothesisClosureReport {
  const { hypothesis } = input
  const evidence = input.evidence.filter((item) => item.hypothesisId === hypothesis.id)
  const tasks = input.tasks.filter(
    (task) =>
      task.hypothesisIds.includes(hypothesis.id) ||
      evidence.some((item) => item.taskId === task.taskId),
  )
  const latestDecision = [...input.verificationReports]
    .reverse()
    .find((report) => report.hypothesisId === hypothesis.id)
  const predictionIds = hypothesis.predictions.map((_, index) =>
    scientificPredictionId(hypothesis.id, index),
  )
  const falsificationConditionIds = hypothesis.falsificationConditions.map((_, index) =>
    scientificFalsificationConditionId(hypothesis.id, index),
  )
  const completedTasks = tasks.filter((task) => task.status === 'completed')
  const plannedTasks = tasks.filter(
    (task) => task.status === 'planned' || task.status === 'running',
  )
  const coveredPredictionIds = unique([
    ...evidence.flatMap((item) => item.predictionIds),
    ...completedTasks.flatMap((task) => task.predictionIds),
  ]).filter((id) => predictionIds.includes(id))
  const plannedPredictionIds = unique(plannedTasks.flatMap((task) => task.predictionIds)).filter(
    (id) => predictionIds.includes(id),
  )
  const coveredFalsificationConditionIds = unique([
    ...evidence.flatMap((item) => item.falsificationConditionIds),
    ...completedTasks.flatMap((task) => task.falsificationConditionIds),
  ]).filter((id) => falsificationConditionIds.includes(id))
  const plannedFalsificationConditionIds = unique(
    plannedTasks.flatMap((task) => task.falsificationConditionIds),
  ).filter((id) => falsificationConditionIds.includes(id))
  const missingPredictionIds = predictionIds.filter((id) => !coveredPredictionIds.includes(id))
  const missingFalsificationConditionIds = falsificationConditionIds.filter(
    (id) => !coveredFalsificationConditionIds.includes(id),
  )
  const hasTestablePredictions = predictionIds.length > 0 && falsificationConditionIds.length > 0
  const evidenceSearchAttempted = evidence.length > 0
  const counterexampleAssessments = falsificationConditionIds.map((falsificationConditionId) =>
    assessCounterexampleSearch({ falsificationConditionId, evidence, tasks }),
  )
  const counterexampleSearchAttempted = counterexampleAssessments.some(
    (assessment) => assessment.status !== 'not_executed',
  )
  const counterexampleSearchAdequate =
    counterexampleAssessments.length > 0 &&
    counterexampleAssessments.every(
      (assessment) =>
        assessment.status === 'adequately_tested_not_detected' ||
        assessment.status === 'counterexample_detected',
    )
  const hasVerificationDecision = Boolean(latestDecision)
  const isResolved = hypothesis.status === 'supported' || hypothesis.status === 'eliminated'
  const hasNextValidationPlan = isResolved || plannedTasks.length > 0
  const plannedReadiness = unique(plannedTasks.map((task) => inferValidationReadiness(task)))
  const blockingTaskIds = plannedTasks.map((task) => task.taskId)
  const hasValidContradiction = (latestDecision?.contradictionEvidenceIds.length ?? 0) > 0
  let runDisposition: HypothesisRunDisposition
  let dispositionReason: string
  let localDataSufficient = false
  if (hypothesis.status === 'revised') {
    runDisposition = 'superseded_by_revision'
    dispositionReason = '本版假设已被带新预测或新来源的修订版取代。'
    localDataSufficient = true
  } else if (hypothesis.status === 'supported') {
    runDisposition =
      latestDecision?.supportTier === 'specific_mechanism_support'
        ? 'accepted_specific_mechanism'
        : 'accepted_bounded_process'
    dispositionReason =
      runDisposition === 'accepted_specific_mechanism'
        ? '已通过具体机制严格支持门槛。'
        : '已通过限定样本和作用域内的过程层支持门槛，不外推为微观机制得证。'
    localDataSufficient = true
  } else if (hypothesis.status === 'eliminated') {
    runDisposition = 'rejected_falsified'
    dispositionReason = '已通过重复、holdout 和功效充足的致命证伪条件，本运行中予以排除。'
    localDataSufficient = true
  } else if (hasValidContradiction) {
    runDisposition = 'disfavored_not_falsified'
    dispositionReason = '已有可审计的不利证据，但尚未同时满足重复、holdout 和检验功效门槛，因此降低优先级而不宣称已证伪。'
    localDataSufficient = true
  } else if (plannedReadiness.includes('executable_now')) {
    runDisposition = 'incomplete_executable_work'
    dispositionReason = '仍有已注册且本地可执行的验证任务，当前运行不应宣称流程闭环。'
  } else if (plannedReadiness.includes('requires_data')) {
    runDisposition = 'deferred_requires_data'
    dispositionReason = '现有本地数据已完成可执行检验，但具体机制裁决仍缺少任务明确指定的新证据维度。'
  } else if (
    plannedReadiness.includes('external') ||
    plannedReadiness.includes('human_review')
  ) {
    runDisposition = 'deferred_external_validation'
    dispositionReason = '本地证据处理已完成，最终裁决需要外部设施、模拟器或专家复核。'
  } else if (counterexampleSearchAttempted && !counterexampleSearchAdequate) {
    runDisposition = 'deferred_underpowered'
    dispositionReason = '反例搜索已执行，但独立事件数、最小可检测效应或实际功效未达预注册门槛。'
  } else {
    runDisposition = 'unresolved_no_executable_path'
    dispositionReason = '本运行尚未为该假设形成足够证据，也没有可执行或明确受阻的后续任务。'
  }
  const reasons: string[] = []
  if (!hasTestablePredictions) reasons.push('缺少可观测预测或证伪条件。')
  if (!evidenceSearchAttempted) reasons.push('尚未形成与该假设绑定的证据检索或分析记录。')
  if (!counterexampleSearchAttempted) reasons.push('尚未记录反例搜索或证伪任务。')
  if (counterexampleSearchAttempted && !counterexampleSearchAdequate) {
    reasons.push('反例搜索已尝试但检验能力不足；“未发现”不能解释为“不存在”。')
  }
  if (!hasVerificationDecision) reasons.push('尚未生成逐假设验证判定。')
  if (missingPredictionIds.length > 0) {
    reasons.push(`仍有预测未被证据或已完成验证覆盖：${missingPredictionIds.join('、')}。`)
  }
  if (missingFalsificationConditionIds.length > 0) {
    reasons.push(
      `仍有证伪条件未被反例记录或已完成验证覆盖：${missingFalsificationConditionIds.join('、')}。`,
    )
  }
  if (!hasNextValidationPlan) reasons.push('未解决假设缺少下一步验证计划。')

  const complete =
    hasTestablePredictions &&
    evidenceSearchAttempted &&
    counterexampleSearchAdequate &&
    hasVerificationDecision &&
    missingPredictionIds.length === 0 &&
    missingFalsificationConditionIds.length === 0 &&
    hasNextValidationPlan
  const blocked = !hasTestablePredictions || (!evidenceSearchAttempted && tasks.length === 0)
  return HypothesisClosureReportSchema.parse({
    hypothesisId: hypothesis.id,
    status: complete ? 'complete' : blocked ? 'blocked' : 'partial',
    runDisposition,
    dispositionReason,
    localDataSufficient,
    blockingTaskIds,
    hasTestablePredictions,
    evidenceSearchAttempted,
    counterexampleSearchAttempted,
    counterexampleSearchAdequate,
    counterexampleAssessments,
    hasVerificationDecision,
    hasNextValidationPlan,
    coveredPredictionIds,
    plannedPredictionIds,
    missingPredictionIds,
    coveredFalsificationConditionIds,
    plannedFalsificationConditionIds,
    missingFalsificationConditionIds,
    relatedEvidenceIds: evidence.map((item) => item.evidenceId),
    relatedTaskIds: tasks.map((task) => task.taskId),
    reasons,
  })
}

export function assessScientificClosure(input: {
  hypotheses: readonly ScientificHypothesis[]
  evidence: readonly EvidenceRecord[]
  tasks: readonly ValidationTask[]
  verificationReports: readonly HypothesisVerificationReport[]
}): {
  status: HypothesisClosureReport['status']
  reports: HypothesisClosureReport[]
  workflowClosure: WorkflowClosureSummary
} {
  const reportableHypotheses = input.hypotheses.filter(
    (hypothesis) => hypothesis.status !== 'revised',
  )
  const reports = reportableHypotheses.map((hypothesis) =>
    reportForHypothesis({ ...input, hypothesis }),
  )
  const status =
    reports.length === 0
      ? ('blocked' as const)
      : reports.every((report) => report.status === 'complete')
        ? ('complete' as const)
        : reports.every((report) => report.status === 'blocked')
          ? ('blocked' as const)
          : ('partial' as const)
  const nonTerminalDispositions = new Set<HypothesisRunDisposition>([
    'incomplete_executable_work',
    'unresolved_no_executable_path',
  ])
  const allHypothesesDisposed =
    reports.length > 0 &&
    reports.every((report) => !nonTerminalDispositions.has(report.runDisposition))
  const readiness = summarizeDataReadiness(input.tasks)
  const noExecutableTasksRemaining = readiness.executableNowTaskIds.length === 0
  const noUnassessedTasksRemaining = readiness.unassessedTaskIds.length === 0
  const workflowComplete =
    allHypothesesDisposed && noExecutableTasksRemaining && noUnassessedTasksRemaining
  const dispositions: HypothesisRunDisposition[] = [
    'accepted_bounded_process',
    'accepted_specific_mechanism',
    'rejected_falsified',
    'disfavored_not_falsified',
    'deferred_requires_data',
    'deferred_external_validation',
    'deferred_underpowered',
    'incomplete_executable_work',
    'unresolved_no_executable_path',
    'superseded_by_revision',
  ]
  const dispositionCounts = Object.fromEntries(
    dispositions.map((disposition) => [
      disposition,
      reports.filter((report) => report.runDisposition === disposition).length,
    ]),
  )
  const workflowClosure = WorkflowClosureSummarySchema.parse({
    status: workflowComplete ? 'complete' : 'incomplete',
    allHypothesesDisposed,
    noExecutableTasksRemaining,
    noUnassessedTasksRemaining,
    terminalHypothesisCount: reports.filter(
      (report) => !nonTerminalDispositions.has(report.runDisposition),
    ).length,
    totalHypothesisCount: reports.length,
    dispositionCounts,
    reasons: [
      ...(allHypothesesDisposed ? [] : ['仍有假设没有明确的本运行终局处置。']),
      ...(noExecutableTasksRemaining ? [] : ['仍有本地 executable_now 任务未执行。']),
      ...(noUnassessedTasksRemaining ? [] : ['仍有后续任务没有完成数据就绪性分类。']),
      ...(workflowComplete && status !== 'complete'
        ? [
            '本运行的工程闭环已完成；科学闭环仍保留外部数据或功效边界，不把流程完整误写为机制得证。',
          ]
        : []),
    ],
  })
  return { status, reports, workflowClosure }
}
