import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import type {
  EvidenceRecord,
  ScientificCorrection,
  ScientificHypothesis,
  ValidationTask,
} from '@open-scientist/schema'
import {
  closeProjectDb,
  createProject,
  createRun,
  listScientificCorrections,
  listScientificEvidence,
  listScientificHypotheses,
  listValidationTasks,
  persistScientificRecords,
} from '../src/index.ts'

const hypothesis: ScientificHypothesis = {
  id: 'scientific-h-1',
  statement: '两个候选机制可能耦合贡献加热',
  mechanismComposition: [
    { mechanism: '阿尔芬波加热', role: 'coupled' },
    { mechanism: '磁重联纳耀斑', role: 'coupled' },
  ],
  predictions: ['多波段热响应存在可检验差异'],
  falsificationConditions: ['统一处理后没有差异'],
  sourceIds: [],
  scope: '当前活动区',
  confidence: 0.4,
  evidenceStrengthGrade: 'not_assessed',
  priority: 'high',
  priorityReason: '本地数据可直接检验第一条预测',
  confidenceBasis: [
    {
      basisId: 'basis-literature-1',
      kind: 'literature',
      sourceIds: ['paper-1'],
      evidenceIds: [],
      explanation: '初始置信度来自核验文献，不代表机制得证。',
    },
  ],
  parentId: null,
  round: 1,
  status: 'candidate',
}

function evidence(status: EvidenceRecord['status']): EvidenceRecord {
  return {
    evidenceId: `scientific-e-${status}`,
    hypothesisId: hypothesis.id,
    agentId: 'test-agent',
    status,
    evidenceRole: status === 'support' ? 'mechanism_discriminating' : 'diagnostic_boundary',
    contradictionScope: status === 'contradict' ? 'critical_prediction' : 'mechanism',
    claim: '结构化证据记录',
    observed: '确定性处理结果或未知边界',
    method: 'test-processing',
    sourceIds: status === 'unknown' ? [] : ['source-1'],
    sampleIds: status === 'contradict' ? ['sample-1'] : [],
    predictionIds: status === 'unknown' ? [] : [`${hypothesis.id}:prediction:1`],
    falsificationConditionIds: status === 'contradict' ? [`${hypothesis.id}:falsification:1`] : [],
    quantitativeResults:
      status === 'unknown'
        ? []
        : [
            {
              metric: 'effect-size',
              estimate: 0.3,
              lowerBound: 0.2,
              upperBound: 0.4,
              confidenceLevel: 0.95,
            },
          ],
    ...(status === 'unknown'
      ? {}
      : {
          provenance: {
            processingRunId: 'processing-1',
            dataSnapshotIds: ['snapshot-1'],
            artifactIds: ['artifact-1'],
            generatedBy: 'test-agent',
            deterministic: true as const,
          },
          lineage: {
            eventGroupId: 'event-1',
            relatedEventGroupIds: [],
            rawDataFingerprint: 'raw-event-1',
            observableFamily: 'wave_timing' as const,
            methodFamily: 'test-processing',
            analysisSplit: 'validation' as const,
          },
        }),
    limitations: [],
    round: 1,
  }
}

const validationTask: ValidationTask = {
  taskId: 'scientific-task-1',
  executorId: 'test-agent',
  route: 'explorer',
  type: 'analysis',
  objective: 'Compare the candidate mechanisms with an independent processing run.',
  hypothesisIds: [hypothesis.id],
  predictionIds: [`${hypothesis.id}:prediction:1`],
  falsificationConditionIds: [`${hypothesis.id}:falsification:1`],
  requiredSourceIds: [],
  requiredData: ['独立事件的多波段时序'],
  requiredFacilities: ['本地确定性分析执行器'],
  readiness: 'executable_now',
  expectedDuration: '约 5 分钟',
  successCriteria: ['独立事件复现预注册时序特征'],
  failureCriteria: ['独立事件未复现该特征'],
  discriminatingOutcomes: ['The mechanisms produce measurably different timing signatures.'],
  triggeredBy: hypothesis.id,
  status: 'planned',
  resultEvidenceIds: [],
  round: 1,
  fingerprint: 'scientific-task-fingerprint-1',
}

describe('scientific domain record repository', () => {
  let baseDir: string
  let projectId: string
  let runId: string

  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), 'os-scientific-record-'))
    process.env.BASE_DIR = baseDir
    projectId = (await createProject('scientific-record-project')).id as string
    runId = (await createRun('scientific-record-project', projectId)).id
  })

  afterEach(() => {
    closeProjectDb('scientific-record-project')
    rmSync(baseDir, { recursive: true, force: true })
    delete process.env.BASE_DIR
  })

  it('rejects decisive evidence without deterministic provenance', async () => {
    await expect(
      persistScientificRecords('scientific-record-project', {
        projectId,
        runId,
        hypotheses: [hypothesis],
        evidence: [{ ...evidence('support'), provenance: undefined } as never],
        corrections: [],
      }),
    ).rejects.toThrow()
  })

  it('round-trips hypotheses, unknown/traceable evidence, and corrections', async () => {
    const correction: ScientificCorrection = {
      correctionId: 'correction-1',
      stage: 'explorer',
      kind: 'provenance',
      severity: 'warning',
      message: '证据边界校正',
      action: '降级为 unknown',
      evidenceAction: 'downgrade_to_unknown',
      affectedIds: ['scientific-e-support'],
      triggeredBy: ['test-agent'],
      round: 1,
      agentId: 'test-agent',
    }
    await persistScientificRecords('scientific-record-project', {
      projectId,
      runId,
      hypotheses: [hypothesis],
      evidence: [evidence('unknown'), evidence('support')],
      corrections: [correction],
    })

    expect(await listScientificHypotheses('scientific-record-project', { runId })).toEqual([
      expect.objectContaining({
        id: hypothesis.id,
        statement: hypothesis.statement,
        priority: 'high',
        confidenceBasis: [expect.objectContaining({ basisId: 'basis-literature-1' })],
      }),
    ])
    expect(await listScientificEvidence('scientific-record-project', { runId })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ evidenceId: 'scientific-e-unknown', status: 'unknown' }),
        expect.objectContaining({
          evidenceId: 'scientific-e-support',
          status: 'support',
          provenance: expect.objectContaining({ processingRunId: 'processing-1' }),
          lineage: expect.objectContaining({ eventGroupId: 'event-1' }),
          predictionIds: [`${hypothesis.id}:prediction:1`],
          quantitativeResults: [expect.objectContaining({ metric: 'effect-size' })],
        }),
      ]),
    )
    expect(await listScientificCorrections('scientific-record-project', { runId })).toEqual([
      expect.objectContaining({
        correctionId: 'correction-1',
        kind: 'provenance',
        evidenceAction: 'downgrade_to_unknown',
      }),
    ])
  })

  it('rejects a scientific id collision instead of moving a record to another run', async () => {
    await persistScientificRecords('scientific-record-project', {
      projectId,
      runId,
      hypotheses: [hypothesis],
      evidence: [],
      corrections: [],
    })
    const secondRunId = (await createRun('scientific-record-project', projectId)).id
    await expect(
      persistScientificRecords('scientific-record-project', {
        projectId,
        runId: secondRunId,
        hypotheses: [hypothesis],
        evidence: [],
        corrections: [],
      }),
    ).rejects.toThrow('collision across runs')
    expect(await listScientificHypotheses('scientific-record-project', { runId })).toEqual([
      expect.objectContaining({ id: hypothesis.id }),
    ])
    expect(
      await listScientificHypotheses('scientific-record-project', { runId: secondRunId }),
    ).toEqual([])
  })

  it('rolls back the complete scientific batch when validation-task persistence fails', async () => {
    await persistScientificRecords('scientific-record-project', {
      projectId,
      runId,
      hypotheses: [],
      evidence: [],
      corrections: [],
      validationTasks: [validationTask],
    })

    const secondHypothesis = { ...hypothesis, id: 'scientific-h-rollback' }
    await expect(
      persistScientificRecords('scientific-record-project', {
        projectId,
        runId,
        hypotheses: [secondHypothesis],
        evidence: [],
        corrections: [],
        validationTasks: [
          {
            ...validationTask,
            fingerprint: 'scientific-task-fingerprint-collision',
          },
        ],
      }),
    ).rejects.toThrow('Validation task id collision')

    expect(await listScientificHypotheses('scientific-record-project', { runId })).toEqual([])
    expect(await listValidationTasks('scientific-record-project', { runId })).toEqual([
      expect.objectContaining({
        taskId: validationTask.taskId,
        hypothesisIds: [hypothesis.id],
        predictionIds: [`${hypothesis.id}:prediction:1`],
        falsificationConditionIds: [`${hypothesis.id}:falsification:1`],
        requiredData: ['独立事件的多波段时序'],
        readiness: 'executable_now',
        successCriteria: ['独立事件复现预注册时序特征'],
      }),
    ])
  })
})
