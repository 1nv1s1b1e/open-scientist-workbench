import { describe, expect, it } from 'vite-plus/test'
import type { EvidenceRecord, ValidationDetectability } from '@open-scientist/schema'
import { evaluateDetectability } from '../src/scientific-loop/detectability.ts'

const registered: ValidationDetectability = {
  effectMetric: 'registered-effect',
  unit: '1',
  alpha: 0.05,
  targetPower: 0.8,
  minimumMeaningfulEffect: 0.3,
  independentEventCount: 0,
  minimumIndependentEventCount: 3,
  adequate: false,
  assumptions: ['event-level independence'],
}

function record(index: number, halfWidth: number, event = `event-${index}`): EvidenceRecord {
  return {
    evidenceId: `e-${index}-${halfWidth}`,
    hypothesisId: 'h-1',
    taskId: 'task-1',
    status: 'unknown',
    evidenceRole: 'diagnostic_boundary',
    contradictionScope: 'mechanism',
    claim: 'registered diagnostic result',
    observed: 'finite interval',
    method: 'deterministic-test',
    sourceIds: ['source-1'],
    sampleIds: [`sample-${index}`],
    predictionIds: ['h-1:prediction:1'],
    falsificationConditionIds: ['h-1:falsification:1'],
    quantitativeResults: [
      {
        metric: 'registered-effect',
        estimate: 0.1,
        lowerBound: 0.1 - halfWidth,
        upperBound: 0.1 + halfWidth,
        confidenceLevel: 0.95,
      },
    ],
    lineage: {
      eventGroupId: event,
      relatedEventGroupIds: [],
      rawDataFingerprint: `raw-${event}`,
      observableFamily: 'wave_timing',
      methodFamily: 'deterministic-test',
      analysisSplit: index === 3 ? 'holdout' : 'validation',
    },
    provenance: {
      processingRunId: `run-${index}`,
      dataSnapshotIds: [`snapshot-${index}`],
      artifactIds: [`artifact-${index}`],
      generatedBy: 'test',
      deterministic: true,
    },
    limitations: [],
    round: 1,
  }
}

describe('registered detectability evaluation', () => {
  it('opens the adequate path only for precise independent event intervals', () => {
    const result = evaluateDetectability(registered, [
      record(1, 0.03),
      record(2, 0.03),
      record(3, 0.03),
    ])

    expect(result.independentEventCount).toBe(3)
    expect(result.achievedPower).toBeGreaterThanOrEqual(0.8)
    expect(result.minimumDetectableEffect).toBeLessThanOrEqual(0.3)
    expect(result.adequate).toBe(true)
  })

  it('does not count repeated processing of one event as added power', () => {
    const result = evaluateDetectability(registered, [
      record(1, 0.03, 'same-event'),
      record(2, 0.02, 'same-event'),
      record(3, 0.01, 'same-event'),
    ])

    expect(result.independentEventCount).toBe(1)
    expect(result.adequate).toBe(false)
  })

  it('reports a quantitative shortfall for an imprecise search', () => {
    const result = evaluateDetectability(registered, [
      record(1, 0.8),
      record(2, 0.8),
      record(3, 0.8),
    ])

    expect(result.achievedPower).toBeDefined()
    expect(result.minimumDetectableEffect).toBeGreaterThan(0.3)
    expect(result.adequate).toBe(false)
  })
})
