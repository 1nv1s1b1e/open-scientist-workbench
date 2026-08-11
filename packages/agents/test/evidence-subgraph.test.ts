import { describe, expect, it } from 'vite-plus/test'
import type { MemoryEntry } from '@open-scientist/schema'

import {
  runLangGraphEvidenceWorkgroup,
  type EvidenceAgent,
  type EvidenceAgentContext,
} from '../src/scientific-loop/index.ts'

function memory(
  memoryId: string,
  overrides: Partial<MemoryEntry> = {},
): MemoryEntry {
  return {
    memoryId,
    layer: 'semantic',
    kind: 'evidence',
    summary: memoryId,
    namespace: ['project-1', 'semantic'],
    tags: [],
    sourceIds: [],
    hypothesisIds: [],
    evidenceIds: [],
    taskIds: [],
    artifactIds: [],
    processingRunIds: [],
    triggeredBy: [],
    verificationStatus: 'verified',
    projectId: 'project-1',
    runId: 'run-1',
    round: 1,
    fingerprint: `fingerprint-${memoryId}`,
    utility: 0.5,
    createdAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  }
}

function context(memories: MemoryEntry[] = []): EvidenceAgentContext {
  return {
    phenomenon: {
      phenomenonId: 'phenomenon-1',
      title: '活动区多波段增亮',
      description: '同一活动区出现间歇增亮和传播扰动。',
      observations: [],
      constraints: [],
    },
    hypotheses: [],
    evidence: [],
    validationTasks: [],
    memory: memories,
    round: 1,
  }
}

describe('LangGraph B evidence subgraph', () => {
  it('uses dynamic Send workers in parallel and reduces in registration order', async () => {
    let active = 0
    let maxActive = 0
    let arrivals = 0
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const agent = (id: string): EvidenceAgent => ({
      id,
      label: id,
      capabilities: ['history-search'],
      run: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        arrivals += 1
        if (arrivals === 2) release()
        await barrier
        active -= 1
        return { notes: [`${id}-done`] }
      },
    })

    const result = await runLangGraphEvidenceWorkgroup(
      [agent('first'), agent('second')],
      context(),
    )

    expect(maxActive).toBe(2)
    expect(result.executions.map((item) => item.agentId)).toEqual([
      'first',
      'second',
    ])
    expect(result.notes).toEqual(['first-done', 'second-done'])
  })

  it('does not inject persistent Agent memory into a worker context', async () => {
    let seen: string[] | undefined
    const agent: EvidenceAgent = {
      id: 'timeseries-analysis',
      label: '时序分析',
      capabilities: ['timeseries-analysis'],
      run: async (agentContext) => {
        seen = agentContext.memory?.map((entry) => entry.memoryId)
        return {}
      },
    }

    await runLangGraphEvidenceWorkgroup(
      [agent],
      context([
        memory('snapshot', {
          layer: 'procedural-data',
          kind: 'data-snapshot',
        }),
        memory('unrelated-lesson', {
          layer: 'semantic',
          kind: 'lesson',
        }),
      ]),
    )

    expect(seen).toBeUndefined()
  })

  it('preserves a worker failure as an explicit limitation', async () => {
    const states: string[] = []
    const result = await runLangGraphEvidenceWorkgroup(
      [{
        id: 'broken',
        label: '失败分析器',
        capabilities: ['observation-analysis'],
        run: async () => {
          throw new Error('data adapter unavailable')
        },
      }],
      context(),
      {
        onAgentState: (event) => {
          states.push(`${event.agentId}:${event.state}`)
        },
      },
    )

    expect(result.executions[0]).toMatchObject({
      agentId: 'broken',
      status: 'failed',
      error: 'data adapter unavailable',
    })
    expect(result.limitations).toContain(
      '智能体 失败分析器 执行失败：data adapter unavailable',
    )
    expect(states).toContain('broken:failed')
  })
})
