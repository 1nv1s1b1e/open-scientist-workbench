import { describe, expect, it } from 'vite-plus/test'

import { promoteEvidence } from '../src/scientific-loop/evidence-promotion.ts'

const base = {
  evidenceId: 'e-candidate-1',
  hypothesisId: 'h-1',
  claim: '候选数据似乎支持该机制',
  observed: '模型输出了未绑定产物的判断',
  method: 'unregistered-analysis',
  sourceIds: ['observation-1'],
  sampleIds: [],
  predictionIds: [],
  falsificationConditionIds: [],
  quantitativeResults: [],
  limitations: [],
  round: 1,
}

describe('scientific evidence promotion gate', () => {
  it('downgrades support without deterministic provenance to unknown', async () => {
    const result = await promoteEvidence(
      { ...base, status: 'support' },
      {
        stage: 'B',
        round: 1,
        hypothesisIds: ['h-1'],
        agentId: 'analysis-agent',
      },
    )

    expect(result.evidence?.status).toBe('unknown')
    expect(result.evidence?.limitations).toContain(
      '原始判断缺少可验证的数据处理溯源，已自动降级为 unknown。',
    )
    expect(result.corrections).toEqual([
      expect.objectContaining({
        kind: 'provenance',
        affectedIds: ['e-candidate-1'],
      }),
    ])
  })

  it('rejects a contradiction that has no bound counterexample sample', async () => {
    const result = await promoteEvidence(
      {
        ...base,
        status: 'contradict',
        provenance: {
          processingRunId: 'processing-1',
          dataSnapshotIds: ['snapshot-1'],
          artifactIds: ['artifact-1'],
          generatedBy: 'analysis-agent',
          deterministic: true,
        },
      },
      {
        stage: 'C',
        round: 1,
        hypothesisIds: ['h-1'],
        agentId: 'counterexample-agent',
      },
    )

    expect(result.evidence?.status).toBe('unknown')
    expect(result.corrections[0]).toMatchObject({
      kind: 'factual',
      severity: 'warning',
    })
  })

  it('downgrades a support record with provenance but no bound samples', async () => {
    const result = await promoteEvidence(
      {
        ...base,
        status: 'support',
        provenance: {
          processingRunId: 'processing-1',
          dataSnapshotIds: ['snapshot-1'],
          artifactIds: ['artifact-1'],
          generatedBy: 'analysis-agent',
          deterministic: true,
        },
      },
      {
        stage: 'B',
        round: 1,
        hypothesisIds: ['h-1'],
        agentId: 'analysis-agent',
        verifyProvenance: () => true,
      },
    )

    expect(result.evidence?.status).toBe('unknown')
    expect(result.corrections[0]).toMatchObject({ kind: 'factual' })
  })

  it('downgrades decisive evidence that targets an unregistered hypothesis', async () => {
    const result = await promoteEvidence(
      {
        ...base,
        hypothesisId: 'h-not-registered',
        status: 'support',
        sampleIds: ['sample-1'],
        provenance: {
          processingRunId: 'processing-1',
          dataSnapshotIds: ['snapshot-1'],
          artifactIds: ['artifact-1'],
          generatedBy: 'analysis-agent',
          deterministic: true,
        },
      },
      {
        stage: 'B',
        round: 1,
        hypothesisIds: ['h-1'],
        agentId: 'analysis-agent',
        verifyProvenance: () => true,
      },
    )

    expect(result.evidence?.status).toBe('unknown')
    expect(result.corrections[0]).toMatchObject({ kind: 'factual' })
  })

  it('keeps a fully traceable support record unchanged', async () => {
    const candidate = {
      ...base,
      status: 'support' as const,
      sampleIds: ['sample-1'],
      provenance: {
        processingRunId: 'processing-1',
        dataSnapshotIds: ['snapshot-1'],
        artifactIds: ['artifact-1'],
        generatedBy: 'analysis-agent',
        deterministic: true as const,
      },
    }
    const result = await promoteEvidence(candidate, {
      stage: 'B',
      round: 1,
      hypothesisIds: ['h-1'],
      agentId: 'analysis-agent',
      verifyProvenance: () => true,
    })

    expect(result.evidence).toEqual({
      ...candidate,
      evidenceRole: 'prediction_consistent',
      contradictionScope: 'mechanism',
    })
    expect(result.corrections).toEqual([])
  })
})
