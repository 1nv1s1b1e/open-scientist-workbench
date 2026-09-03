import { describe, expect, it } from 'vite-plus/test'
import {
  executorContractByDiagnosticId,
  executorContractByExecutorId,
  EXECUTOR_CONTRACTS,
  inferableExecutorContracts,
  COMPOUND_TASK_REJECTION_PATTERN,
  type LocalExecutorContract,
} from '../src/scientific-loop/executor-contracts.ts'
import type { LocalCoronalAnalysis } from '../src/scientific-loop/local-processing.ts'

type LocalMechanismKey = keyof LocalCoronalAnalysis['diagnostics']

describe('executor contracts registry (P1-7 single source)', () => {
  const executorIds = EXECUTOR_CONTRACTS.map((contract) => contract.executorId)
  const diagnosticIds = EXECUTOR_CONTRACTS.map((contract) => contract.diagnosticId)

  it('maps every diagnostic ID bijectively onto an executor ID', () => {
    expect(new Set(executorIds).size).toBe(executorIds.length)
    expect(new Set(diagnosticIds).size).toBe(diagnosticIds.length)
    for (const contract of EXECUTOR_CONTRACTS) {
      expect(executorContractByDiagnosticId(contract.diagnosticId)?.executorId).toBe(
        contract.executorId,
      )
      expect(executorContractByExecutorId(contract.executorId)?.diagnosticId).toBe(
        contract.diagnosticId,
      )
    }
  })

  it('keeps the historical keyword-inference order and coverage', () => {
    expect(inferableExecutorContracts().map((contract) => contract.executorId)).toEqual([
      'coronal-cooling-sequence-v2',
      'coronal-dem-inversion-v1',
      'coronal-wcs-unified-roi-v2',
      'coronal-event-threshold-sensitivity-v2',
      'coronal-hmi-magnetic-audit-v2',
      'coronal-spatial-wave-v1',
      'coronal-event-fluence-distribution-v1',
      'coronal-hmi-sharp-vector-v1',
      'coronal-aia-hmi-temporal-association-v1',
      'coronal-iris-spectroscopy-v1',
      'coronal-timeseries-lag-v1',
      'coronal-background-variability-v1',
      'coronal-hot-channel-variability-v1',
    ])
  })

  it('never lets the inference chain claim holdout or external work', () => {
    const inferable = new Set(inferableExecutorContracts().map((contract) => contract.executorId))
    expect(inferable.has('coronal-cross-event-holdout-v1')).toBe(false)
    expect(inferable.has('external')).toBe(false)
  })

  it('preserves the metric-attribution asymmetries documented in the audit', () => {
    const cooling = executorContractByExecutorId('coronal-cooling-sequence-v2')
    expect(cooling?.metricPrefix).toBe('aia_cooling_')
    expect(cooling?.mechanismKey).toBe<LocalMechanismKey>('cooling_sequence')

    // The holdout aggregates across observable families: no metric filter.
    expect(executorContractByExecutorId('coronal-cross-event-holdout-v1')?.metricPrefix).toBeNull()
    // The WCS audit only produces measurement-quality metrics: filters all.
    expect(executorContractByExecutorId('coronal-wcs-unified-roi-v2')?.metricPrefix).toBe('')
    expect(executorContractByExecutorId('coronal-wcs-unified-roi-v2')?.mechanismKey).toBeNull()
    expect(
      executorContractByExecutorId('coronal-wcs-unified-roi-v2')?.qualityPreconditionOnly,
    ).toBe(true)
  })

  it('keeps the IRIS compound-rejection bypass on the requested path only', () => {
    const iris = executorContractByExecutorId('coronal-iris-spectroscopy-v1')
    expect(iris?.bypassesCompoundRejection).toBe(true)
    // A compound IRIS objective that also mentions an unimplemented step.
    const compound = '复现 IRIS Si IV 相对 Doppler 并检查 MHD 前向模型'
    expect(iris?.requestedPattern.test(compound)).toBe(true)
    expect(COMPOUND_TASK_REJECTION_PATTERN.test(compound)).toBe(true)
    // Every other contract stays subject to the rejection.
    for (const contract of EXECUTOR_CONTRACTS as readonly LocalExecutorContract[]) {
      if (contract.executorId === 'coronal-iris-spectroscopy-v1') continue
      expect(contract.bypassesCompoundRejection ?? false).toBe(false)
    }
  })

  it('types mechanism keys against the local diagnostics record', () => {
    const known: Partial<Record<string, LocalMechanismKey | null>> = {
      'coronal-timeseries-lag-v1': 'wave',
      'coronal-spatial-wave-v1': 'spatial_wave',
      'coronal-dem-inversion-v1': 'dem_temperature',
      'coronal-hmi-sharp-vector-v1': 'vector_magnetic_evolution',
      'coronal-aia-hmi-temporal-association-v1': 'magnetic_thermal_association',
      'coronal-iris-spectroscopy-v1': 'spectroscopy',
      'coronal-event-fluence-distribution-v1': 'event_fluence_distribution',
      'coronal-hot-channel-variability-v1': 'reconnection',
      'coronal-background-variability-v1': 'reconnection',
      'coronal-event-threshold-sensitivity-v2': 'reconnection',
    }
    for (const [executorId, mechanismKey] of Object.entries(known)) {
      expect(executorContractByExecutorId(executorId)?.mechanismKey).toBe(mechanismKey)
    }
  })

  it('documents every contract with a metric attribution policy', () => {
    for (const contract of EXECUTOR_CONTRACTS as readonly LocalExecutorContract[]) {
      expect(typeof contract.metricPrefix === 'string' || contract.metricPrefix === null).toBe(true)
      expect(contract.requestedPattern instanceof RegExp).toBe(true)
    }
  })
})
