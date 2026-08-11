import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import type {
  EvidenceRecord,
  ScientificCorrection,
  ScientificHypothesis,
} from '@open-scientist/schema'
import {
  closeProjectDb,
  createProject,
  createRun,
  listScientificCorrections,
  listScientificEvidence,
  listScientificHypotheses,
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
    claim: '结构化证据记录',
    observed: '确定性处理结果或未知边界',
    method: 'test-processing',
    sourceIds: status === 'unknown' ? [] : ['source-1'],
    sampleIds: status === 'contradict' ? ['sample-1'] : [],
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
      }),
    limitations: [],
    round: 1,
  }
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
    await expect(persistScientificRecords('scientific-record-project', {
      projectId,
      runId,
      hypotheses: [hypothesis],
      evidence: [{ ...evidence('support'), provenance: undefined } as never],
      corrections: [],
    })).rejects.toThrow()
  })

  it('round-trips hypotheses, unknown/traceable evidence, and corrections', async () => {
    const correction: ScientificCorrection = {
      correctionId: 'correction-1',
      stage: 'B',
      kind: 'provenance',
      severity: 'warning',
      message: '证据边界校正',
      action: '降级为 unknown',
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

    expect(await listScientificHypotheses('scientific-record-project', { runId }))
      .toEqual([expect.objectContaining({ id: hypothesis.id, statement: hypothesis.statement })])
    expect(await listScientificEvidence('scientific-record-project', { runId }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ evidenceId: 'scientific-e-unknown', status: 'unknown' }),
        expect.objectContaining({
          evidenceId: 'scientific-e-support',
          status: 'support',
          provenance: expect.objectContaining({ processingRunId: 'processing-1' }),
        }),
      ]))
    expect(await listScientificCorrections('scientific-record-project', { runId }))
      .toEqual([expect.objectContaining({ correctionId: 'correction-1', kind: 'provenance' })])
  })
})
