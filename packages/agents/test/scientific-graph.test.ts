import { describe, expect, it } from 'vite-plus/test'
import type {
  ScientificHypothesis,
  ValidationTask,
} from '@open-scientist/schema'
import type { UIMessageChunk } from 'ai'
import { createInMemoryScientificRuntime } from '../src/orchestration/langgraph-runtime.ts'

import {
  runScientificLoopGraph,
  type ScientificGraphDependencies,
  type ScientificGraphInput,
} from '../src/scientific-loop/scientific-graph.ts'

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
  parentId: null,
  round: 1,
  status: 'candidate',
}

function input(
  emitChunk?: (chunk: UIMessageChunk) => void,
  maxRounds = 1,
): ScientificGraphInput {
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

function dependencies(
  overrides: Partial<ScientificGraphDependencies> = {},
): ScientificGraphDependencies {
  return {
    generateHypotheses: async ({ round }) => [{
      ...hypothesis,
      round,
    }],
    evidenceAgents: [{
      id: 'boundary-audit',
      label: '证据边界审计',
      capabilities: ['fact-check'],
      run: async ({ hypotheses, round }) => ({
        evidence: hypotheses.map((item) => ({
          evidenceId: `e-unknown-${round}-${item.id}`,
          hypothesisId: item.id,
          agentId: 'boundary-audit',
          status: 'unknown' as const,
          claim: '当前数据不足以判断该候选机制',
          observed: '尚未得到可重复的数据处理指标',
          method: 'evidence-boundary-audit',
          sourceIds: [],
          sampleIds: [],
          limitations: ['缺少已登记的数据处理产物'],
          round,
        })),
      }),
    }],
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
        if (
          event.kind === 'scientific.node-state' &&
          event.state === 'completed'
        ) {
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
      'C.synthesize',
      'C.verify',
      'D.plan',
      'D.route',
    ])
    expect(emitted).toEqual(expect.arrayContaining([
      'scientific.phenomenon',
      'scientific.hypothesis',
      'scientific.round-summary',
    ]))
    expect(result.totalRounds).toBe(1)
    expect(result.hypotheses).toHaveLength(1)
    expect(result.evidence[0]?.status).toBe('unknown')
    expect(result.terminationReason).toBe('max_rounds_reached')
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
        evidenceAgents: [{
          id: 'unsafe-analysis',
          label: '未溯源分析',
          capabilities: ['timeseries-analysis'],
          run: async ({ round }) => ({
            evidence: [{
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
            } as never],
          }),
        }],
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
      route: 'B',
      type: 'analysis',
      objective: '补充多波段时序处理',
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
      evidenceAgents: [{
        id: 'round-audit',
        label: '逐轮审计',
        capabilities: ['fact-check'],
        run: async ({ round }) => {
          evidenceCalls += 1
          return {
            evidence: [{
              evidenceId: `e-unknown-${round}-h-coupled`,
              hypothesisId: hypothesis.id,
              agentId: 'round-audit',
              status: 'unknown',
              claim: '本轮仍不足以甄别机制',
              observed: '只完成数据边界检查',
              method: 'round-audit',
              sourceIds: [],
              sampleIds: [],
              limitations: ['等待后续验证任务'],
              round,
            }],
          }
        },
      }],
      planValidation: async ({ round }) => round === 1 ? [task] : [],
    })

    const result = await runScientificLoopGraph(input(undefined, 2), deps)

    expect(generationCalls).toBe(1)
    expect(evidenceCalls).toBe(2)
    expect(result.totalRounds).toBe(2)
    expect(result.terminationReason).toBe('max_rounds_reached')
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

    await expect(runScientificLoopGraph(
      { ...input(undefined, 1), runtime },
      deps,
    )).rejects.toThrow('temporary A failure')

    const result = await runScientificLoopGraph(
      { ...input(undefined, 1), runtime, resume: true },
      deps,
    )

    expect(generationCalls).toBe(2)
    expect(result.hypotheses).toHaveLength(1)
    expect(result.terminationReason).toBe('max_rounds_reached')
  })
})
