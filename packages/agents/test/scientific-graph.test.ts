import { describe, expect, it } from 'vite-plus/test'
import type { ScientificHypothesis, ValidationTask } from '@open-scientist/schema'
import type { UIMessageChunk } from 'ai'
import { createInMemoryScientificRuntime } from '../src/orchestration/langgraph-runtime.ts'

import {
  runScientificLoopGraph,
  type ScientificGraphDependencies,
  type ScientificGraphInput,
} from '../src/scientific-loop/scientific-graph.ts'
import type { EvidenceAgent } from '../src/scientific-loop/evidence-workgroup.ts'

const hypothesis: ScientificHypothesis = {
  id: 'h-coupled',
  statement: '波动耗散与间歇性重联共同贡献加热',
  mechanismComposition: [
    { mechanism: '阿尔芬波耗散', role: 'coupled' },
    { mechanism: '纳耀斑重联', role: 'coupled' },
  ],
  predictions: ['多波段热响应应呈现可区分的时序特征'],
  falsificationConditions: ['统一处理后仍无对应时序特征'],
  sourceIds: [],
  scope: '当前活动区和观测窗口',
  confidence: 0.4,
  evidenceStrengthGrade: 'not_assessed',
  parentId: null,
  round: 1,
  status: 'candidate',
}

function input(emitChunk?: (chunk: UIMessageChunk) => void, maxRounds = 1): ScientificGraphInput {
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
    maxRounds,
    emitChunk,
  }
}

function gateReadySupport(hypothesisId: string) {
  return [1, 2, 3].map((index) => ({
    evidenceId: `e-gate-${hypothesisId}-${index}`,
    hypothesisId,
    agentId: `agent-${index}`,
    status: 'support' as const,
    evidenceRole: 'mechanism_discriminating' as const,
    contradictionScope: 'mechanism' as const,
    claim: `support ${index}`,
    observed: `observation ${index}`,
    method: `method-${index}`,
    sourceIds: [`source-${index}`],
    sampleIds: [`sample-${index}`],
    predictionIds: [`${hypothesisId}:prediction:1`],
    falsificationConditionIds: [],
    metrics: { effectSize: index * 0.1 },
    quantitativeResults: [
      {
        metric: 'effect-size',
        estimate: index * 0.1,
        lowerBound: index * 0.1 - 0.02,
        upperBound: index * 0.1 + 0.02,
        confidenceLevel: 0.95,
      },
    ],
    lineage: {
      eventGroupId: `event-${index}`,
      relatedEventGroupIds: [],
      rawDataFingerprint: `raw-${index}`,
      observableFamily: index === 1 ? ('wave_timing' as const) : ('thermal_variability' as const),
      methodFamily: index === 1 ? 'timing-analysis' : 'thermal-analysis',
      analysisSplit: index === 3 ? ('holdout' as const) : ('validation' as const),
    },
    provenance: {
      processingRunId: `processing-${index}`,
      dataSnapshotIds: [`snapshot-${index}`],
      artifactIds: [`artifact-${index}`],
      generatedBy: `agent-${index}`,
      deterministic: true as const,
    },
    limitations: [],
    round: 1,
  }))
}

function dependencies(
  overrides: Partial<ScientificGraphDependencies> = {},
): ScientificGraphDependencies {
  return {
    generateHypotheses: async ({ round }) => [
      {
        ...hypothesis,
        round,
      },
    ],
    evidenceAgents: [
      {
        id: 'boundary-audit',
        label: '证据边界审计',
        capabilities: ['fact-check'],
        run: async ({ hypotheses, round }) => ({
          evidence: hypotheses.map((item) => ({
            evidenceId: `e-unknown-${round}-${item.id}`,
            hypothesisId: item.id,
            agentId: 'boundary-audit',
            status: 'unknown' as const,
            evidenceRole: 'diagnostic_boundary' as const,
            contradictionScope: 'mechanism' as const,
            claim: '当前数据不足以判断该候选机制',
            observed: '尚未得到可重复的数据处理指标',
            method: 'evidence-boundary-audit',
            sourceIds: [],
            sampleIds: [],
            predictionIds: [],
            falsificationConditionIds: [],
            quantitativeResults: [],
            limitations: ['缺少已登记的数据处理产物'],
            round,
          })),
        }),
      },
    ],
    planValidation: async () => [],
    ...overrides,
  }
}

describe('LangGraph A-B-C-D scientific root graph', () => {
  it('runs the explicit node sequence and returns a bounded result', async () => {
    const completed: string[] = []
    const emitted: string[] = []
    const result = await runScientificLoopGraph(
      input((chunk) => {
        const event = chunk as unknown as Record<string, unknown>
        if (typeof event.kind === 'string') emitted.push(event.kind)
        if (event.kind === 'scientific.node-state' && event.state === 'completed') {
          completed.push(String(event.node))
        }
      }),
      dependencies(),
    )

    expect(completed).toEqual([
      'A.generate',
      'A.verify',
      'B.run',
      'BC.verify',
      'C.verify',
      'C.synthesize',
      'D.plan',
      'D.route',
    ])
    expect(emitted).toEqual(
      expect.arrayContaining([
        'scientific.phenomenon',
        'scientific.hypothesis',
        'scientific.round-summary',
      ]),
    )
    expect(result.totalRounds).toBe(1)
    expect(result.hypotheses).toHaveLength(1)
    expect(result.evidence[0]?.status).toBe('unknown')
    expect(result.terminationReason).toBe('max_rounds_reached')
    expect(new Set(result.agentExecutions.map((execution) => execution.stage))).toEqual(
      new Set(['A', 'B', 'C', 'D']),
    )
    expect(result.agentExecutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: 'librarian', stage: 'A' }),
        expect.objectContaining({ agentId: 'sisyphus', stage: 'C' }),
        expect.objectContaining({ agentId: 'prometheus', stage: 'D' }),
      ]),
    )
    expect(result.roundBudget).toEqual({
      maxRounds: 1,
      roundsUsed: 1,
      exhausted: true,
      deferredTaskCount: 0,
    })
    expect(result.closureStatus).toBe('partial')
    expect(result.hypothesisCoverage).toEqual(
      expect.objectContaining({
        mode: 'open_world',
        exhaustiveClaim: false,
        fixedMechanismCount: false,
        residualAlternativeAllowed: true,
        candidateCount: 1,
      }),
    )
  })

  it('reports a concrete task-level data gap instead of treating every unfinished run as data-poor', async () => {
    const dataTask: ValidationTask = {
      taskId: 'task-needs-third-event',
      executorId: 'external',
      route: 'B',
      type: 'observation',
      objective: '在第三个独立目标事件上复测预注册时序预测',
      hypothesisIds: [hypothesis.id],
      predictionIds: [`${hypothesis.id}:prediction:1`],
      falsificationConditionIds: [`${hypothesis.id}:falsification:1`],
      requiredSourceIds: ['future:third-independent-event'],
      requiredData: ['第三个独立目标事件的 AIA 多波段时序'],
      requiredFacilities: ['公开太阳观测数据服务'],
      readiness: 'requires_data',
      expectedDuration: '数据取得后约 1 天',
      successCriteria: ['冻结参数后复现预注册时序特征'],
      failureCriteria: ['独立事件未复现该特征'],
      blockedReason: '第三个独立目标事件尚未登记',
      discriminatingOutcomes: ['复现', '不复现'],
      triggeredBy: hypothesis.id,
      status: 'planned',
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'task-needs-third-event-fingerprint',
    }
    const result = await runScientificLoopGraph(
      input(undefined, 1),
      dependencies({ planValidation: async () => [dataTask] }),
    )

    expect(result.scientificStatus).toBe('needs_data')
    expect(result.dataReadiness).toEqual(
      expect.objectContaining({
        requiresNewData: true,
        requiresDataTaskIds: [dataTask.taskId],
      }),
    )
  })

  it('makes maxRounds observable when the final planner finds executable work', async () => {
    const finalRoundTask: ValidationTask = {
      taskId: 'task-final-round-budget',
      executorId: 'test-round-executor',
      route: 'B',
      type: 'analysis',
      objective: '在最终轮登记一项可执行的时序复核',
      hypothesisIds: [hypothesis.id],
      predictionIds: [],
      falsificationConditionIds: [],
      requiredSourceIds: [],
      discriminatingOutcomes: ['得到可重复指标', '仍然未知'],
      triggeredBy: hypothesis.id,
      status: 'planned',
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'task-final-round-budget-fingerprint',
      readiness: 'executable_now',
    }
    const result = await runScientificLoopGraph(
      input(undefined, 1),
      dependencies({ planValidation: async () => [finalRoundTask] }),
    )

    expect(result.terminationReason).toBe('max_rounds_reached')
    expect(result.roundBudget).toEqual({
      maxRounds: 1,
      roundsUsed: 1,
      exhausted: true,
      deferredTaskCount: 1,
    })
    expect(result.validationTasks).toHaveLength(0)
    expect(result.corrections.some((item) => item.message.includes('最终轮规划器'))).toBe(true)
  })

  it('downgrades decisive evidence that lacks processing provenance', async () => {
    const correctionKinds: string[] = []
    const result = await runScientificLoopGraph(
      input((chunk) => {
        const event = chunk as unknown as Record<string, unknown>
        if (event.kind === 'scientific.self-correction') {
          const correction = event.correction as Record<string, unknown>
          correctionKinds.push(String(correction.kind))
        }
      }),
      dependencies({
        evidenceAgents: [
          {
            id: 'unsafe-analysis',
            label: '未溯源分析',
            capabilities: ['timeseries-analysis'],
            run: async ({ round }) => ({
              evidence: [
                {
                  evidenceId: 'e-unsafe-support',
                  hypothesisId: hypothesis.id,
                  agentId: 'unsafe-analysis',
                  status: 'support',
                  claim: '数据支持耦合机制',
                  observed: '模型声称观察到相关关系',
                  method: 'unregistered-analysis',
                  sourceIds: [],
                  sampleIds: [],
                  limitations: [],
                  round,
                } as never,
              ],
            }),
          },
        ],
      }),
    )

    expect(result.evidence[0]?.status).toBe('unknown')
    expect(result.evidence[0]?.limitations).toContain(
      '原始判断缺少可验证的数据处理溯源，已自动降级为 unknown。',
    )
    expect(correctionKinds).toContain('provenance')
  })

  it('routes D feedback to B without regenerating A hypotheses', async () => {
    let generationCalls = 0
    let evidenceCalls = 0
    const task: ValidationTask = {
      taskId: 'task-round-1',
      executorId: 'test-round-executor',
      readiness: 'executable_now',
      route: 'B',
      type: 'analysis',
      objective: '补充多波段时序处理',
      hypothesisIds: [hypothesis.id],
      predictionIds: [],
      falsificationConditionIds: [],
      requiredSourceIds: [],
      discriminatingOutcomes: ['得到可重复指标', '确认数据仍不足'],
      triggeredBy: 'e-unknown-1-h-coupled',
      status: 'planned',
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'task-round-1-fingerprint',
    }
    const deps = dependencies({
      generateHypotheses: async ({ round }) => {
        generationCalls += 1
        return [{ ...hypothesis, round }]
      },
      evidenceAgents: [
        {
          id: 'round-audit',
          label: '逐轮审计',
          capabilities: ['fact-check'],
          run: async ({ round }) => {
            evidenceCalls += 1
            return {
              evidence: [
                {
                  evidenceId: `e-unknown-${round}-h-coupled`,
                  hypothesisId: hypothesis.id,
                  agentId: 'round-audit',
                  status: 'unknown',
                  evidenceRole: 'diagnostic_boundary',
                  contradictionScope: 'mechanism',
                  claim: '本轮仍不足以甄别机制',
                  observed: '只完成数据边界检查',
                  method: 'round-audit',
                  sourceIds: [],
                  sampleIds: [],
                  predictionIds: [],
                  falsificationConditionIds: [],
                  quantitativeResults: [],
                  limitations: ['等待后续验证任务'],
                  round,
                },
              ],
            }
          },
        },
      ],
      planValidation: async ({ round }) => (round === 1 ? [task] : []),
    })

    const result = await runScientificLoopGraph(input(undefined, 2), deps)

    expect(generationCalls).toBe(1)
    expect(evidenceCalls).toBe(2)
    expect(result.totalRounds).toBe(2)
    expect(result.terminationReason).toBe('max_rounds_reached')
  })

  it('does not re-plan the same registered diagnostic under a new model fingerprint', async () => {
    const localTask = (round: number): ValidationTask => ({
      taskId: `task-local-${round}`,
      executorId: 'coronal-timeseries-lag-v1',
      route: 'B',
      type: 'analysis',
      objective: round === 1 ? '计算 171/193 时序' : '再次检验 171/193 时序',
      hypothesisIds: [hypothesis.id],
      predictionIds: [`${hypothesis.id}:prediction:1`],
      falsificationConditionIds: [`${hypothesis.id}:falsification:1`],
      requiredSourceIds: ['local:coronal-starter-v1'],
      discriminatingOutcomes: round === 1 ? ['相关', '不相关'] : ['稳定', '不稳定'],
      triggeredBy: `round-${round}`,
      status: 'planned',
      resultEvidenceIds: [],
      round,
      fingerprint: `model-wording-${round}`,
    })
    const result = await runScientificLoopGraph(
      input(undefined, 2),
      dependencies({
        planValidation: async ({ round }) => [localTask(round)],
      }),
    )

    expect(result.validationTasks).toHaveLength(1)
    expect(result.validationTasks[0]?.taskId).toBe('task-local-1')
  })

  it('routes model-update feedback to A and preserves parent-child lineage', async () => {
    let generationCalls = 0
    const task: ValidationTask = {
      taskId: 'task-revise',
      executorId: 'test-revision-executor',
      readiness: 'executable_now',
      route: 'A',
      type: 'model-update',
      objective: 'revise the mechanism after a discriminating counterexample',
      hypothesisIds: [hypothesis.id],
      predictionIds: [],
      falsificationConditionIds: [],
      requiredSourceIds: [],
      discriminatingOutcomes: ['revise', 'retain'],
      triggeredBy: hypothesis.id,
      status: 'planned',
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'task-revise-fingerprint',
    }
    const result = await runScientificLoopGraph(
      input(undefined, 2),
      dependencies({
        generateHypotheses: async ({ round, existingHypotheses }) => {
          generationCalls += 1
          if (round === 1) return [{ ...hypothesis, round }]
          return [
            {
              ...hypothesis,
              id: 'h-coupled-revision',
              parentId: existingHypotheses[0]!.id,
              round,
            },
          ]
        },
        planValidation: async ({ round }) => (round === 1 ? [task] : []),
      }),
    )

    expect(generationCalls).toBe(2)
    expect(result.hypotheses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'h-coupled' }),
        expect.objectContaining({ id: 'h-coupled-revision', parentId: 'h-coupled', round: 2 }),
      ]),
    )
  })

  it('uses an ordinal strong grade without incrementing a pseudo-probability', async () => {
    const synthesizedStatuses: string[][] = []
    const emitted: Array<Record<string, unknown>> = []
    const task: ValidationTask = {
      taskId: 'task-repeat-check',
      route: 'B',
      type: 'analysis',
      objective: 'repeat the evidence projection without creating new evidence',
      hypothesisIds: [hypothesis.id],
      predictionIds: [],
      falsificationConditionIds: [],
      requiredSourceIds: [],
      discriminatingOutcomes: ['stable', 'changed'],
      triggeredBy: 'e-support-1',
      status: 'planned',
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'task-repeat-check-fingerprint',
    }
    const result = await runScientificLoopGraph(
      input((chunk) => emitted.push(chunk as unknown as Record<string, unknown>), 2),
      dependencies({
        evidenceAgents: [
          {
            id: 'repeat-support',
            label: 'repeat support',
            capabilities: ['timeseries-analysis'],
            run: async () => ({
              evidence: [1, 2, 3].map((index) => ({
                evidenceId: `e-support-${index}`,
                hypothesisId: hypothesis.id,
                agentId: index === 1 ? 'repeat-support' : 'independent-support',
                status: 'support' as const,
                evidenceRole: 'mechanism_discriminating' as const,
                contradictionScope: 'mechanism' as const,
                claim: `support ${index}`,
                observed: `observation ${index}`,
                method: `method-${index}`,
                sourceIds: [`source-${index}`],
                sampleIds: [`sample-${index}`],
                predictionIds: [`${hypothesis.id}:prediction:1`],
                falsificationConditionIds: [],
                metrics: { effectSize: index * 0.1 },
                quantitativeResults: [
                  {
                    metric: 'effect-size',
                    estimate: index * 0.1,
                    lowerBound: index * 0.1 - 0.02,
                    upperBound: index * 0.1 + 0.02,
                    confidenceLevel: 0.95,
                  },
                ],
                lineage: {
                  eventGroupId: `event-${index}`,
                  relatedEventGroupIds: [],
                  rawDataFingerprint: `raw-${index}`,
                  observableFamily:
                    index === 1 ? ('wave_timing' as const) : ('thermal_variability' as const),
                  methodFamily: index === 1 ? 'timing-analysis' : 'thermal-analysis',
                  analysisSplit: index === 3 ? ('holdout' as const) : ('validation' as const),
                },
                provenance: {
                  processingRunId: `processing-${index}`,
                  dataSnapshotIds: [`snapshot-${index}`],
                  artifactIds: [`artifact-${index}`],
                  generatedBy: 'repeat-support',
                  deterministic: true as const,
                },
                limitations: [],
                round: 1,
              })),
            }),
          },
        ],
        verifyProvenance: async () => true,
        generateHypotheses: async ({ round }) => [{ ...hypothesis, confidence: undefined, round }],
        synthesizeConclusion: async ({ hypotheses }) => {
          synthesizedStatuses.push(hypotheses.map((item) => item.status))
          return '结论仅按已经完成的逐假设验证状态生成。'
        },
        planValidation: async ({ round }) => (round === 1 ? [task] : []),
      }),
    )

    expect(result.hypotheses.find((item) => item.id === hypothesis.id)?.confidence).toBeUndefined()
    expect(result.hypotheses.find((item) => item.id === hypothesis.id)?.evidenceStrengthGrade).toBe(
      'strong',
    )
    expect(result.hypotheses.find((item) => item.id === hypothesis.id)?.status).toBe('supported')
    expect(result.verificationReports).toEqual([
      expect.objectContaining({
        hypothesisId: hypothesis.id,
        supportGatePassed: true,
        evidenceStrengthGrade: 'strong',
        evidenceStrengthSemantics: 'ordinal_evidence_grade_not_probability',
        hasHoldoutEvidence: true,
        uncoveredPredictionIds: [],
      }),
    ])
    expect(
      emitted.some(
        (event) =>
          event.kind === 'scientific.hypothesis' &&
          (event.hypothesis as ScientificHypothesis | undefined)?.status === 'supported' &&
          event.adjudicated === true,
      ),
    ).toBe(true)
    expect(
      emitted.some(
        (event) =>
          event.kind === 'scientific.verification-report' &&
          (event.report as { supportGatePassed?: boolean } | undefined)?.supportGatePassed === true,
      ),
    ).toBe(true)
    expect(synthesizedStatuses[0]).toEqual(['supported'])
  })

  it('marks the strongest non-contradicted candidate provisionally supported', async () => {
    const result = await runScientificLoopGraph(
      input(undefined, 1),
      dependencies({
        evidenceAgents: [
          {
            id: 'textual-review',
            label: 'textual review',
            capabilities: ['fact-check'],
            run: async () => ({
              evidence: [1, 2, 3].map((index) => ({
                evidenceId: `e-text-${index}`,
                hypothesisId: hypothesis.id,
                agentId: 'textual-review',
                status: 'support' as const,
                evidenceRole: 'prediction_consistent' as const,
                contradictionScope: 'mechanism' as const,
                claim: `the literature is compatible ${index}`,
                observed: `qualitative observation ${index}`,
                method: `review-${index}`,
                sourceIds: [`source-${index}`],
                sampleIds: [`sample-${index}`],
                predictionIds: [],
                falsificationConditionIds: [],
                quantitativeResults: [],
                provenance: {
                  processingRunId: `processing-${index}`,
                  dataSnapshotIds: [`snapshot-${index}`],
                  artifactIds: [`artifact-${index}`],
                  generatedBy: 'textual-review',
                  deterministic: true as const,
                },
                limitations: [],
                round: 1,
              })),
            }),
          },
        ],
        verifyProvenance: async () => true,
      }),
    )

    expect(result.hypotheses[0]?.status).toBe('provisionally_supported')
    expect(result.scientificStatus).not.toBe('supported')
    expect(result.verificationReports[0]).toEqual(
      expect.objectContaining({
        supportGatePassed: false,
        hasQuantitativeEvidence: false,
      }),
    )
    expect(result.verificationReports[0]?.nextActions.length).toBeGreaterThan(0)
    expect(result.corrections.some((item) => item.message.includes('support gate'))).toBe(true)
  })

  it('applies a structured correction to revoke an already generated evidence row', async () => {
    const original = gateReadySupport(hypothesis.id)[0]!
    const result = await runScientificLoopGraph(
      input(undefined, 1),
      dependencies({
        evidenceAgents: [
          {
            id: 'deterministic-measurement',
            label: 'deterministic measurement',
            executionKind: 'deterministic',
            capabilities: ['timeseries-analysis'],
            run: async () => ({ evidence: [original] }),
          },
          {
            id: 'oracle-revocation',
            label: 'oracle revocation',
            executionKind: 'model',
            capabilities: ['fact-check'],
            run: async ({ evidence }) => ({
              corrections: [
                {
                  stage: 'B-model-review',
                  severity: 'error' as const,
                  message: '处理产物与登记快照不一致。',
                  action: '撤销该证据并重新执行处理。',
                  affectedIds: [
                    evidence.find((item) => item.evidenceId === original.evidenceId)!.evidenceId,
                  ],
                  evidenceAction: 'revoke' as const,
                },
              ],
            }),
          },
        ],
        verifyProvenance: async () => true,
      }),
    )

    const revokedEvidence = result.evidence.find((item) => item.evidenceId === original.evidenceId)
    expect(revokedEvidence).toEqual(
      expect.objectContaining({
        status: 'unknown',
        evidenceRole: 'diagnostic_boundary',
        adjudication: expect.objectContaining({ status: 'revoked' }),
      }),
    )
    expect(
      revokedEvidence?.adjudication?.correctionIds.every((correctionId) =>
        result.corrections.some((item) => item.correctionId === correctionId),
      ),
    ).toBe(true)
    expect(result.verificationReports[0]?.validSupportEvidenceIds).toEqual([])
  })

  it('does not manufacture a downgrade when a correction targets an already-unknown boundary row', async () => {
    const boundaryEvidence = {
      evidenceId: 'e-already-unknown',
      hypothesisId: hypothesis.id,
      agentId: 'boundary-review',
      status: 'unknown' as const,
      evidenceRole: 'diagnostic_boundary' as const,
      contradictionScope: 'data_quality' as const,
      claim: '目录覆盖不是机制证据',
      observed: '只有数据可用性记录',
      method: 'catalog-audit',
      sourceIds: [],
      sampleIds: [],
      predictionIds: [],
      falsificationConditionIds: [],
      quantitativeResults: [],
      limitations: ['尚无机制区分测量'],
      round: 1,
    }
    const result = await runScientificLoopGraph(
      input(undefined, 1),
      dependencies({
        evidenceAgents: [
          {
            id: 'boundary-review',
            label: 'boundary review',
            capabilities: ['fact-check'],
            run: async () => ({
              evidence: [boundaryEvidence],
              corrections: [
                {
                  stage: 'B-review',
                  kind: 'provenance' as const,
                  severity: 'warning' as const,
                  message: '目录覆盖不能升级为机制证据。',
                  action: '保持 unknown。',
                  affectedIds: [boundaryEvidence.evidenceId],
                  evidenceAction: 'downgrade_to_unknown' as const,
                },
              ],
            }),
          },
        ],
      }),
    )

    const stored = result.evidence.find((item) => item.evidenceId === boundaryEvidence.evidenceId)
    expect(stored?.status).toBe('unknown')
    expect(stored?.adjudication).toBeUndefined()
    expect(result.correctionsSummary?.realDowngradeCount).toBe(0)
  })

  it('audits the same diagnostic metric reused as support by three competing hypotheses', async () => {
    const competitors = ['a', 'b', 'c'].map((suffix, index) => ({
      ...hypothesis,
      id: `h-shared-${suffix}`,
      statement: `候选机制 ${index + 1}`,
    }))
    const sharedEvidence = competitors.map((item, index) => ({
      evidenceId: `e-shared-dem-${index}`,
      hypothesisId: item.id,
      agentId: 'explorer-dem',
      status: 'support' as const,
      evidenceRole: 'prediction_consistent' as const,
      contradictionScope: 'mechanism' as const,
      claim: '与 DEM 温度预测相容；不具机制区分力',
      observed: 'DEM 中位温度',
      method: 'regularized-dem',
      sourceIds: ['local:coronal-evidence-70gb-v1'],
      sampleIds: ['sample-1'],
      predictionIds: [`${item.id}:prediction:1`],
      falsificationConditionIds: [],
      quantitativeResults: [
        {
          metric: 'aia_dem_em_weighted_log10_temperature',
          estimate: 6.57,
          lowerBound: 6.45,
          upperBound: 6.69,
          confidenceLevel: 0.95,
        },
      ],
      lineage: {
        eventGroupId: `event-${index}`,
        relatedEventGroupIds: [],
        rawDataFingerprint: `raw-${index}`,
        observableFamily: 'thermal_variability' as const,
        methodFamily: 'regularized-dem',
        analysisSplit: 'validation' as const,
      },
      provenance: {
        processingRunId: 'processing-shared-dem',
        dataSnapshotIds: ['snapshot-shared'],
        artifactIds: ['artifact-shared'],
        generatedBy: 'explorer-dem',
        deterministic: true as const,
      },
      limitations: [],
      round: 1,
    }))
    const result = await runScientificLoopGraph(
      input(undefined, 1),
      dependencies({
        generateHypotheses: async ({ round }) => competitors.map((item) => ({ ...item, round })),
        evidenceAgents: [
          {
            id: 'explorer-dem',
            label: 'DEM diagnostics',
            capabilities: ['observation-analysis'],
            run: async () => ({ evidence: sharedEvidence }),
          },
        ],
      }),
    )

    const reuseCorrections = result.corrections.filter((item) =>
      item.message.includes('被 3 个不同机制假设同时标记为预测相容支持'),
    )
    expect(reuseCorrections).toHaveLength(1)
    expect(reuseCorrections[0]!.message).toContain('aia_dem_em_weighted_log10_temperature')
    expect(reuseCorrections[0]!.evidenceAction).toBe('none')
    expect(reuseCorrections[0]!.affectedIds).toEqual(
      expect.arrayContaining(sharedEvidence.map((item) => item.evidenceId)),
    )
    // The shared records stay valid: reuse is a boundary note, not a revocation.
    for (const record of sharedEvidence) {
      expect(result.evidence.find((item) => item.evidenceId === record.evidenceId)?.status).toBe(
        'support',
      )
    }
  })

  it('reports tested versus untested predictions separately from gate coverage', async () => {
    const twoPredictionHypothesis: ScientificHypothesis = {
      ...hypothesis,
      predictions: ['已测的时序预测', '从未执行的传播速度预测'],
    }
    const completedTask: ValidationTask = {
      taskId: 'task-test-1',
      route: 'B',
      type: 'analysis',
      objective: '测一下已注册的时序预测',
      hypothesisIds: [twoPredictionHypothesis.id],
      predictionIds: [`${twoPredictionHypothesis.id}:prediction:1`],
      falsificationConditionIds: [],
      requiredSourceIds: [],
      discriminatingOutcomes: ['支持', '反驳'],
      triggeredBy: 'round-1',
      status: 'completed',
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'fp-test-1',
    }
    const result = await runScientificLoopGraph(
      input(undefined, 1),
      dependencies({
        generateHypotheses: async ({ round }) => [{ ...twoPredictionHypothesis, round }],
        evidenceAgents: [
          {
            id: 'partial-tester',
            label: 'partial tester',
            capabilities: ['timeseries-analysis'],
            run: async () => ({
              evidence: [
                {
                  ...gateReadySupport(twoPredictionHypothesis.id)[0]!,
                  evidenceRole: 'prediction_consistent' as const,
                },
              ],
              validationTasks: [completedTask],
            }),
          },
        ],
      }),
    )

    const report = result.verificationReports.find(
      (item) => item.hypothesisId === twoPredictionHypothesis.id,
    )
    expect(report?.testedPredictionIds).toEqual([`${twoPredictionHypothesis.id}:prediction:1`])
    expect(report?.untestedPredictionIds).toEqual([`${twoPredictionHypothesis.id}:prediction:2`])
    expect(report?.nextActions.join(' ')).toContain('补测从未执行的预测')
    expect(report?.nextActions.join(' ')).toContain('缺机制区分性支持')
  })

  it('downgrades stale executable tasks honestly at the execution boundary', async () => {
    const staleTask: ValidationTask = {
      taskId: 'task-stale-exec',
      route: 'B',
      type: 'analysis',
      objective: '一个声称可执行但没有任何执行器能认领的任务',
      hypothesisIds: [hypothesis.id],
      predictionIds: [],
      falsificationConditionIds: [],
      requiredSourceIds: ['local:coronal-evidence-70gb-v1'],
      discriminatingOutcomes: ['支持', '反驳'],
      triggeredBy: 'round-1',
      status: 'planned',
      readiness: 'executable_now',
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'fp-stale',
    }
    const result = await runScientificLoopGraph(
      input(undefined, 1),
      dependencies({
        evidenceAgents: [
          {
            id: 'task-emitter',
            label: 'task emitter',
            capabilities: ['fact-check'],
            run: async () => ({ validationTasks: [staleTask] }),
          },
        ],
        canExecuteValidationTask: async () => false,
      }),
    )

    const stored = result.validationTasks.find((item) => item.taskId === 'task-stale-exec')
    expect(stored?.readiness).toBe('requires_data')
    expect(stored?.blockedReason).toContain('认领失败')
    expect(result.corrections.some((item) => item.message.includes('诚实降级'))).toBe(true)
  })

  it('deduplicates the same correction re-observed in different stages', async () => {
    const duplicateMessage = '同一来源边界问题只应记录一次。'
    const correctingAgent = (id: string, stage: 'B' | 'memory'): EvidenceAgent => ({
      id,
      label: id,
      capabilities: ['fact-check'],
      run: async () => ({
        corrections: [
          {
            stage,
            kind: 'provenance',
            severity: 'warning',
            message: duplicateMessage,
            action: '保持来源边界。',
            affectedIds: ['e-shared-boundary'],
            evidenceAction: 'none',
          },
        ],
      }),
    })
    const result = await runScientificLoopGraph(
      input(undefined, 1),
      dependencies({
        evidenceAgents: [correctingAgent('review-a', 'B'), correctingAgent('review-b', 'memory')],
      }),
    )

    expect(result.corrections.filter((item) => item.message === duplicateMessage)).toHaveLength(1)
    expect(result.correctionsSummary?.duplicateCorrectionCount).toBe(0)
  })

  it('reports operational closure as degraded when an evidence agent fails', async () => {
    const result = await runScientificLoopGraph(
      input(undefined, 1),
      dependencies({
        evidenceAgents: [
          {
            id: 'failed-review',
            label: 'failed review',
            capabilities: ['fact-check'],
            run: async () => {
              throw new Error('intentional operational failure')
            },
          },
        ],
      }),
    )

    expect(result.operationalClosure).toEqual(
      expect.objectContaining({
        status: 'degraded',
        agentFailures: [expect.objectContaining({ agentId: 'failed-review', status: 'failed' })],
      }),
    )
  })

  it('does not mark the whole run supported while a competing hypothesis is unresolved', async () => {
    const competitor: ScientificHypothesis = {
      ...hypothesis,
      id: 'h-wave-only',
      statement: '仅波动耗散解释当前加热',
      mechanismComposition: [{ mechanism: '阿尔芬波耗散', role: 'dominant' }],
      confidence: 0.55,
    }
    const result = await runScientificLoopGraph(
      input(undefined, 1),
      dependencies({
        generateHypotheses: async () => [{ ...hypothesis, confidence: 0.55 }, competitor],
        evidenceAgents: [
          {
            id: 'independent-event-analysis',
            label: 'independent event analysis',
            capabilities: ['timeseries-analysis'],
            run: async () => ({ evidence: gateReadySupport(hypothesis.id) }),
          },
        ],
        verifyProvenance: async () => true,
        synthesizeConclusion: async () => '耦合机制得到支持。',
      }),
    )

    expect(result.hypotheses.find((item) => item.id === hypothesis.id)?.status).toBe('supported')
    expect(result.hypotheses.find((item) => item.id === competitor.id)?.status).toBe('candidate')
    expect(result.scientificStatus).toBe('mixed')
    expect(result.corrections.some((item) => item.message.includes('尚未全部通过'))).toBe(false)
    expect(result.conclusion).toContain('当前共有 1 个候选假设通过严格支持门槛')
    expect(result.conclusion).toContain('3 条预测相容记录，其中 3 条计入严格门槛')
    expect(result.conclusion).toContain('“预测相容”不等于机制得证')
    expect(result.outcomeProfile).toEqual(expect.objectContaining({ supported: 1, candidate: 1 }))
  })

  it('marks a hypothesis falsified only after a replicated, powered, holdout-tested fatal condition', async () => {
    const contradictions = gateReadySupport(hypothesis.id)
      .slice(0, 2)
      .map((item, index) => ({
        ...item,
        evidenceId: `e-falsification-complete-${index + 1}`,
        status: 'contradict' as const,
        predictionIds: [],
        falsificationConditionIds: [`${hypothesis.id}:falsification:1`],
        lineage: {
          ...item.lineage,
          analysisSplit: index === 1 ? ('holdout' as const) : ('validation' as const),
        },
      }))
    const eliminationTask: ValidationTask = {
      taskId: 'task-replicated-falsification',
      executorId: 'counterexample-executor',
      route: 'B',
      type: 'analysis',
      objective: '冻结阈值后在独立事件复测致命证伪条件',
      hypothesisIds: [hypothesis.id],
      predictionIds: [`${hypothesis.id}:prediction:1`],
      falsificationConditionIds: [`${hypothesis.id}:falsification:1`],
      requiredSourceIds: ['source-1', 'source-2'],
      readiness: 'executable_now',
      detectability: {
        effectMetric: 'standardized-counterexample-effect',
        alpha: 0.05,
        targetPower: 0.8,
        achievedPower: 0.85,
        minimumMeaningfulEffect: 0.5,
        minimumDetectableEffect: 0.45,
        independentEventCount: 2,
        minimumIndependentEventCount: 2,
        adequate: true,
        assumptions: ['冻结阈值', '独立事件'],
      },
      discriminatingOutcomes: ['致命反例复现', '不复现'],
      triggeredBy: hypothesis.id,
      status: 'completed',
      resultEvidenceIds: contradictions.map((item) => item.evidenceId),
      round: 1,
      fingerprint: 'replicated-falsification',
    }
    const result = await runScientificLoopGraph(
      input(undefined, 1),
      dependencies({
        generateHypotheses: async () => [{ ...hypothesis, confidence: 0.55 }],
        evidenceAgents: [
          {
            id: 'falsification-analysis',
            label: 'falsification analysis',
            capabilities: ['counterexample-search'],
            run: async () => ({ evidence: contradictions, validationTasks: [eliminationTask] }),
          },
        ],
        verifyProvenance: async () => true,
      }),
    )

    expect(result.hypotheses[0]?.status).toBe('eliminated')
    expect(result.scientificStatus).toBe('falsified')
    expect(result.verificationReports[0]?.eliminationGatePassed).toBe(true)
  })

  it('resumes the same State checkpoint after a node failure', async () => {
    const runtime = createInMemoryScientificRuntime()
    let generationCalls = 0
    const deps = dependencies({
      generateHypotheses: async ({ round }) => {
        generationCalls += 1
        if (generationCalls === 1) throw new Error('temporary A failure')
        return [{ ...hypothesis, round }]
      },
    })

    await expect(runScientificLoopGraph({ ...input(undefined, 1), runtime }, deps)).rejects.toThrow(
      'temporary A failure',
    )

    const result = await runScientificLoopGraph(
      { ...input(undefined, 1), runtime, resume: true },
      deps,
    )

    expect(generationCalls).toBe(2)
    expect(result.hypotheses).toHaveLength(1)
    expect(result.terminationReason).toBe('max_rounds_reached')
  })
})
