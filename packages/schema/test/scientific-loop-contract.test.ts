import { describe, expect, it } from 'vite-plus/test'
import {
  ArtifactRefSchema,
  DataSnapshotRefSchema,
  AgentExecutionSchema,
  EvidenceRecordSchema,
  MemoryEntrySchema,
  PhenomenonInputSchema,
  ProcessingRunSchema,
  ScientificCorrectionSchema,
  ScientificHypothesisCandidateSchema,
  ScientificHypothesisSchema,
  ValidationTaskSchema,
  scientificFalsificationConditionId,
  scientificPredictionId,
} from '../src/index.ts'

describe('scientific loop contracts', () => {
  it('normalizes a null optional mechanism contribution to an omitted value', () => {
    const parsed = ScientificHypothesisCandidateSchema.parse({
      id: 'h-null-contribution',
      statement: '低频脉冲热过程候选',
      mechanism: '具体能量释放机制未定',
      mechanismComposition: [
        { mechanism: '低频脉冲加热过程', role: 'dominant', contribution: null },
      ],
      predictions: ['热事件尾与 DEM 响应满足预注册条件'],
      falsificationConditions: ['热事件尾或 DEM 响应不满足预注册条件'],
      sourceIds: ['local:test'],
      scope: '登记的跨事件样本',
      parentId: null,
      round: 1,
      status: 'candidate',
    })

    expect(parsed.mechanismComposition?.[0]?.contribution).toBeUndefined()
    expect(JSON.stringify(parsed)).not.toContain('"contribution"')
  })

  it('tolerates model submit_result payloads that omit bookkeeping fields', () => {
    const parsed = ScientificHypothesisCandidateSchema.parse({
      id: 'AR11158-impulsive-nanoflare',
      statement: 'NOAA 11158 的持续性 EUV 增亮由低频脉冲加热驱动，机制归属待证。',
      mechanism: '活动区磁场的随机小尺度耗散产生大量纳耀斑脉冲加热。',
      mechanismComposition: [{ mechanism: '纳耀斑风暴（低频脉冲加热）', role: 'dominant' }],
      predictions: ['AIA 94/131 与 171/193 互相关延迟非零。'],
      falsificationConditions: ['互相关时延接近于零则不支持。'],
    })

    expect(parsed.sourceIds).toEqual([])
    expect(parsed.parentId).toBeNull()
    expect(parsed.round).toBe(1)
    expect(parsed.status).toBe('candidate')
  })

  const observation = {
    sourceId: 'aia-171-2024-01-01',
    kind: 'image' as const,
    label: 'EUV 171 observation',
    uri: 'fixture://active-region-1/aia-171.fits',
    instrument: 'AIA',
    wavelengthOrBand: '171 Å',
  }

  it('accepts a phenomenon with auditable multi-band observations', () => {
    const result = PhenomenonInputSchema.parse({
      phenomenonId: 'ar-1-loop-brightening',
      title: '活动区环状结构出现短时增亮',
      description: '同一活动区在多个 EUV 波段出现时序不同的增亮。',
      activeRegion: 'AR-1',
      observations: [
        observation,
        { ...observation, sourceId: 'aia-193-2024-01-01', wavelengthOrBand: '193 Å' },
      ],
      requestedQuestion: '阿尔芬波耗散与纳耀斑加热是否能被区分？',
    })

    expect(result.observations).toHaveLength(2)
    expect(result.observations[0]?.sourceId).toBe('aia-171-2024-01-01')
  })

  it('accepts a natural-language phenomenon before agents attach sources', () => {
    const result = PhenomenonInputSchema.parse({
      phenomenonId: 'ar-natural-language-input',
      title: '活动区出现非同步增亮',
      description: '某活动区在观测窗口内出现局部增亮和升温，不确定是波动耗散、磁重联还是耦合机制。',
    })
    expect(result.observations).toEqual([])
  })
  it('requires predictions, falsification conditions, and sources for a hypothesis', () => {
    const result = ScientificHypothesisSchema.safeParse({
      id: 'h-wave-reconnection',
      statement: '波动耗散和间歇性重联共同贡献加热',
      mechanismComposition: [
        { mechanism: 'alfven-dissipation', role: 'dominant' },
        { mechanism: 'nanoflare-reconnection', role: 'coupled' },
      ],
      predictions: ['高频波功率与温度变化有稳定的时滞关系'],
      falsificationConditions: ['在控制了仪器响应后仍未出现预期时滞'],
      sourceIds: ['aia-171-2024-01-01'],
      scope: '仅适用于本活动区的观测窗口',
      confidence: 0.5,
      priority: 'high',
      priorityReason: '现有数据可直接检验该候选的时序预测',
      confidenceBasis: [
        {
          basisId: 'basis-literature-1',
          kind: 'literature',
          sourceIds: ['aia-171-2024-01-01'],
          evidenceIds: [],
          explanation: '初始置信度来自文献与数据可检验性，不代表机制得证。',
        },
      ],
      round: 1,
      status: 'candidate',
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.priority).toBe('high')
  })

  it('keeps unknown evidence distinct from contradiction', () => {
    const result = EvidenceRecordSchema.parse({
      evidenceId: 'e-unknown-1',
      hypothesisId: 'h-wave-reconnection',
      status: 'unknown',
      claim: '现有观测不足以判断波动功率谱的高频端',
      observed: '数据窗口缺少可用的高 cadence 磁场序列',
      method: 'data-availability-audit',
      sourceIds: ['aia-171-2024-01-01'],
      limitations: ['缺少磁场时间序列'],
      round: 1,
    })

    expect(result.status).toBe('unknown')
  })

  it('requires deterministic processing provenance for decisive evidence', () => {
    const baseEvidence = {
      evidenceId: 'e-support-1',
      hypothesisId: 'h-wave-reconnection',
      claim: '高频波功率与热响应存在稳定关系',
      observed: '确定性处理产物记录了候选关系',
      method: 'registered-timeseries-analysis',
      sourceIds: ['aia-171-2024-01-01'],
      limitations: [],
      round: 1,
    }

    expect(
      EvidenceRecordSchema.safeParse({
        ...baseEvidence,
        status: 'support',
      }).success,
    ).toBe(false)
    expect(
      EvidenceRecordSchema.safeParse({
        ...baseEvidence,
        status: 'unknown',
      }).success,
    ).toBe(true)
    expect(
      EvidenceRecordSchema.safeParse({
        ...baseEvidence,
        status: 'support',
        provenance: {
          processingRunId: 'processing-1',
          dataSnapshotIds: ['snapshot-1'],
          artifactIds: ['artifact-metrics-1'],
          generatedBy: 'timeseries-agent',
          deterministic: true,
        },
      }).success,
    ).toBe(true)
  })

  it('binds quantitative evidence to a prediction and raw-event lineage', () => {
    const predictionId = scientificPredictionId('h-wave-reconnection', 0)
    const falsificationId = scientificFalsificationConditionId('h-wave-reconnection', 0)
    const result = EvidenceRecordSchema.parse({
      evidenceId: 'e-lineage-1',
      hypothesisId: 'h-wave-reconnection',
      status: 'support',
      claim: '留出事件中的时序指标与预测一致',
      observed: '三个独立事件给出同方向效应',
      method: 'registered-timeseries-analysis',
      sourceIds: ['aia-171-2024-01-01'],
      sampleIds: ['event-3'],
      predictionIds: [predictionId],
      falsificationConditionIds: [falsificationId],
      provenance: {
        processingRunId: 'processing-1',
        dataSnapshotIds: ['snapshot-1'],
        artifactIds: ['artifact-metrics-1'],
        generatedBy: 'timeseries-agent',
        deterministic: true,
      },
      lineage: {
        eventGroupId: 'event-3',
        rawDataFingerprint: 'sha256:event-3',
        observableFamily: 'wave_timing',
        methodFamily: 'cross-channel-timing',
        analysisSplit: 'holdout',
      },
      quantitativeResults: [
        {
          metric: 'lag-seconds',
          estimate: 12,
          lowerBound: 8,
          upperBound: 16,
          unit: 's',
        },
      ],
      limitations: [],
      round: 1,
    })

    expect(result.predictionIds).toEqual([predictionId])
    expect(result.lineage?.analysisSplit).toBe('holdout')
    expect(result.quantitativeResults[0]?.confidenceLevel).toBe(0.95)
    expect(
      EvidenceRecordSchema.safeParse({
        ...result,
        quantitativeResults: [{ metric: 'invalid', estimate: 4, lowerBound: 5, upperBound: 6 }],
      }).success,
    ).toBe(false)
  })

  it('records data snapshots, deterministic processing, and immutable artifacts', () => {
    const snapshot = DataSnapshotRefSchema.parse({
      snapshotId: 'snapshot-1',
      sourceIds: ['aia-171-2024-01-01'],
      manifestPath: 'runs/run-1/data/snapshot-1.json',
      checksums: {
        'aia-171-2024-01-01': 'sha256:abc',
      },
      selection: {
        activeRegion: 'AR-1',
      },
      createdAt: '2026-08-08T00:00:00.000Z',
    })
    const artifact = ArtifactRefSchema.parse({
      artifactId: 'artifact-metrics-1',
      kind: 'metrics',
      path: 'runs/run-1/artifacts/metrics-1.json',
      checksum: 'sha256:def',
      generatedBy: 'timeseries-agent',
      processingRunId: 'processing-1',
      sourceIds: snapshot.sourceIds,
      createdAt: '2026-08-08T00:00:01.000Z',
    })
    const processing = ProcessingRunSchema.parse({
      processingRunId: 'processing-1',
      projectId: 'project-1',
      runId: 'run-1',
      round: 1,
      agentId: 'timeseries-agent',
      taskId: 'task-1',
      triggeredBy: 'task-1',
      snapshotIds: [snapshot.snapshotId],
      steps: [
        {
          stepId: 'align-1',
          name: '多波段时间对齐',
          tool: 'alignment-pipeline',
          toolVersion: '1.0.0',
          parameters: {
            interpolation: 'nearest',
          },
          inputArtifactIds: [],
          outputArtifactIds: [artifact.artifactId],
          deterministic: true,
        },
      ],
      deterministic: true,
      status: 'completed',
      outputArtifactIds: [artifact.artifactId],
      metricsArtifactId: artifact.artifactId,
      limitations: [],
      fingerprint: 'processing-fingerprint-1',
      startedAt: '2026-08-08T00:00:00.000Z',
      completedAt: '2026-08-08T00:00:01.000Z',
    })

    expect(processing.snapshotIds).toEqual(['snapshot-1'])
    expect(processing.steps[0]?.toolVersion).toBe('1.0.0')
  })

  it('stores scientific memory in one of four explicit layers', () => {
    const memory = MemoryEntrySchema.parse({
      memoryId: 'mem-processing-1',
      layer: 'procedural-data',
      kind: 'processing-run',
      summary: '完成多波段时间对齐',
      namespace: ['project-1', 'procedural-data'],
      tags: ['alignment'],
      sourceIds: ['aia-171-2024-01-01'],
      hypothesisIds: [],
      evidenceIds: [],
      taskIds: ['task-1'],
      artifactIds: ['artifact-metrics-1'],
      processingRunIds: ['processing-1'],
      triggeredBy: ['task-1'],
      verificationStatus: 'verified',
      agentId: 'timeseries-agent',
      phenomenonId: 'phenomenon-1',
      projectId: 'project-1',
      runId: 'run-1',
      round: 1,
      fingerprint: 'memory-fingerprint-1',
      utility: 0.9,
      createdAt: '2026-08-08T00:00:01.000Z',
    })

    expect(memory.layer).toBe('procedural-data')
    expect(memory.processingRunIds).toEqual(['processing-1'])
    expect(memory.artifactIds).toEqual(['artifact-metrics-1'])
  })

  it('requires the feedback route and trigger for a validation task', () => {
    const result = ValidationTaskSchema.parse({
      taskId: 'task-compare-spectrum',
      route: 'B',
      type: 'analysis',
      objective: '比较两个活动区的高频功率谱',
      hypothesisIds: ['h-wave-reconnection'],
      predictionIds: [scientificPredictionId('h-wave-reconnection', 0)],
      falsificationConditionIds: [scientificFalsificationConditionId('h-wave-reconnection', 0)],
      requiredSourceIds: ['aia-171-2024-01-01'],
      requiredData: ['AIA 171 Å 时序'],
      requiredFacilities: ['本地确定性时序分析执行器'],
      readiness: 'executable_now',
      expectedDuration: '约 5 分钟',
      successCriteria: ['在独立事件复现预注册功率谱特征'],
      failureCriteria: ['独立事件中不复现该特征'],
      discriminatingOutcomes: ['波动主导应出现连续谱衰减', '重联主导应出现间歇性突发'],
      triggeredBy: 'e-unknown-1',
      status: 'planned',
      round: 1,
      fingerprint: 'task-fingerprint-1',
    })

    expect(result.route).toBe('explorer')
    expect(result.hypothesisIds).toEqual(['h-wave-reconnection'])
    expect(result.readiness).toBe('executable_now')
  })

  it('records self-corrections and agent execution states with explicit triggers', () => {
    const correction = ScientificCorrectionSchema.parse({
      correctionId: 'correction-1',
      stage: 'B',
      kind: 'provenance',
      severity: 'warning',
      message: '支持性证据缺少处理产物绑定',
      action: '将证据降级为 unknown',
      affectedIds: ['e-1'],
      triggeredBy: ['e-1'],
      round: 1,
      agentId: 'fact-check',
    })
    const execution = AgentExecutionSchema.parse({
      agentId: 'timeseries-analysis',
      label: '时序分析',
      stage: 'B',
      status: 'completed',
      capabilities: ['timeseries-analysis'],
      round: 1,
      outputEvidenceIds: ['e-1'],
      outputTaskIds: [],
    })

    expect(correction.triggeredBy).toEqual(['e-1'])
    expect(execution.stage).toBe('explorer')
  })
})
