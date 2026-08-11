import { describe, expect, it } from 'vite-plus/test'
import {
  createDefaultScientificDependencies,
  localValidationExecutor,
} from '../src/scientific-loop/default-services.ts'

describe('local-grounded scientific pipeline', () => {
  it('registers only diagnostics the local processor actually implements', () => {
    const baseTask = {
      taskId: 'task-local',
      route: 'B' as const,
      type: 'analysis' as const,
      requiredSourceIds: ['local:coronal-starter-v1'],
      discriminatingOutcomes: ['支持', '反驳'],
      triggeredBy: 'h-1',
      status: 'planned' as const,
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'fp-local',
    }
    expect(localValidationExecutor({
      ...baseTask,
      objective: '计算 171/193 跨通道时延和互相关',
    })).toBe('coronal-timeseries-lag-v1')
    expect(localValidationExecutor({
      ...baseTask,
      executorId: 'coronal-hot-channel-variability-v1',
      objective: '计算 171/193 跨通道时延和互相关',
    })).toBeNull()
    expect(localValidationExecutor({
      ...baseTask,
      objective: '执行 DEM 反演并估计高频功率谱斜率',
    })).toBeNull()
    expect(localValidationExecutor({
      ...baseTask,
      objective: '执行 WCS 重投影后，在人工日冕环掩膜内计算 171/193 跨通道相位时延',
    })).toBeNull()
    expect(localValidationExecutor({
      ...baseTask,
      type: 'simulation',
      objective: '运行 MHD 模拟并完成能量闭合',
    })).toBeNull()
  })

  it('uses verified local literature and observation metadata without a model call', async () => {
    const chunks: Array<Record<string, unknown>> = []
    const dependencies = createDefaultScientificDependencies({
      projectId: 'local-grounded-test',
      runId: 'run-local-grounded-test',
      localGrounded: true,
      modelConfig: {
        provider: 'openai',
        model: 'must-not-be-called',
        thinkingLevel: 'off',
        apiMode: 'chat',
        apiKey: '',
      },
      emitChunk: (chunk) => chunks.push(chunk as unknown as Record<string, unknown>),
    })

    const generated = await dependencies.generateHypotheses({
      projectId: 'local-grounded-test',
      runId: 'run-local-grounded-test',
      round: 1,
      phenomenon: {
        phenomenonId: 'ar11158-local-test',
        title: 'AR11158 多波段扰动与间歇增亮',
        description: 'NOAA AR11158 的 AIA 171 Å 与 193 Å 冠环出现准周期传播扰动，同时 94 Å 和 131 Å 局部间歇增亮，HMI 显示极性反转线持续演化。',
        activeRegion: '11158',
        requestedQuestion: '比较波动耗散、间歇性重联及其耦合。',
        observations: [],
        constraints: [],
      },
      context: {} as never,
      existingHypotheses: [],
    })
    const hypotheses = Array.isArray(generated) ? generated : generated.hypotheses
    const retrieval = chunks.find((chunk) => chunk.kind === 'scientific.retrieval')

    expect(hypotheses).toHaveLength(3)
    expect(hypotheses.every((item) => item.sourceIds.some((id) => id.startsWith('paper:')))).toBe(true)
    expect(hypotheses.every((item) => item.statement.includes('AR11158'))).toBe(true)
    expect(hypotheses.map((item) => item.statement).join(' ')).toContain('传播或准周期扰动')
    expect(hypotheses.map((item) => item.statement).join(' ')).toContain('局部热通道增亮')
    expect(retrieval).toMatchObject({
      status: 'grounded',
      paperCount: 8,
    })
    expect(Number(retrieval?.localCaseCount)).toBeGreaterThan(0)
    expect(String(retrieval?.message)).toContain('数据包核验')
    const tools = retrieval?.tools as Array<Record<string, unknown>>
    expect(tools.find((tool) => tool.id === 'searchHypotheses')?.status).toBe('skipped')
    expect(
      tools.filter((tool) => tool.id !== 'searchHypotheses').every((tool) => tool.status === 'completed'),
    ).toBe(true)
  })

  it('keeps external follow-up work planned after the local validation round', async () => {
    const dependencies = createDefaultScientificDependencies({
      projectId: 'local-followup-test',
      runId: 'run-local-followup-test',
      localGrounded: true,
      modelConfig: {
        provider: 'openai',
        model: 'must-not-be-called',
        thinkingLevel: 'off',
        apiMode: 'chat',
        apiKey: '',
      },
    })
    const phenomenon = {
      phenomenonId: 'ar11158-followup-test',
      title: 'AR11158 multiband evolution',
      description: 'AIA 171, 193, 94 and 131 observations with HMI context.',
      activeRegion: '11158',
      requestedQuestion: 'Compare wave, reconnection and coupled explanations.',
      observations: [],
      constraints: [],
    }
    const generated = await dependencies.generateHypotheses({
      projectId: 'local-followup-test',
      runId: 'run-local-followup-test',
      round: 1,
      phenomenon,
      context: {} as never,
      existingHypotheses: [],
    })
    const hypotheses = Array.isArray(generated) ? generated : generated.hypotheses
    const tasks = await dependencies.planValidation?.({
      projectId: 'local-followup-test',
      runId: 'run-local-followup-test',
      round: 2,
      phenomenon,
      context: {} as never,
      hypotheses,
      evidence: [],
      conclusion: 'Local processing completed.',
    })

    expect(tasks).toHaveLength(3)
    expect(tasks?.every((task) => task.status === 'planned')).toBe(true)
    expect(tasks?.every((task) => task.requiredSourceIds.every((id) => id.startsWith('future:')))).toBe(true)
    expect(tasks?.map((task) => task.type).sort()).toEqual(['observation', 'observation', 'simulation'])
  })
})
