import { describe, expect, it } from 'vite-plus/test'
import type { EvidenceRecord, ValidationTask } from '@open-scientist/schema'
import {
  auditIndependenceConsistency,
  assessEliminationGate,
  assessSupportGate,
} from '../src/scientific-loop/evidence-gate.ts'

function records(): EvidenceRecord[] {
  return [1, 2, 3].map((index) => ({
    evidenceId: `e-${index}`,
    hypothesisId: 'h-1',
    agentId: index === 1 ? 'agent-a' : 'agent-b',
    status: 'support' as const,
    evidenceRole: 'mechanism_discriminating' as const,
    contradictionScope: 'mechanism' as const,
    claim: `quantitative support ${index}`,
    observed: `observed value ${index}`,
    method: `method-${index}`,
    sourceIds: [`source-${index}`],
    sampleIds: [`sample-${index}`],
    predictionIds: ['h-1:prediction:1'],
    falsificationConditionIds: [],
    metrics: { effectSize: index / 10 },
    quantitativeResults: [
      {
        metric: 'effect-size',
        estimate: index / 10,
        lowerBound: index / 10 - 0.02,
        upperBound: index / 10 + 0.02,
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
      generatedBy: 'deterministic-processor',
      deterministic: true as const,
    },
    limitations: [],
    round: 1,
  }))
}

describe('scientific support gate', () => {
  it('audits raw-fingerprint reuse across nominally independent event groups', () => {
    const inconsistent = records().slice(0, 2).map((item) => ({
      ...item,
      lineage: { ...item.lineage!, rawDataFingerprint: 'raw-shared-across-events' },
    }))

    const issues = auditIndependenceConsistency(inconsistent)

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'fingerprint_reused_across_events',
        evidenceIds: ['e-1', 'e-2'],
      }),
    ])
  })

  it('audits fingerprint drift within an equivalent event/method lineage', () => {
    const drift = records().slice(0, 2).map((item, index) => ({
      ...item,
      lineage: {
        ...item.lineage!,
        eventGroupId: 'same-event',
        rawDataFingerprint: `drift-${index}`,
        observableFamily: 'wave_timing' as const,
        methodFamily: 'same-method',
        analysisSplit: 'validation' as const,
      },
    }))

    expect(auditIndependenceConsistency(drift)).toEqual([
      expect.objectContaining({ kind: 'lineage_fingerprint_drift' }),
    ])
  })

  it('requires quantitative, auditable and independent support before promotion', () => {
    const assessment = assessSupportGate(records(), {
      requiredPredictionIds: ['h-1:prediction:1'],
    })

    expect(assessment.meetsEvidenceCriteria).toBe(true)
    expect(assessment.supported).toBe(true)
    expect(assessment.processingRunIds).toHaveLength(3)
    expect(assessment.artifactPackages).toHaveLength(3)
  })

  it('grades auditable prediction-consistent records as limited without unlocking the gate', () => {
    const consistent = records()
      .slice(0, 1)
      .map((item) => ({ ...item, evidenceRole: 'prediction_consistent' as const }))
    const assessment = assessSupportGate(consistent, {
      requiredPredictionIds: ['h-1:prediction:1'],
    })

    expect(assessment.supported).toBe(false)
    expect(assessment.validSupportRecords).toHaveLength(0)
    expect(assessment.auditableConsistentRecords).toHaveLength(1)
    expect(assessment.evidenceStrengthGrade).toBe('limited')
    expect(assessment.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('lift the ordinal grade to limited'),
      ]),
    )
  })

  it('grades multi-event auditable prediction-consistent support as moderate without unlocking the gate', () => {
    const consistent = records()
      .slice(0, 2)
      .map((item, index) => ({
        ...item,
        evidenceRole: 'prediction_consistent' as const,
        lineage: {
          ...item.lineage!,
          eventGroupId: `consistent-event-${index}`,
          rawDataFingerprint: `consistent-raw-${index}`,
          observableFamily: index === 0 ? ('thermal_variability' as const) : ('magnetic_evolution' as const),
          methodFamily: index === 0 ? 'regularized-dem' : 'sharp-vector-proxy',
        },
      }))
    const assessment = assessSupportGate(consistent, {
      requiredPredictionIds: ['h-1:prediction:1'],
    })

    expect(assessment.supported).toBe(false)
    expect(assessment.meetsEvidenceCriteria).toBe(false)
    expect(assessment.evidenceStrengthGrade).toBe('moderate')
  })

  it('keeps broken mechanism_discriminating records at insufficient instead of lifting them', () => {
    const broken = records().map((item) => ({
      ...item,
      quantitativeResults: [],
      metrics: undefined,
    }))
    const assessment = assessSupportGate(broken, {
      requiredPredictionIds: ['h-1:prediction:1'],
    })

    expect(assessment.evidenceStrengthGrade).toBe('insufficient')
  })

  it('rejects repeated textual support without inventing a confidence probability', () => {
    const repeated = records().map((item) => ({
      ...item,
      method: 'same-method',
      agentId: 'same-agent',
      metrics: undefined,
      quantitativeResults: [],
      lineage: {
        ...item.lineage!,
        eventGroupId: 'same-event',
        rawDataFingerprint: 'same-raw-data',
        observableFamily: 'wave_timing' as const,
        methodFamily: 'same-method',
        analysisSplit: 'validation' as const,
      },
      provenance: {
        ...item.provenance!,
        processingRunId: 'same-processing-run',
        dataSnapshotIds: ['same-snapshot'],
        artifactIds: ['same-artifact'],
      },
    }))
    const assessment = assessSupportGate(repeated, {
      requiredPredictionIds: ['h-1:prediction:1'],
    })

    expect(assessment.supported).toBe(false)
    expect(assessment.reasons).toEqual(
      expect.arrayContaining([
        'requires at least 3 mechanism-discriminating support records',
        'requires at least 3 independent event groups',
        'requires at least 3 independent raw-data lineages',
        'requires at least 2 observable families',
        'requires at least 2 method families',
        'requires at least one holdout evidence record',
      ]),
    )
    expect(assessment.evidenceStrengthGrade).toBe('insufficient')
  })

  it('lets an auditable contradiction veto support', () => {
    const contradiction: EvidenceRecord = {
      ...records()[0]!,
      evidenceId: 'e-contradict',
      status: 'contradict',
      agentId: 'counterexample-agent',
    }
    const assessment = assessSupportGate([...records(), contradiction], {
      requiredPredictionIds: ['h-1:prediction:1'],
    })

    expect(assessment.supported).toBe(false)
    expect(assessment.validContradictionRecords).toHaveLength(1)
    expect(assessment.evidenceStrengthGrade).toBe('conflicted')
  })

  it('does not count non-unique compatibility or diagnostic-specificity failures as mechanism decisions', () => {
    const compatible = records().map((item) => ({
      ...item,
      evidenceRole: 'prediction_consistent' as const,
    }))
    const specificityFailure: EvidenceRecord = {
      ...records()[0]!,
      evidenceId: 'e-specificity-boundary',
      status: 'contradict',
      evidenceRole: 'diagnostic_boundary',
      contradictionScope: 'diagnostic_specificity',
    }
    const assessment = assessSupportGate([...compatible, specificityFailure], {
      requiredPredictionIds: ['h-1:prediction:1'],
    })

    expect(assessment.supported).toBe(false)
    expect(assessment.validSupportRecords).toHaveLength(0)
    expect(assessment.validContradictionRecords).toHaveLength(0)
  })

  it('excludes revoked evidence even when its original fields were gate-ready', () => {
    const revoked: EvidenceRecord = {
      ...records()[0]!,
      adjudication: {
        status: 'revoked',
        correctionIds: ['correction-revoke-1'],
        reason: 'provenance audit failed',
      },
    }
    const assessment = assessSupportGate([revoked], {
      requiredPredictionIds: ['h-1:prediction:1'],
      minSupportRecords: 1,
      minIndependentEvents: 1,
      minObservableFamilies: 1,
      minMethodFamilies: 1,
      requireHoldout: false,
    })

    expect(assessment.validSupportRecords).toHaveLength(0)
    expect(assessment.supported).toBe(false)
  })

  it('does not count reruns of the same raw event as independent evidence', () => {
    const reruns = records().map((item, index) => ({
      ...item,
      lineage: {
        ...item.lineage!,
        eventGroupId: 'event-shared',
        rawDataFingerprint: 'raw-shared',
      },
      provenance: {
        ...item.provenance!,
        processingRunId: `rerun-${index}`,
      },
    }))

    const assessment = assessSupportGate(reruns, {
      requiredPredictionIds: ['h-1:prediction:1'],
    })

    expect(assessment.supported).toBe(false)
    expect(assessment.eventGroupIds).toEqual(['event-shared'])
    expect(assessment.reasons).toContain('requires at least 3 independent event groups')
  })

  it('keeps the strong threshold explicit and configurable without changing closure semantics', () => {
    const assessment = assessSupportGate([records()[0]!], {
      requiredPredictionIds: ['h-1:prediction:1'],
      minSupportRecords: 1,
      minIndependentEvents: 1,
      minObservableFamilies: 1,
      minMethodFamilies: 1,
      requireHoldout: false,
    })

    expect(assessment.supported).toBe(true)
    expect(assessment.policy.minIndependentEvents).toBe(1)
    expect(assessment.policy.requireHoldout).toBe(false)
    expect(assessment.evidenceStrengthGrade).toBe('strong')
  })

  it('eliminates only after a pre-registered falsification is independently replicated with adequate detectability', () => {
    const contradictionRecords = records().slice(0, 2).map((item, index) => ({
      ...item,
      evidenceId: `e-fatal-${index + 1}`,
      status: 'contradict' as const,
      predictionIds: [],
      falsificationConditionIds: ['h-1:falsification:1'],
      lineage: {
        ...item.lineage!,
        analysisSplit: index === 1 ? ('holdout' as const) : ('validation' as const),
      },
    }))
    const task: ValidationTask = {
      taskId: 'task-fatal-test',
      executorId: 'test-counterexample-executor',
      route: 'B',
      type: 'analysis',
      objective: '以冻结阈值复测预注册证伪条件',
      hypothesisIds: ['h-1'],
      predictionIds: ['h-1:prediction:1'],
      falsificationConditionIds: ['h-1:falsification:1'],
      requiredSourceIds: ['source-1', 'source-2'],
      readiness: 'executable_now',
      detectability: {
        effectMetric: 'standardized-counterexample-effect',
        alpha: 0.05,
        targetPower: 0.8,
        achievedPower: 0.84,
        minimumMeaningfulEffect: 0.5,
        minimumDetectableEffect: 0.45,
        independentEventCount: 2,
        minimumIndependentEventCount: 2,
        adequate: true,
        assumptions: ['冻结选择规则', '事件独立'],
      },
      discriminatingOutcomes: ['复现致命反例', '未复现'],
      triggeredBy: 'h-1',
      status: 'completed',
      resultEvidenceIds: contradictionRecords.map((item) => item.evidenceId),
      round: 1,
      fingerprint: 'fatal-test-fingerprint',
    }
    const assessment = assessEliminationGate(contradictionRecords, [task], {
      requiredFalsificationConditionIds: ['h-1:falsification:1'],
    })

    expect(assessment.eliminated).toBe(true)
    expect(assessment.decisiveFalsificationConditionIds).toEqual([
      'h-1:falsification:1',
    ])
    expect(assessment.adequateTaskIds).toEqual(['task-fatal-test'])
  })

  it('does not eliminate from one event, an underpowered null result, or diagnostic-specificity failure', () => {
    const singleEvent = {
      ...records()[0]!,
      status: 'contradict' as const,
      falsificationConditionIds: ['h-1:falsification:1'],
    }
    const assessment = assessEliminationGate([singleEvent], [], {
      requiredFalsificationConditionIds: ['h-1:falsification:1'],
    })

    expect(assessment.eliminated).toBe(false)
    expect(assessment.reasons.join(' ')).toContain('尚非决定性证伪')
  })
})
