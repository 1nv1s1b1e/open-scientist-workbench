import { describe, expect, it } from 'vite-plus/test'

import {
  runEvidenceWorkgroup,
  type EvidenceAgent,
  type EvidenceAgentContext,
} from '../src/scientific-loop/evidence-workgroup.ts'

function context(): EvidenceAgentContext {
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
    round: 1,
  }
}

describe('B evidence agent workgroup', () => {
  it('runs eligible agents in parallel and aggregates in registration order', async () => {
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

    const result = await runEvidenceWorkgroup(
      [agent('history'), agent('counterexample')],
      context(),
    )

    expect(maxActive).toBe(2)
    expect(result.executions.map((item) => item.agentId)).toEqual(['history', 'counterexample'])
    expect(result.executions.every((item) => item.status === 'completed')).toBe(true)
    expect(result.notes).toEqual(['history-done', 'counterexample-done'])
  })

  it('skips agents that are not applicable without calling them', async () => {
    let calls = 0
    const result = await runEvidenceWorkgroup(
      [
        {
          id: 'simulation',
          label: '数值模拟',
          capabilities: ['simulation'],
          canRun: () => false,
          run: async () => {
            calls += 1
            return {}
          },
        },
      ],
      context(),
    )

    expect(calls).toBe(0)
    expect(result.executions[0]).toMatchObject({
      agentId: 'simulation',
      status: 'skipped',
    })
  })

  it('keeps one agent failure as an explicit limitation while others finish', async () => {
    const states: string[] = []
    const result = await runEvidenceWorkgroup(
      [
        {
          id: 'broken',
          label: '失败分析器',
          capabilities: ['timeseries-analysis'],
          run: async () => {
            throw new Error('adapter unavailable')
          },
        },
        {
          id: 'audit',
          label: '来源审计',
          capabilities: ['source-audit'],
          run: async () => ({ limitations: ['未绑定可执行数据'] }),
        },
      ],
      context(),
      {
        onAgentState: (event) => {
          states.push(`${event.agentId}:${event.state}`)
        },
      },
    )

    expect(result.executions).toEqual([
      expect.objectContaining({
        agentId: 'broken',
        status: 'failed',
        error: 'adapter unavailable',
      }),
      expect.objectContaining({ agentId: 'audit', status: 'completed' }),
    ])
    expect(result.limitations).toContain('未绑定可执行数据')
    expect(states).toContain('broken:failed')
    expect(states).toContain('audit:completed')
  })

  it('rejects duplicate agent ids before dispatch', async () => {
    const duplicate: EvidenceAgent = {
      id: 'same',
      label: 'same',
      capabilities: [],
      run: async () => ({}),
    }

    await expect(runEvidenceWorkgroup([duplicate, duplicate], context())).rejects.toThrow(
      'duplicate evidence agent id',
    )
  })
})
