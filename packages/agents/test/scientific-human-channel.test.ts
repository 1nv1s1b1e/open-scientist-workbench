import { describe, expect, it } from 'vite-plus/test'
import type { ScientificHypothesis, ValidationTask } from '@open-scientist/schema'
import type { UIMessageChunk } from 'ai'

import { runScientificLoopGraph } from '../src/scientific-loop/scientific-graph.ts'
import {
  createInMemoryScientificHumanControl,
  steeringPromptBlock,
} from '../src/scientific-loop/human-channel.ts'
import type {
  ScientificGraphDependencies,
  ScientificGraphInput,
} from '../src/scientific-loop/services.ts'

const hypothesis: ScientificHypothesis = {
  id: 'h-human',
  statement: '间歇热过程与波动耗散并列为候选',
  mechanismComposition: [{ mechanism: '低频脉冲热过程', role: 'dominant' }],
  predictions: ['多波段热响应应呈现可区分的时序特征'],
  falsificationConditions: ['统一处理后仍无对应时序特征'],
  sourceIds: [],
  scope: '当前活动区和观测窗口',
  confidence: 0.4,
  evidenceStrengthGrade: 'not_assessed',
  parentId: null,
  round: 1,
  status: 'candidate',
}

function input(
  emitChunk?: (chunk: UIMessageChunk) => void,
  maxRounds = 1,
  humanChannel?: ScientificGraphInput['humanChannel'],
): ScientificGraphInput {
  return {
    projectId: 'project-human',
    runId: 'run-human',
    phenomenon: {
      phenomenonId: 'phenomenon-human',
      title: '活动区多波段增亮',
      description: '同一活动区出现间歇增亮和传播扰动。',
      observations: [],
      constraints: [],
    },
    maxRounds,
    emitChunk,
    ...(humanChannel ? { humanChannel } : {}),
  }
}

function dependencies(
  overrides: Partial<ScientificGraphDependencies> = {},
): ScientificGraphDependencies {
  return {
    generateHypotheses: async ({ round }) => [{ ...hypothesis, round }],
    evidenceAgents: [
      {
        id: 'boundary-audit',
        label: '证据边界审计',
        capabilities: ['fact-check'],
        run: async ({ hypotheses, round }) => ({
          evidence: hypotheses.map((item) => ({
            evidenceId: `e-unknown-${round}-${item.id}`,
            hypothesisId: item.id,
            agentId: 'boundary-audit',
            status: 'unknown' as const,
            evidenceRole: 'diagnostic_boundary' as const,
            contradictionScope: 'mechanism' as const,
            claim: '当前数据不足以判断该候选机制',
            observed: '尚未得到可重复的数据处理指标',
            method: 'evidence-boundary-audit',
            sourceIds: [],
            sampleIds: [],
            predictionIds: [],
            falsificationConditionIds: [],
            quantitativeResults: [],
            limitations: ['缺少已登记的数据处理产物'],
            round,
          })),
        }),
      },
    ],
    planValidation: async () => [],
    ...overrides,
  }
}

function executableTask(round: number): ValidationTask {
  return {
    taskId: `task-local-${round}`,
    executorId: 'test-round-executor',
    readiness: 'executable_now',
    route: 'explorer',
    type: 'analysis',
    objective: '补充多波段时序处理',
    hypothesisIds: [hypothesis.id],
    predictionIds: [],
    falsificationConditionIds: [],
    requiredSourceIds: [],
    discriminatingOutcomes: ['得到可重复指标', '确认数据仍不足'],
    triggeredBy: hypothesis.id,
    status: 'planned',
    resultEvidenceIds: [],
    round,
    fingerprint: `task-local-${round}-fingerprint`,
  }
}

async function untilDefined<T>(fn: () => T | undefined, label: string): Promise<T> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const value = fn()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timeout waiting for ${label}`)
}

describe('scientific loop human channel', () => {
  it('reaches complete workflow closure with a planned human_review task and NO human channel', async () => {
    const humanReviewTask: ValidationTask = {
      taskId: 'task-expert-open-world-review',
      route: 'librarian',
      type: 'human-review',
      objective: '开放世界候选机制的专家复核',
      hypothesisIds: [hypothesis.id],
      predictionIds: [],
      falsificationConditionIds: [],
      requiredSourceIds: ['future:expert-open-world-hypothesis-review'],
      discriminatingOutcomes: ['专家确认', '专家否定'],
      triggeredBy: hypothesis.id,
      status: 'planned',
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'task-expert-review-fingerprint',
      readiness: 'human_review',
    }
    const result = await runScientificLoopGraph(
      input(undefined, 1),
      dependencies({ planValidation: async () => [humanReviewTask] }),
    )

    expect(result.terminationReason).toBe('max_rounds_reached')
    expect(result.workflowClosure?.status).toBe('complete')
    expect(result.dataReadiness?.humanReviewTaskIds).toEqual([humanReviewTask.taskId])
    expect(result.dataReadiness?.executableNowTaskIds).toEqual([])
    expect(result.humanSteering).toBeUndefined()
    expect(result.humanGates).toBeUndefined()
  })

  it('drains queued steering into A.generate and audits it in the result', async () => {
    const control = createInMemoryScientificHumanControl({ runId: 'run-human' })
    const seen: string[][] = []
    const emitted: string[] = []
    const result = await runScientificLoopGraph(
      input(
        (chunk) => {
          const event = chunk as unknown as Record<string, unknown>
          if (typeof event.kind === 'string') emitted.push(event.kind)
        },
        1,
        control,
      ),
      dependencies({
        generateHypotheses: async ({ round, steering }) => {
          seen.push((steering ?? []).map((item) => item.content))
          return [{ ...hypothesis, round }]
        },
      }),
    )

    expect(seen).toHaveLength(1)
    // No steering was queued before the run: the drain must return nothing.
    expect(seen[0]).toEqual([])
    expect(result.humanSteering).toBeUndefined()
    expect(emitted).not.toContain('scientific.steering-injected')
    control.close()
  })

  it('injects steering queued before the round and records it in the result', async () => {
    const control = createInMemoryScientificHumanControl({ runId: 'run-human' })
    const first = control.steer('优先检验波动运动学预测', 'steering')
    control.steer('同时保留近稳态对照', 'follow-up')
    const captured: Array<Array<{ content: string; round: number }>> = []
    const emitted: string[] = []
    const result = await runScientificLoopGraph(
      input(
        (chunk) => {
          const event = chunk as unknown as Record<string, unknown>
          if (typeof event.kind === 'string') emitted.push(event.kind)
        },
        1,
        control,
      ),
      dependencies({
        generateHypotheses: async ({ round, steering }) => {
          captured.push(
            (steering ?? []).map((item) => ({
              content: item.content,
              round: item.injectedRound ?? round,
            })),
          )
          return [{ ...hypothesis, round }]
        },
      }),
    )

    expect(captured[0]).toHaveLength(2)
    expect(captured[0]?.[0]).toEqual({ content: '优先检验波动运动学预测', round: 1 })
    expect(captured[0]?.[1]).toEqual({ content: '同时保留近稳态对照', round: 1 })
    expect(emitted).toContain('scientific.steering-injected')
    expect(result.humanSteering).toHaveLength(2)
    expect(result.humanSteering?.[0]?.messageId).toBe(first.messageId)
    expect(result.hypotheses[0]?.statement).toBe(hypothesis.statement)
  })

  it('pauses at the node boundary and resumes when unpaused', async () => {
    const control = createInMemoryScientificHumanControl({ runId: 'run-human' })
    const emitted: string[] = []
    control.pause()
    setTimeout(() => control.unpause(), 60)
    const result = await runScientificLoopGraph(
      input(
        (chunk) => {
          const event = chunk as unknown as Record<string, unknown>
          if (typeof event.kind === 'string') emitted.push(event.kind)
        },
        1,
        control,
      ),
      dependencies(),
    )

    expect(result.totalRounds).toBe(1)
    expect(emitted).toContain('scientific.human-paused')
    expect(emitted).toContain('scientific.human-resumed')
  })

  it('continues to the next round when the plan_review gate is approved by a human', async () => {
    const control = createInMemoryScientificHumanControl({
      runId: 'run-human',
      gateMode: 'plan_review',
    })
    let evidenceCalls = 0
    const runPromise = runScientificLoopGraph(
      input(undefined, 2, control),
      dependencies({
        evidenceAgents: [
          {
            id: 'round-audit',
            label: '逐轮审计',
            capabilities: ['fact-check'],
            run: async ({ hypotheses, round }) => {
              evidenceCalls += 1
              return {
                evidence: hypotheses.map((item) => ({
                  evidenceId: `e-unknown-${round}-${item.id}`,
                  hypothesisId: item.id,
                  agentId: 'round-audit',
                  status: 'unknown' as const,
                  evidenceRole: 'diagnostic_boundary' as const,
                  contradictionScope: 'mechanism' as const,
                  claim: '本轮仍不足以甄别机制',
                  observed: '只完成数据边界检查',
                  method: 'round-audit',
                  sourceIds: [],
                  sampleIds: [],
                  predictionIds: [],
                  falsificationConditionIds: [],
                  quantitativeResults: [],
                  limitations: ['等待后续验证任务'],
                  round,
                })),
              }
            },
          },
        ],
        planValidation: async ({ round }) => (round === 1 ? [executableTask(1)] : []),
      }),
    )

    const pending = await untilDefined(
      () => control.pendingGateRequest(),
      'pending plan_review gate',
    )
    expect(pending.kind).toBe('plan_review')
    control.approve({ approved: true, reason: '计划合理，继续' })
    const result = await runPromise

    expect(result.totalRounds).toBe(2)
    expect(evidenceCalls).toBe(2)
    expect(result.terminationReason).toBe('max_rounds_reached')
    expect(result.humanGates).toHaveLength(1)
    expect(result.humanGates?.[0]).toMatchObject({
      approved: true,
      source: 'human',
      reason: '计划合理，继续',
      round: 1,
    })
  })

  it('halts the loop without fabricating verdicts when the gate is rejected', async () => {
    const control = createInMemoryScientificHumanControl({
      runId: 'run-human',
      gateMode: 'plan_review',
    })
    const runPromise = runScientificLoopGraph(
      input(undefined, 2, control),
      dependencies({
        planValidation: async ({ round }) => (round === 1 ? [executableTask(1)] : []),
      }),
    )
    await untilDefined(() => control.pendingGateRequest(), 'pending plan_review gate')
    control.approve({ approved: false, reason: '预算不足，停止' })
    const result = await runPromise

    expect(result.terminationReason).toBe('human_halted_at_plan_review')
    expect(result.totalRounds).toBe(1)
    expect(result.status).toBe('completed')
    // A human halt is a process decision: hypothesis statuses stay untouched.
    expect(result.hypotheses.every((item) => item.status !== 'supported')).toBe(true)
    expect(result.humanGates?.[0]).toMatchObject({ approved: false, source: 'human' })
  })

  it('auto-proceeds (fail-open) when no human answers the gate before the timeout', async () => {
    const control = createInMemoryScientificHumanControl({
      runId: 'run-human',
      gateMode: 'plan_review',
      gateTimeoutMs: 40,
    })
    const result = await runScientificLoopGraph(
      input(undefined, 2, control),
      dependencies({
        planValidation: async ({ round }) => (round === 1 ? [executableTask(1)] : []),
      }),
    )

    expect(result.totalRounds).toBe(2)
    expect(result.humanGates?.[0]).toMatchObject({ approved: true, source: 'auto_timeout' })
  })

  it('never fires a gate when the mode is off, even if a channel is attached', async () => {
    const control = createInMemoryScientificHumanControl({ runId: 'run-human' })
    expect(control.hasGate()).toBe(false)
    const emitted: string[] = []
    const result = await runScientificLoopGraph(
      input(
        (chunk) => {
          const event = chunk as unknown as Record<string, unknown>
          if (typeof event.kind === 'string') emitted.push(event.kind)
        },
        2,
        control,
      ),
      dependencies({
        planValidation: async ({ round }) => (round === 1 ? [executableTask(1)] : []),
      }),
    )

    expect(result.totalRounds).toBe(2)
    expect(emitted).not.toContain('scientific.human-gate-request')
    expect(result.humanGates).toBeUndefined()
    control.close()
  })
})

describe('human control unit semantics', () => {
  it('steer queues, drainSteering drains exactly once and tags the round', () => {
    const control = createInMemoryScientificHumanControl({ runId: 'run-unit' })
    control.steer('第一条', 'steering')
    const first = control.drainSteering(3)
    const second = control.drainSteering(4)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ content: '第一条', injectedRound: 3 })
    expect(second).toEqual([])
  })

  it('approve rejects a mismatched gateId and returns undefined without a pending gate', () => {
    const control = createInMemoryScientificHumanControl({
      runId: 'run-unit',
      gateMode: 'plan_review',
    })
    expect(control.approve({ approved: true })).toBeUndefined()
    const request = control.requestGate({ kind: 'plan_review', round: 1, summary: 's' })
    void request
    return untilDefined(() => control.pendingGateRequest(), 'gate').then((gate) => {
      expect(control.approve({ approved: true, gateId: 'gate-wrong' })).toBeUndefined()
      const decision = control.approve({ approved: true, gateId: gate.gateId })
      expect(decision?.approved).toBe(true)
    })
  })

  it('steeringPromptBlock states the integrity boundary', () => {
    const block = steeringPromptBlock([
      { messageId: 'm1', mode: 'steering', content: '关注波动', queuedAt: 't', injectedRound: 1 },
    ])
    expect(block).toContain('关注波动')
    expect(block).toContain('不可改变门禁裁决')
    expect(steeringPromptBlock([])).toBe('')
  })
})
