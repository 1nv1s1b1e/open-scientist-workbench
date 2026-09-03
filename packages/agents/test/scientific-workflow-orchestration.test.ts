import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { ScientificHypothesis } from '@open-scientist/schema'
import { closeProjectDb, listScientificHypotheses } from '@open-scientist/storage'
import {
  scientificLoopWorkflow,
  type ScientificLoopWorkflowInput,
} from '../src/scientific-loop/workflow.ts'

const hypothesis: ScientificHypothesis = {
  id: 'workflow-hypothesis',
  statement: '波动耗散与间歇性重联可能共同贡献加热',
  mechanismComposition: [
    { mechanism: '阿尔芬波耗散', role: 'coupled' },
    { mechanism: '磁重联纳耀斑', role: 'coupled' },
  ],
  predictions: ['多波段热响应具有可检验的时序差异'],
  falsificationConditions: ['统一处理后仍无时序差异'],
  sourceIds: [],
  scope: '当前活动区',
  confidence: 0.4,
  evidenceStrengthGrade: 'not_assessed',
  parentId: null,
  round: 1,
  status: 'candidate',
}

const input: Omit<ScientificLoopWorkflowInput, 'modelConfig'> = {
  projectId: 'workflow-project',
  runId: 'workflow-run',
  phenomenon: {
    phenomenonId: 'workflow-phenomenon',
    title: '活动区增亮',
    description: '一个待甄别的多波段活动区现象。',
    observations: [],
    constraints: [],
  },
  maxRounds: 1,
}

describe('scientific workflow entrypoint', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'os-workflow-entry-'))
    process.env.BASE_DIR = baseDir
  })

  afterEach(() => {
    closeProjectDb(input.projectId)
    rmSync(baseDir, { recursive: true, force: true })
    delete process.env.BASE_DIR
  })

  it('delegates orchestration to the LangGraph root graph', async () => {
    const nodes: string[] = []
    const eventKinds: string[] = []
    const result = await scientificLoopWorkflow({
      ...input,
      modelConfig: {
        provider: 'openai',
        model: 'test-model',
        baseURL: 'http://test.invalid',
        apiKey: 'sk-test',
        thinkingLevel: 'medium',
        apiMode: 'chat',
      },
      graphDependencies: {
        generateHypotheses: async () => [hypothesis],
        evidenceAgents: [],
        planValidation: async () => [],
      },
      emitChunk: (chunk) => {
        const event = chunk as unknown as Record<string, unknown>
        if (typeof event.kind === 'string') eventKinds.push(event.kind)
        if (event.kind === 'scientific.node-state' && event.state === 'completed') {
          nodes.push(String(event.node))
        }
      },
    })

    expect(nodes).toEqual([
      'A.generate',
      'A.verify',
      'B.run',
      'BC.verify',
      'C.verify',
      'C.synthesize',
      'D.plan',
      'D.route',
    ])
    expect(result.terminationReason).toBe('max_rounds_reached')
    expect(eventKinds.at(-1)).toBe('scientific.loop-complete')
    expect(await listScientificHypotheses(input.projectId, { runId: input.runId })).toEqual([
      expect.objectContaining({ id: hypothesis.id }),
    ])
  })
})
