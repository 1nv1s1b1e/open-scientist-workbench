import { describe, expect, it } from 'vite-plus/test'
import type { EvidenceRecord, ScientificHypothesis, ValidationTask } from '@open-scientist/schema'

import { buildScientificContext } from '../src/scientific-loop/context-builder.ts'
import type { ScientificGraphState } from '../src/scientific-loop/graph-state.ts'

function hypothesis(id: string): ScientificHypothesis {
  return {
    id,
    statement: `候选机制 ${id}`,
    mechanismComposition: [{ mechanism: '耦合加热', role: 'coupled' }],
    predictions: ['存在可检验的多波段时序特征'],
    falsificationConditions: ['统一处理后不存在该时序特征'],
    sourceIds: [],
    scope: '当前活动区',
    confidence: 0.4,
    parentId: null,
    round: 1,
    status: 'candidate',
  }
}

function evidence(evidenceId: string, hypothesisId: string): EvidenceRecord {
  return {
    evidenceId,
    hypothesisId,
    status: 'unknown',
    evidenceRole: 'diagnostic_boundary',
    contradictionScope: 'mechanism',
    claim: `关于 ${hypothesisId} 的未知证据`,
    observed: '尚未形成可重复指标',
    method: 'boundary-audit',
    sourceIds: [],
    sampleIds: [],
    predictionIds: [],
    falsificationConditionIds: [],
    quantitativeResults: [],
    limitations: ['缺少处理产物'],
    round: 1,
  }
}

function task(taskId: string, triggeredBy: string): ValidationTask {
  return {
    taskId,
    route: 'B',
    type: 'analysis',
    objective: `验证 ${triggeredBy}`,
    hypothesisIds: [],
    predictionIds: [],
    falsificationConditionIds: [],
    requiredSourceIds: [],
    discriminatingOutcomes: ['得到可重复指标', '确认数据不足'],
    triggeredBy,
    status: 'planned',
    resultEvidenceIds: [],
    round: 1,
    fingerprint: `fingerprint-${taskId}`,
  }
}

function state(): ScientificGraphState {
  return {
    projectId: 'project-1',
    runId: 'run-1',
    phenomenon: {
      phenomenonId: 'phenomenon-1',
      title: '活动区多波段增亮',
      description: '同一活动区出现间歇增亮和传播扰动。',
      observations: [],
      constraints: [],
    },
    round: 1,
    maxRounds: 3,
    hypotheses: [hypothesis('h-1'), hypothesis('h-2')],
    evidence: [evidence('e-1', 'h-1'), evidence('e-2', 'h-2')],
    validationTasks: [task('task-1', 'e-1'), task('task-2', 'e-2')],
    verificationReports: [],
    corrections: [],
    agentExecutions: [
      {
        agentId: 'previous-agent',
        label: '前序智能体',
        stage: 'B',
        status: 'completed',
        capabilities: ['history-search'],
        round: 1,
        outputEvidenceIds: ['e-1'],
        outputTaskIds: [],
      },
    ],
    limitations: ['内部执行日志不应进入模型上下文'],
    conclusion: '',
    newEvidenceCount: 0,
    newTaskCount: 0,
    roundTaskIds: [],
    completedRounds: 0,
    nextRoute: 'B',
    terminationReason: null,
  }
}

describe('scientific working-context projection', () => {
  it('projects only the hypothesis and evidence targeted by a B task', () => {
    const projected = buildScientificContext({
      stage: 'B',
      state: state(),
      taskId: 'task-1',
      capabilities: ['timeseries-analysis'],
    })

    expect(projected.validationTasks.map((item) => item.taskId)).toEqual(['task-1'])
    expect(projected.hypotheses.map((item) => item.id)).toEqual(['h-1'])
    expect(projected.evidence.map((item) => item.evidenceId)).toEqual(['e-1'])
  })

  it('projects compact earlier-round self-correction lessons into the working context', () => {
    const stateWithLessons = {
      ...state(),
      round: 2,
      corrections: [
        {
          correctionId: 'correction-1',
          stage: 'B',
          kind: 'provenance',
          severity: 'warning',
          message: '有 3 个抽样 FITS 读取或校验异常，已登记重取工单。',
          action: '重取后复核。',
          evidenceAction: 'none',
          affectedIds: [],
          triggeredBy: ['evidence-workgroup'],
          round: 1,
        },
        {
          correctionId: 'correction-2',
          stage: 'C',
          kind: 'factual',
          severity: 'warning',
          message: '同一处理运行的 DEM 指标被 6 个假设复用，不具机制区分力。',
          action: '各假设需独立满足支持义务。',
          evidenceAction: 'none',
          affectedIds: [],
          triggeredBy: ['C.verify'],
          round: 1,
        },
        {
          correctionId: 'correction-3',
          stage: 'D',
          kind: 'execution',
          severity: 'info',
          message: '本轮有 2 项外部任务保持 planned。',
          action: '保留追踪。',
          evidenceAction: 'none',
          affectedIds: [],
          triggeredBy: ['D.plan'],
          round: 1,
        },
        {
          correctionId: 'correction-4',
          stage: 'B',
          kind: 'provenance',
          severity: 'warning',
          message: '同一处理运行的 DEM 指标被 6 个假设复用，不具机制区分力。',
          action: '重复记录。',
          evidenceAction: 'none',
          affectedIds: [],
          triggeredBy: ['evidence-workgroup'],
          round: 2,
        },
      ],
    } as ScientificGraphState
    const projected = buildScientificContext({ stage: 'B', state: stateWithLessons })

    // info 级不入课；跨轮重复发现去重（保留最新一条）；最新在前。
    expect(projected.recentLessons).toHaveLength(2)
    expect(projected.recentLessons[0]).toContain('R2/B: 同一处理运行的 DEM 指标被 6 个假设复用')
    expect(projected.recentLessons[1]).toContain('R1/B: 有 3 个抽样 FITS 读取或校验异常')
    // 原始 corrections 仍然不整体暴露给智能体。
    expect(Object.keys(projected)).not.toContain('corrections')
  })

  it('does not expose orchestration internals or credentials to an Agent', () => {
    const projected = buildScientificContext({
      stage: 'A',
      state: state(),
    })
    const keys = Object.keys(projected)

    expect(keys).not.toContain('agentExecutions')
    expect(keys).not.toContain('corrections')
    expect(keys).not.toContain('limitations')
    expect(keys).not.toContain('apiKey')
    expect(keys).not.toContain('modelConfig')
  })

  it('uses the explicit hypothesis binding when a task trigger is not evidence', () => {
    const current = state()
    current.validationTasks = [
      {
        ...task('task-explicit', 'round-1-followup'),
        hypothesisIds: ['h-2'],
        predictionIds: ['h-2:prediction:1'],
      },
    ]

    const projected = buildScientificContext({
      stage: 'B',
      state: current,
      taskId: 'task-explicit',
    })

    expect(projected.hypotheses.map((item) => item.id)).toEqual(['h-2'])
    expect(projected.evidence.map((item) => item.hypothesisId)).toEqual(['h-2'])
  })

  it('retains late task-trigger evidence across repeated bounded B projections', () => {
    const current = state()
    current.hypotheses = [hypothesis('h-1'), hypothesis('h-2'), hypothesis('h-3')]
    current.evidence = Array.from({ length: 18 }, (_, index) =>
      evidence(`e-${index + 1}`, `h-${(index % 3) + 1}`),
    )
    current.validationTasks = [task('task-late', 'e-18')]

    const first = buildScientificContext({ stage: 'B', state: current })
    const second = buildScientificContext({
      stage: 'B',
      state: first,
      capabilities: ['timeseries-analysis'],
    })

    expect(first.evidence[0]?.evidenceId).toBe('e-18')
    expect(second.validationTasks.map((item) => item.taskId)).toEqual(['task-late'])
    expect(second.hypotheses.map((item) => item.id)).toEqual(['h-3'])
    expect(second.evidence.some((item) => item.evidenceId === 'e-18')).toBe(true)
  })

  it('derives immutable data references from accepted evidence provenance', () => {
    const current = state()
    current.evidence = [
      {
        ...evidence('e-1', 'h-1'),
        status: 'support',
        provenance: {
          processingRunId: 'processing-1',
          dataSnapshotIds: ['snapshot-1'],
          artifactIds: ['artifact-1'],
          generatedBy: 'timeseries-analysis',
          deterministic: true,
        },
      },
    ]
    current.validationTasks = [task('task-1', 'e-1')]

    const projected = buildScientificContext({
      stage: 'C',
      state: current,
    })

    expect(projected.dataSnapshotIds).toEqual(['snapshot-1'])
    expect(projected.artifactIds).toEqual(['artifact-1'])
    expect(projected.processingRunIds).toEqual(['processing-1'])
  })
})
