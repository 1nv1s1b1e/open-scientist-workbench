import { describe, expect, it } from 'vite-plus/test'
import {
  EvidenceRecordSchema,
  HypothesisVerificationReportSchema,
  ScientificHypothesisSchema,
  ValidationTaskSchema,
  scientificFalsificationConditionId,
  scientificPredictionId,
} from '@open-scientist/schema'
import {
  assessScientificClosure,
  normalizeValidationReadiness,
  summarizeDataReadiness,
  withPreregisteredDetectability,
} from '../src/scientific-loop/closure-gate.ts'

const hypothesis = ScientificHypothesisSchema.parse({
  id: 'h-closure',
  statement: '间歇性热通道增强与重联加热一致',
  mechanismComposition: [{ mechanism: '纳耀斑重联', role: 'dominant' }],
  predictions: ['94/131 Å 出现间歇增强', '冷通道随后出现有序时延'],
  falsificationConditions: ['独立事件中不复现间歇增强'],
  sourceIds: ['local-coronal-pack'],
  scope: '当前活动区窗口',
  confidence: 0.52,
  round: 1,
  status: 'uncertain',
})

const predictionOne = scientificPredictionId(hypothesis.id, 0)
const predictionTwo = scientificPredictionId(hypothesis.id, 1)
const falsificationOne = scientificFalsificationConditionId(hypothesis.id, 0)

const evidence = EvidenceRecordSchema.parse({
  evidenceId: 'e-counterexample-audit',
  hypothesisId: hypothesis.id,
  agentId: 'coronal-counterexample-search',
  status: 'unknown',
  claim: '当前事件未形成决定性反例',
  observed: '已搜索背景窗口，但现有代理量不能证伪机制',
  method: 'registered-counterexample-search',
  sourceIds: ['local-coronal-pack'],
  predictionIds: [predictionOne],
  falsificationConditionIds: [falsificationOne],
  limitations: ['缺少冷却时延诊断'],
  round: 1,
})

const task = ValidationTaskSchema.parse({
  taskId: 'task-cooling-lag',
  executorId: 'external',
  route: 'B',
  type: 'analysis',
  objective: '完成响应校正后的多通道冷却时延分析',
  hypothesisIds: [hypothesis.id],
  predictionIds: [predictionTwo],
  falsificationConditionIds: [falsificationOne],
  requiredSourceIds: ['future:aia-response-calibrated-series'],
  requiredData: ['响应校正后的 AIA 多通道时序'],
  requiredFacilities: ['外部多通道响应分析环境'],
  readiness: 'requires_data',
  expectedDuration: '数据到位后预计 1 周',
  successCriteria: ['出现预注册的有序冷却时延'],
  failureCriteria: ['未出现稳定的通道时延顺序'],
  blockedReason: '响应校正时序尚未登记',
  discriminatingOutcomes: ['出现有序冷却时延', '未出现稳定时延'],
  triggeredBy: evidence.evidenceId,
  status: 'planned',
  round: 1,
  fingerprint: 'task-cooling-lag-fingerprint',
})

const verification = HypothesisVerificationReportSchema.parse({
  hypothesisId: hypothesis.id,
  round: 1,
  decision: 'uncertain',
  confidence: 0.52,
  hasHoldoutEvidence: false,
  holdoutAttempted: false,
  hasQuantitativeEvidence: false,
  meetsEvidenceCriteria: false,
  meetsConfidenceCriteria: false,
  supportGatePassed: false,
  reasons: ['needs additional diagnostics'],
  nextActions: ['execute cooling-lag task'],
})

describe('scientific closure assessment', () => {
  it('normalizes unowned planner work to an explicit external dependency', () => {
    const unowned = ValidationTaskSchema.parse({
      ...task,
      taskId: 'task-unowned',
      executorId: undefined,
      readiness: undefined,
      requiredSourceIds: ['source-without-routing-semantics'],
      blockedReason: undefined,
    })

    expect(normalizeValidationReadiness(unowned)).toEqual(
      expect.objectContaining({
        executorId: 'external',
        readiness: 'external',
        blockedReason: expect.stringContaining('unclassified_by_planner'),
      }),
    )
  })

  it('attaches a preregistered detectability contract to planner tasks that lack one', () => {
    const modelPlanned = ValidationTaskSchema.parse({
      ...task,
      taskId: 'task-model-no-detectability',
      executorId: 'external',
      readiness: 'requires_data',
    })
    expect(modelPlanned.detectability).toBeUndefined()
    const wrapped = withPreregisteredDetectability(modelPlanned)

    expect(wrapped.detectability).toEqual(
      expect.objectContaining({
        alpha: 0.05,
        targetPower: 0.8,
        minimumIndependentEventCount: 3,
        adequate: false,
      }),
    )
    // Idempotent: an existing contract is never overwritten.
    expect(withPreregisteredDetectability(wrapped).detectability).toEqual(wrapped.detectability)
    // Completed tasks are historical records, not future work.
    const completed = ValidationTaskSchema.parse({ ...task, status: 'completed' })
    expect(withPreregisteredDetectability(completed).detectability).toBeUndefined()
  })

  it('keeps planned work separate from evidence or completed validation coverage', () => {
    const result = assessScientificClosure({
      hypotheses: [hypothesis],
      evidence: [evidence],
      tasks: [task],
      verificationReports: [verification],
    })

    expect(result.status).toBe('partial')
    expect(result.reports[0]).toEqual(
      expect.objectContaining({
        status: 'partial',
        evidenceSearchAttempted: true,
        counterexampleSearchAttempted: true,
        counterexampleSearchAdequate: false,
        hasVerificationDecision: true,
        hasNextValidationPlan: true,
        runDisposition: 'deferred_requires_data',
        localDataSufficient: false,
        blockingTaskIds: [task.taskId],
        plannedPredictionIds: [predictionTwo],
        missingPredictionIds: [predictionTwo],
        missingFalsificationConditionIds: [],
      }),
    )
    expect(result.reports[0]?.counterexampleAssessments).toEqual([
      expect.objectContaining({
        falsificationConditionId: falsificationOne,
        status: 'underpowered',
      }),
    ])
    expect(result.workflowClosure).toEqual(
      expect.objectContaining({
        status: 'complete',
        allHypothesesDisposed: true,
        noExecutableTasksRemaining: true,
      }),
    )
  })

  it('accepts a negative counterexample result only after a powered quantitative test', () => {
    const quantitativeEvidence = EvidenceRecordSchema.parse({
      ...evidence,
      evidenceId: 'e-powered-negative-search',
      taskId: 'task-powered-counterexample',
      observed: '预注册效应阈值以上未检出反例信号',
      quantitativeResults: [
        {
          metric: 'standardized_counterexample_effect',
          estimate: 0.08,
          lowerBound: 0.02,
          upperBound: 0.14,
        },
      ],
    })
    const poweredTask = ValidationTaskSchema.parse({
      ...task,
      taskId: 'task-powered-counterexample',
      readiness: 'executable_now',
      status: 'completed',
      resultEvidenceIds: [quantitativeEvidence.evidenceId],
      detectability: {
        effectMetric: 'standardized_counterexample_effect',
        alpha: 0.05,
        targetPower: 0.8,
        achievedPower: 0.86,
        minimumMeaningfulEffect: 0.3,
        minimumDetectableEffect: 0.24,
        independentEventCount: 4,
        minimumIndependentEventCount: 3,
        adequate: true,
        assumptions: ['事件按活动区分组，未把同一事件的多通道当作独立样本'],
      },
      fingerprint: 'task-powered-counterexample-fingerprint',
    })

    const result = assessScientificClosure({
      hypotheses: [hypothesis],
      evidence: [quantitativeEvidence],
      tasks: [poweredTask],
      verificationReports: [verification],
    })

    expect(result.reports[0]).toEqual(
      expect.objectContaining({
        counterexampleSearchAttempted: true,
        counterexampleSearchAdequate: true,
        counterexampleAssessments: [
          expect.objectContaining({ status: 'adequately_tested_not_detected' }),
        ],
      }),
    )
  })

  it('rejects an adequate flag when registered sensitivity was not achieved', () => {
    expect(() =>
      ValidationTaskSchema.parse({
        ...task,
        detectability: {
          effectMetric: 'standardized_counterexample_effect',
          targetPower: 0.8,
          achievedPower: 0.61,
          minimumMeaningfulEffect: 0.3,
          minimumDetectableEffect: 0.42,
          independentEventCount: 1,
          minimumIndependentEventCount: 3,
          adequate: true,
        },
      }),
    ).toThrow()
  })

  it('keeps closure partial when a prediction has neither evidence nor a validation task', () => {
    const result = assessScientificClosure({
      hypotheses: [hypothesis],
      evidence: [evidence],
      tasks: [],
      verificationReports: [verification],
    })

    expect(result.status).toBe('partial')
    expect(result.reports[0]?.missingPredictionIds).toEqual([predictionTwo])
  })

  it('reports new data as a task-level dependency rather than a global assumption', () => {
    const summary = summarizeDataReadiness([task])

    expect(summary.requiresNewData).toBe(true)
    expect(summary.requiresDataTaskIds).toEqual([task.taskId])
    expect(summary.executableNowTaskIds).toEqual([])
  })
})
