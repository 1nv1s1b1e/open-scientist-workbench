import {
  ScientificHypothesisSchema,
  scientificFalsificationConditionId,
  scientificPredictionId,
  type ScientificHypothesis,
} from '@open-scientist/schema'
import { describe, expect, it } from 'vite-plus/test'
import {
  cohortMechanismEvidence,
  localCounterexampleAgent,
  normalizeScopedImpulsiveStatement,
} from '../src/scientific-loop/default-services.ts'
import { assessEliminationGate, assessSupportGate } from '../src/scientific-loop/evidence-gate.ts'
import { ValidationTaskSchema } from '@open-scientist/schema'
import type { EvidenceAgentContext } from '../src/scientific-loop/evidence-workgroup.ts'
import type {
  LocalProcessingResult,
  ObservableDiagnostic,
} from '../src/scientific-loop/local-processing.ts'

const q = (metric: string) => ({
  metric,
  estimate: 2,
  lowerBound: 1,
  upperBound: 3,
  confidenceLevel: 0.95,
  unit: '1',
})

const unknown = (): ObservableDiagnostic => ({ observableStatus: 'unknown', boundary: 'test' })
const support = (metric: string): ObservableDiagnostic => ({
  observableStatus: 'support',
  boundary: 'test',
  quantitativeResults: [q(metric)],
})

function processing(
  caseId: string,
  mode: 'discovery' | 'validation' | 'holdout',
  supported: Array<'events' | 'cooling' | 'dem' | 'spectroscopy'>,
  role = 'independent_target',
): LocalProcessingResult {
  const diagnostics = {
    wave: unknown(),
    reconnection: supported.includes('events') ? support(`${caseId}-events`) : unknown(),
    coupled: unknown(),
    cooling_sequence: supported.includes('cooling') ? support(`${caseId}-cooling`) : unknown(),
    dem_temperature: supported.includes('dem') ? support(`${caseId}-dem`) : unknown(),
    magnetic_evolution: unknown(),
    event_fluence_distribution: supported.includes('events')
      ? support('aia_hot_event_relative_fluence_power_law_exponent')
      : unknown(),
    spectroscopy: supported.includes('spectroscopy')
      ? support(`${caseId}-spectroscopy`)
      : unknown(),
  }
  return {
    processingRunId: `processing-${caseId}`,
    snapshotId: `snapshot-${caseId}`,
    metricsArtifactId: `metrics-${caseId}`,
    figureArtifactId: `figure-${caseId}`,
    provenance: {
      processingRunId: `processing-${caseId}`,
      dataSnapshotIds: [`snapshot-${caseId}`],
      artifactIds: [`metrics-${caseId}`, `figure-${caseId}`],
      generatedBy: 'test',
      deterministic: true,
    },
    analysis: {
      mode,
      manifestSha256: `manifest-${caseId}`,
      target: {
        caseId,
        label: caseId,
        role,
        sampleIds: [`sample-${caseId}`],
        sampledChecksums: { [`sample-${caseId}`]: `checksum-${caseId}` },
      },
      baseline: null,
      diagnostics,
      limitations: [],
    },
  } as unknown as LocalProcessingResult
}

function hypothesis(
  mechanism: string,
  predictions: string[] = [
    '94/131 Å 热通道应出现稳健的间歇事件或 fluence 尾部。',
    '独立留出事件的 IRIS Si IV 光谱应出现相对 Doppler 流动。',
  ],
): ScientificHypothesis {
  return ScientificHypothesisSchema.parse({
    id: 'h-impulsive',
    statement: '所选活动区样本由低频脉冲热过程而非严格近稳态热过程主导。',
    mechanismComposition: [{ mechanism, role: 'dominant' }],
    predictions,
    falsificationConditions: ['冻结事件中不出现间歇性。', '留出事件不出现相对流动。'],
    sourceIds: ['local:test'],
    scope: 'test',
    confidence: 0.6,
    parentId: null,
    round: 1,
    status: 'candidate',
  })
}

function context(candidate: ScientificHypothesis): EvidenceAgentContext {
  return {
    hypotheses: [candidate],
    validationTasks: [],
    evidence: [],
    round: 2,
  } as unknown as EvidenceAgentContext
}

describe('scoped cross-event mechanism discrimination', () => {
  it('makes a bounded cohort statement agree with its cross-event scope', () => {
    const candidate = ScientificHypothesisSchema.parse({
      id: 'h-cohort-scope',
      statement: 'AR11158热通道增强由低频脉冲加热过程主导，具体能量释放机制未定',
      mechanismComposition: [{ mechanism: '低频脉冲加热过程', role: 'dominant' }],
      predictions: [
        '验证集94/131 Å热事件尾与DEM热响应共存',
        '留出集IRIS Si IV相对Doppler位移与DEM热响应共存',
      ],
      falsificationConditions: ['验证集不满足', '留出集不满足'],
      sourceIds: ['local:coronal-evidence-70gb-v1'],
      scope: '所选跨事件validation/holdout样本，不作AR11158单事件断言',
      priority: 'high',
      priorityReason: '测试',
      parentId: null,
      round: 1,
      status: 'candidate',
    })

    expect(normalizeScopedImpulsiveStatement(candidate).statement).toBe(
      '所选跨事件样本中热通道增强由低频脉冲加热过程主导，具体能量释放机制未定',
    )
  })

  it('creates gate-ready evidence only after the frozen cohort rule is complete', () => {
    const candidate = hypothesis('低频脉冲加热（不限定具体微观耗散机制）')
    const records = cohortMechanismEvidence(context(candidate), [
      processing('event-a', 'validation', ['events', 'dem']),
      processing('event-b', 'validation', ['events', 'cooling']),
      processing('event-c', 'holdout', ['spectroscopy', 'dem']),
    ])
    expect(records).toHaveLength(3)
    expect(records.every((record) => record.evidenceRole === 'mechanism_discriminating')).toBe(true)
    const gate = assessSupportGate(records, {
      requiredPredictionIds: candidate.predictions.map((_, index) =>
        scientificPredictionId(candidate.id, index),
      ),
    })
    expect(gate.supported).toBe(true)
  })

  it('does not use the thermal-regime cohort to support a specific reconnection claim', () => {
    const candidate = hypothesis('低频纳耀斑磁重联脉冲加热')
    expect(
      cohortMechanismEvidence(context(candidate), [
        processing('event-a', 'validation', ['events', 'dem']),
        processing('event-b', 'validation', ['events', 'cooling']),
        processing('event-c', 'holdout', ['spectroscopy', 'dem']),
      ]),
    ).toEqual([])
  })

  it('does not use other active regions to promote a single-event dominance claim', () => {
    const candidate = {
      ...hypothesis('低频脉冲加热（具体微观机制未定）'),
      statement: 'AR11158 日冕加热由低频脉冲过程主导，具体能量释放机制未定。',
      scope: '仅限 NOAA 11158',
    }
    expect(
      cohortMechanismEvidence(context(candidate), [
        processing('event-a', 'validation', ['events', 'dem']),
        processing('event-b', 'validation', ['events', 'cooling']),
        processing('event-c', 'holdout', ['spectroscopy', 'dem']),
      ]),
    ).toEqual([])
  })

  it('rejects a nominally scoped candidate whose predictions smuggle in a nanoflare claim', () => {
    const candidate = hypothesis('低频脉冲加热（不限定具体微观耗散机制）', [
      '94/131 Å 事件 fluence 指数应接近纳耀斑模型预测。',
      '独立留出事件的 IRIS Si IV 光谱应出现相对 Doppler 流动。',
    ])
    expect(
      cohortMechanismEvidence(context(candidate), [
        processing('event-a', 'validation', ['events', 'dem']),
        processing('event-b', 'validation', ['events', 'cooling']),
        processing('event-c', 'holdout', ['spectroscopy', 'dem']),
      ]),
    ).toEqual([])
  })

  it('allows an explicitly non-unique model comparison only at the thermal-process level', () => {
    const candidate = hypothesis('低频脉冲加热（具体微观机制未定）', [
      '94/131 Å 事件 fluence 呈幂律尾部，与纳耀斑预测相容但非唯一。',
      '独立留出事件的 IRIS Si IV 光谱应出现相对 Doppler 流动。',
    ])
    const records = cohortMechanismEvidence(context(candidate), [
      processing('event-a', 'validation', ['events', 'dem']),
      processing('event-b', 'validation', ['events', 'cooling']),
      processing('event-c', 'holdout', ['spectroscopy', 'dem']),
    ])
    expect(records).toHaveLength(3)
    expect(records.every((record) => record.claim.includes('不据此认定具体磁重联或纳耀斑'))).toBe(
      true,
    )
  })

  it('does not count a power-law fit when its uncertainty crosses the claimed exponent bound', () => {
    const candidate = hypothesis('低频脉冲加热（不限定具体微观耗散机制）', [
      '94/131 Å 事件 fluence 呈幂律且指数小于 2。',
      '独立留出事件的 IRIS Si IV 光谱应出现相对 Doppler 流动。',
    ])
    expect(
      cohortMechanismEvidence(context(candidate), [
        processing('event-a', 'validation', ['events', 'dem']),
        processing('event-b', 'validation', ['events', 'cooling']),
        processing('event-c', 'holdout', ['spectroscopy', 'dem']),
      ]),
    ).toEqual([])
  })

  it('never counts discovery or background-control windows as confirmatory events', () => {
    const candidate = hypothesis('低频脉冲加热（不限定具体微观耗散机制）')
    expect(
      cohortMechanismEvidence(context(candidate), [
        processing('background-a', 'validation', ['events', 'dem'], 'background_control'),
        processing('discovery-b', 'discovery', ['events', 'cooling']),
        processing('holdout-c', 'holdout', ['spectroscopy', 'dem']),
      ]),
    ).toEqual([])
  })

  it('emits a gate-eligible critical_prediction counterexample when the background ratio reverses', async () => {
    const candidate = hypothesis('间歇性磁重联')
    const base = processing('ar11158-window', 'validation', [])
    const reversed = {
      ...base,
      analysis: {
        ...base.analysis,
        baseline: {
          caseId: 'ar11158-background',
          label: '同活动区背景',
          sampleIds: ['sample-background'],
          sampledChecksums: {},
          readFailures: [],
        },
        diagnostics: {
          ...base.analysis.diagnostics,
          reconnection: {
            observableStatus: 'unknown',
            boundary: 'test',
            targetToBackgroundVariabilityRatio: 1.05,
            quantitativeResults: [
              {
                metric: 'target_to_background_hot_channel_variability_ratio',
                estimate: 1.05,
                lowerBound: 0.9,
                upperBound: 1.2,
                confidenceLevel: 0.95,
                unit: 'ratio',
              },
            ],
          },
        },
      },
    } as unknown as LocalProcessingResult
    const backgroundTask = ValidationTaskSchema.parse({
      taskId: 'task-bg-1',
      route: 'B',
      type: 'analysis',
      objective: '比较目标窗口与同活动区冻结背景窗口的热通道相对变异',
      hypothesisIds: [candidate.id],
      predictionIds: [scientificPredictionId(candidate.id, 0)],
      falsificationConditionIds: [scientificFalsificationConditionId(candidate.id, 0)],
      requiredSourceIds: ['local:coronal-evidence-70gb-v1'],
      discriminatingOutcomes: ['支持', '反驳'],
      triggeredBy: 'test',
      status: 'planned',
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'fp-bg',
    })
    const agent = localCounterexampleAgent(async () => [reversed])
    const output = await agent.run({
      phenomenon: {} as never,
      hypotheses: [candidate],
      evidence: [],
      validationTasks: [backgroundTask],
      round: 1,
    })

    const record = output.evidence?.[0]
    expect(record?.status).toBe('contradict')
    expect(record?.contradictionScope).toBe('critical_prediction')
    expect(record?.falsificationConditionIds).toContain(
      scientificFalsificationConditionId(candidate.id, 0),
    )
    expect(record?.claim).toContain('预注册的关键证伪条件')

    // End-to-end: the bound counterexample is now decisive under the strong
    // elimination policy once it is replicated across two events with a
    // holdout split and an adequately powered completed task.
    const replicated = {
      ...record!,
      evidenceId: 'e-counterexample-replicated',
      lineage: {
        ...record!.lineage!,
        eventGroupId: 'ar-second-event',
        rawDataFingerprint: 'raw-second-event',
        analysisSplit: 'holdout' as const,
      },
    }
    const completedTask = {
      ...backgroundTask,
      status: 'completed' as const,
      resultEvidenceIds: [record!.evidenceId, replicated.evidenceId],
      detectability: {
        effectMetric: 'target_to_background_hot_channel_variability_ratio',
        alpha: 0.05,
        targetPower: 0.8,
        minimumMeaningfulEffect: 0.25,
        independentEventCount: 2,
        minimumIndependentEventCount: 2,
        adequate: true,
      },
    }
    const gate = assessEliminationGate([record!, replicated], [completedTask], {
      requiredFalsificationConditionIds: [scientificFalsificationConditionId(candidate.id, 0)],
    })
    expect(gate.eliminated).toBe(true)
    expect(gate.decisiveFalsificationConditionIds).toContain(
      scientificFalsificationConditionId(candidate.id, 0),
    )

    // The gate must still reject the unbound informational variant.
    const unbound = {
      ...record!,
      evidenceId: 'e-counterexample-unbound',
      falsificationConditionIds: [],
      contradictionScope: 'diagnostic_specificity' as const,
    }
    const weakGate = assessEliminationGate([record!, unbound], [completedTask], {
      requiredFalsificationConditionIds: [scientificFalsificationConditionId(candidate.id, 0)],
    })
    expect(weakGate.eliminated).toBe(false)
  })
})
