import { describe, expect, it } from 'vite-plus/test'
import {
  createDefaultScientificDependencies,
  localValidationExecutor,
  mapWithConcurrency,
  tasksForHypothesis,
} from '../src/scientific-loop/default-services.ts'

describe('local-grounded scientific pipeline', () => {
  it('bounds memory-heavy local processing while preserving request order', async () => {
    let active = 0
    let maximumActive = 0
    const results = await mapWithConcurrency([3, 1, 2, 0], 2, async (value) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, value * 2 + 1))
      active -= 1
      return value * 10
    })

    expect(maximumActive).toBeLessThanOrEqual(2)
    expect(results).toEqual([30, 10, 20, 0])
  })

  it('registers only diagnostics the local processor actually implements', () => {
    const baseTask = {
      taskId: 'task-local',
      route: 'B' as const,
      type: 'analysis' as const,
      hypothesisIds: ['h-1'],
      predictionIds: [],
      falsificationConditionIds: [],
      requiredSourceIds: ['local:coronal-starter-v1'],
      discriminatingOutcomes: ['支持', '反驳'],
      triggeredBy: 'h-1',
      status: 'planned' as const,
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'fp-local',
    }
    expect(
      localValidationExecutor({
        ...baseTask,
        objective: '计算 171/193 跨通道时延和互相关',
      }),
    ).toBe('coronal-timeseries-lag-v1')
    expect(
      localValidationExecutor({
        ...baseTask,
        executorId: 'coronal-hot-channel-variability-v1',
        objective: '计算 171/193 跨通道时延和互相关',
      }),
    ).toBeNull()
    expect(
      localValidationExecutor({
        ...baseTask,
        executorId: 'coronal-timeseries-lag-v1',
        objective: '计算 94/131 与 171/193 的跨通道冷却时延',
      }),
    ).toBeNull()
    expect(
      localValidationExecutor({
        ...baseTask,
        status: 'completed',
        executorId: 'coronal-timeseries-lag-v1',
        objective: '计算 171/193 跨通道时延和互相关',
      }),
    ).toBeNull()
    expect(
      localValidationExecutor({
        ...baseTask,
        executorId: 'coronal-cross-event-holdout-v1',
        objective: '在独立活动区留出事件上使用冻结参数复测候选机制',
      }),
    ).toBe('coronal-cross-event-holdout-v1')
    expect(
      localValidationExecutor({
        ...baseTask,
        executorId: 'coronal-cross-event-holdout-v1',
        objective: '在当前活动区继续调节阈值直到结果稳定',
      }),
    ).toBeNull()
    expect(
      localValidationExecutor({
        ...baseTask,
        executorId: 'coronal-dem-inversion-v1',
        objective: '对冻结共同 ROI 的六通道 AIA 强度执行正则化 DEM 反演并报告温度不确定度',
      }),
    ).toBe('coronal-dem-inversion-v1')
    expect(
      localValidationExecutor({
        ...baseTask,
        objective: '执行 DEM 反演并估计高频功率谱斜率',
      }),
    ).toBeNull()
    expect(
      localValidationExecutor({
        ...baseTask,
        objective: '执行 WCS 重投影后，在人工日冕环掩膜内计算 171/193 跨通道相位时延',
      }),
    ).toBeNull()
    expect(
      localValidationExecutor({
        ...baseTask,
        executorId: 'coronal-spatial-wave-v1',
        objective: '在自动冻结 ROI 内计算 171/193 空间相干、节点代理和表观传播',
      }),
    ).toBe('coronal-spatial-wave-v1')
    expect(
      localValidationExecutor({
        ...baseTask,
        executorId: 'coronal-event-fluence-distribution-v1',
        objective: '统计 94/131 热事件相对 fluence、事件率和有限尾部分布',
      }),
    ).toBe('coronal-event-fluence-distribution-v1')
    expect(
      localValidationExecutor({
        ...baseTask,
        executorId: 'coronal-hmi-sharp-vector-v1',
        objective: '计算 HMI SHARP CEA 矢量磁通与垂直电流代理的时序变化',
      }),
    ).toBe('coronal-hmi-sharp-vector-v1')
    expect(
      localValidationExecutor({
        ...baseTask,
        executorId: 'coronal-aia-hmi-temporal-association-v1',
        objective: '用循环移位检验 AIA 热峰与 SHARP 磁通变化率的时序关联',
      }),
    ).toBe('coronal-aia-hmi-temporal-association-v1')
    expect(
      localValidationExecutor({
        ...baseTask,
        executorId: 'coronal-hmi-sharp-vector-v1',
        objective: '使用 NLFFF 外推计算日冕自由能并证明完整能量闭合',
      }),
    ).toBeNull()
    expect(
      localValidationExecutor({
        ...baseTask,
        type: 'simulation',
        objective: '运行 MHD 模拟并完成能量闭合',
      }),
    ).toBeNull()
  })

  it('claims objectives whose embedded prediction-id hashes collide with domain keywords', () => {
    const baseTask = {
      taskId: 'task-local',
      route: 'B' as const,
      type: 'analysis' as const,
      hypothesisIds: ['h-1'],
      predictionIds: [],
      falsificationConditionIds: [],
      requiredSourceIds: ['local:coronal-starter-v1'],
      discriminatingOutcomes: ['支持', '反驳'],
      triggeredBy: 'h-1',
      status: 'planned' as const,
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'fp-local',
    }
    // Regression (2026-09-01 demo, task-local-fc98eb001bbe): the prediction id
    // h-local-wave-kinematics-6013bc0131:prediction:2 contains "131", so the
    // hot-channel exclusion rejected a pure 171/193 task and it never ran.
    // Stable ids must be stripped before any claiming pattern runs.
    const collidedObjective =
      '计算冻结 ROI 的 AIA 171/193 跨通道互相关、时延和单一候选主周期。 并行检验 ' +
      'h-local-wave-ed10421142:prediction:1、h-local-wave-kinematics-6013bc0131:prediction:2；' +
      '该任务完成不等于机制得到支持。'
    expect(
      localValidationExecutor({
        ...baseTask,
        executorId: 'coronal-timeseries-lag-v1',
        objective: collidedObjective,
      }),
    ).toBe('coronal-timeseries-lag-v1')
    // The collision must not let a genuinely hot-channel task slip through
    // just because stripping happens: domain text still excludes.
    expect(
      localValidationExecutor({
        ...baseTask,
        executorId: 'coronal-timeseries-lag-v1',
        objective:
          '计算 AIA 94/131 热通道变异。 并行检验 h-local-wave-kinematics-6013bc0131:prediction:2',
      }),
    ).toBeNull()
    // Inference path: hash tokens must not trigger or block keyword inference.
    expect(
      localValidationExecutor({
        ...baseTask,
        objective: collidedObjective,
      }),
    ).toBe('coronal-timeseries-lag-v1')
    expect(
      localValidationExecutor({
        ...baseTask,
        objective:
          '统计事件 fluence 与幂律尾部。并行检验 h-local-nanoflare-22130948abcd:prediction:1、task-local-8401a041e36d',
      }),
    ).toBe('coronal-event-fluence-distribution-v1')
  })

  it('binds the registered AR11899 IRIS task even for a non-cohort hypothesis', () => {
    const turbulentHypothesis = {
      id: 'h-turbulent-iris',
      statement: '磁湍流级联解释多尺度热通道增强',
      mechanismComposition: [{ mechanism: '磁湍流级联', role: 'dominant' as const }],
      predictions: [
        '热事件呈现宽谱统计',
        '磁场梯度与热事件率相关',
        'IRIS Si IV 光谱应出现系统流速偏移',
      ],
      falsificationConditions: ['无宽谱统计', '无磁热相关', '无光谱流动'],
      sourceIds: ['paper:test'],
      scope: 'AR11899 holdout',
      parentId: null,
      round: 1,
      status: 'candidate' as const,
    }
    const irisTask = {
      taskId: 'task-iris-holdout',
      executorId: 'coronal-iris-spectroscopy-v1',
      route: 'B' as const,
      type: 'analysis' as const,
      objective:
        '在预注册 AR11899 留出事件中读取 IRIS Level-2 raster，以 O I 校正并报告 Si IV Doppler 速度。',
      hypothesisIds: [turbulentHypothesis.id],
      predictionIds: [`${turbulentHypothesis.id}:prediction:3`],
      falsificationConditionIds: [`${turbulentHypothesis.id}:falsification:3`],
      // Tests run with the default starter dataset id; production resolves
      // the same stable local source id from CORONAL_DATASET_ID.
      requiredSourceIds: ['local:coronal-starter-v1'],
      readiness: 'executable_now' as const,
      discriminatingOutcomes: ['检测到流动', '未检测到流动'],
      triggeredBy: turbulentHypothesis.id,
      status: 'planned' as const,
      resultEvidenceIds: [],
      round: 1,
      fingerprint: 'iris-holdout-fingerprint',
    }
    const processing = {
      selectionPurpose: 'cross_event',
      analysis: {
        mode: 'holdout',
        target: { caseId: 'ar11899-joint-spectroscopy-20131119' },
      },
    }

    const matches = tasksForHypothesis(
      { validationTasks: [irisTask], evidence: [] } as never,
      turbulentHypothesis,
      processing as never,
    )

    expect(matches.map((task) => task.taskId)).toEqual([irisTask.taskId])
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
        description:
          'NOAA AR11158 的 AIA 171 Å 与 193 Å 冠环出现准周期传播扰动，同时 94 Å 和 131 Å 局部间歇增亮，HMI 显示极性反转线持续演化。',
        activeRegion: '11158',
        requestedQuestion: '比较波动耗散、间歇性重联及其耦合。',
        observations: [],
        constraints: [],
      },
      context: {} as never,
      existingHypotheses: [],
    })
    const hypotheses = Array.isArray(generated) ? generated : generated.hypotheses
    const coverageAudit = Array.isArray(generated) ? undefined : generated.coverageAudit
    const retrieval = chunks.find((chunk) => chunk.kind === 'scientific.retrieval')

    // Open-world literature families plus data-anchored variants: this
    // phenomenon carries wave/reconnection cues, but the candidate set must
    // also retain sourced alternatives rather than collapse to a fixed trio.
    expect(hypotheses.length).toBeGreaterThanOrEqual(9)
    expect(coverageAudit).toEqual(
      expect.objectContaining({
        mode: 'open_world',
        exhaustiveClaim: false,
        fixedMechanismCount: false,
        residualAlternativeAllowed: true,
        candidateCount: hypotheses.length,
      }),
    )
    expect(hypotheses.every((item) => item.sourceIds.some((id) => id.startsWith('paper:')))).toBe(
      true,
    )
    expect(hypotheses.every((item) => item.statement.includes('AR11158'))).toBe(true)
    expect(hypotheses.map((item) => item.statement).join(' ')).toContain('传播或准周期扰动')
    expect(hypotheses.map((item) => item.statement).join(' ')).toContain('局部热通道增亮')
    const candidateKeys = hypotheses.map(
      (item) => /^h-local-(.+)-[0-9a-f]{10}$/.exec(item.id)?.[1] ?? '',
    )
    // Data-anchored variants appear only for anchored cues, and stay distinct
    // hypothesis entries rather than merged prose.
    expect(candidateKeys).toContain('wave-kinematics')
    expect(candidateKeys).toContain('nanoflare-power-law')
    expect(candidateKeys).toContain('magnetic-thermal-coupling')
    expect(candidateKeys).toContain('thermal-process-cohort')
    // Spectroscopy-dependent variants must not appear without registered
    // spectroscopy coverage for the matched case.
    const statements = hypotheses.map((item) => item.statement).join(' ')
    if (!statements.includes('光谱覆盖就绪')) {
      expect(candidateKeys).not.toContain('spectroscopic-nonthermal')
    }
    const join = (field: 'composition' | 'priority') =>
      hypotheses
        .map((item) =>
          field === 'composition'
            ? item.mechanismComposition.map((entry) => entry.mechanism).join('|')
            : String(item[field]),
        )
        .join(' ')
    expect(join('composition')).toContain('热非平衡循环')
    expect(join('composition')).toContain('磁湍流级联')
    expect(join('composition')).toContain('近稳态持续加热对照')
    expect(join('composition')).toMatch(/磁编织|慢模|上流|磁通涌现|动理学|色球蒸发/)
    expect(join('priority')).toContain('high')
    expect(retrieval).toMatchObject({
      status: 'grounded',
    })
    expect(Number(retrieval?.paperCount)).toBeGreaterThanOrEqual(8)
    expect(Number(retrieval?.localCaseCount)).toBeGreaterThan(0)
    expect(String(retrieval?.message)).toContain('数据包核验')
    const tools = retrieval?.tools as Array<Record<string, unknown>>
    expect(tools.find((tool) => tool.id === 'searchHypotheses')?.status).toBe('skipped')
    expect(
      tools
        .filter((tool) => tool.id !== 'searchHypotheses')
        .every((tool) => tool.status === 'completed'),
    ).toBe(true)
  }, 15_000)

  it('schedules the registered cross-active-region holdout before asking for new data', async () => {
    const dependencies = createDefaultScientificDependencies({
      projectId: 'local-holdout-test',
      runId: 'run-local-holdout-test',
      localGrounded: true,
      modelConfig: {
        provider: 'openai',
        model: 'must-not-be-called',
        thinkingLevel: 'off',
        apiMode: 'chat',
        apiKey: '',
      },
    })
    const tasks = await dependencies.planValidation?.({
      projectId: 'local-holdout-test',
      runId: 'run-local-holdout-test',
      round: 1,
      phenomenon: {
        phenomenonId: 'ar11158-holdout-test',
        title: 'AR11158 multiband evolution',
        description: 'AIA 171, 193, 94 and 131 observations with HMI context.',
        activeRegion: '11158',
        observations: [],
        constraints: [],
      },
      context: {} as never,
      hypotheses: [
        {
          id: 'h-holdout',
          statement: '间歇性重联贡献加热',
          mechanismComposition: [{ mechanism: '磁重联', role: 'dominant' }],
          predictions: [
            'AIA 94 Å 和 131 Å 应显示短暂（<10 分钟）的局部亮化事件，随后在 171 Å 和 193 Å 出现延迟响应',
          ],
          falsificationConditions: ['独立事件中没有热通道增强'],
          sourceIds: ['local:coronal-starter-v1'],
          scope: 'active regions',
          confidence: 0.5,
          parentId: null,
          round: 1,
          status: 'candidate',
        },
      ],
      evidence: [],
      conclusion: 'Discovery diagnostics completed.',
    })

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executorId: 'coronal-cross-event-holdout-v1',
          route: 'B',
          type: 'analysis',
          status: 'planned',
        }),
        expect.objectContaining({
          executorId: 'coronal-event-threshold-sensitivity-v2',
          readiness: 'executable_now',
        }),
      ]),
    )
    const executable = tasks?.filter((task) => task.readiness === 'executable_now') ?? []
    expect(executable.every((task) => dependencies.canExecuteValidationTask?.(task))).toBe(true)
    // Per-run registered human-review tasks were removed by team decision:
    // governance review lives in docs/expert-review/human-review-dossier.md.
    const reviews = tasks?.filter((task) => task.readiness === 'human_review') ?? []
    expect(reviews).toEqual([])
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

    expect(tasks?.length).toBeGreaterThanOrEqual(3)
    expect(tasks?.every((task) => task.status === 'planned')).toBe(true)
    expect(
      tasks?.every((task) => task.requiredSourceIds.every((id) => id.startsWith('future:'))),
    ).toBe(true)
    const futureSources = tasks?.flatMap((task) => task.requiredSourceIds) ?? []
    expect(futureSources).not.toContain('future:aia-wcs-series')
    expect(futureSources).not.toContain('future:hmi-vector-field')
    expect(futureSources).not.toContain('future:mechanism-specification')
    expect(futureSources).toEqual(
      expect.arrayContaining([
        'future:manual-loop-kinematics',
        'future:braiding-mhd-forward-model',
        'future:co-temporal-iris-eis-upflows',
        'future:topology-evolution-model',
      ]),
    )
    expect(tasks?.map((task) => task.type)).toEqual(
      expect.arrayContaining(['observation', 'simulation']),
    )
  })
})
