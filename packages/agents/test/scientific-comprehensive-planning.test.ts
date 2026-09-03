import { describe, expect, it } from 'vite-plus/test'
import type { PhenomenonInput, ScientificHypothesis } from '@open-scientist/schema'
import {
  buildExternalCompletenessTasks,
  buildRegisteredLocalDiagnosticTasks,
  mergeSharedExecutableTasks,
} from '../src/scientific-loop/default-services.ts'
import { canonicalValidationSourceId } from '../src/scientific-loop/validation-source.ts'
import type { PlanningContext } from '../src/scientific-loop/services.ts'

const phenomenon: PhenomenonInput = {
  phenomenonId: 'phenomenon-comprehensive',
  title: '活动区日冕加热竞争机制',
  description: '比较波动、间歇重联、热过程和耦合解释。',
  observations: [],
  constraints: [],
}

function hypothesis(
  id: string,
  mechanism: string,
  predictions: string[],
  status: ScientificHypothesis['status'] = 'candidate',
): ScientificHypothesis {
  return {
    id,
    statement: `${mechanism}候选`,
    mechanismComposition: [{ mechanism, role: 'dominant' }],
    predictions,
    falsificationConditions: [
      '冻结处理后没有对应时序、热响应、光谱或磁场变化',
      '独立事件和留出集不复现',
    ],
    sourceIds: ['paper:1'],
    scope: '登记的多活动区队列',
    confidence: 0.4,
    evidenceStrengthGrade: 'not_assessed',
    parentId: null,
    round: 1,
    status,
  }
}

function context(hypotheses: ScientificHypothesis[]): PlanningContext {
  return {
    projectId: 'project-comprehensive',
    runId: 'run-comprehensive',
    round: 1,
    phenomenon,
    context: {
      phenomenon,
      hypotheses,
      evidence: [],
      validationTasks: [],
      dataSnapshotIds: [],
      artifactIds: [],
      processingRunIds: [],
      round: 1,
      recentLessons: [],
    },
    hypotheses,
    evidence: [],
    conclusion: '尚待验证',
  }
}

describe('comprehensive registered diagnostic planning', () => {
  it('canonicalizes model aliases for the same event-scoped spectroscopy requirement', () => {
    expect(canonicalValidationSourceId('future:iris-spectroscopy-ar11158')).toBe(
      'future:spectroscopy-ar11158',
    )
    expect(canonicalValidationSourceId('future:IRIS-EIS-spectroscopy-AR11158')).toBe(
      'future:spectroscopy-ar11158',
    )
    expect(canonicalValidationSourceId('future:spectroscopic-energy-flux-ar11158')).toBe(
      'future:spectroscopy-energy-flux-ar11158',
    )
    expect(canonicalValidationSourceId('future:spectroscopy-energy-flux-AR11158')).toBe(
      'future:spectroscopy-energy-flux-ar11158',
    )
  })

  it('plans all relevant executor families in one shared batch instead of truncating to six', () => {
    const active = [
      hypothesis('h-wave', '阿尔芬波耗散', [
        '171/193 Å 应出现传播、相位差和候选周期',
        '空间相干和节点结构应可复现',
        '171/193 Å 跨通道互相关应在冻结时序中出现候选周期',
      ]),
      hypothesis('h-reconnection', '间歇磁重联纳耀斑', [
        '94/131 Å 间歇热增亮、DEM 高温成分和事件 fluence 幂律应共同出现',
        'HMI SHARP 矢量磁通与 94/131 热峰应存在时序关联',
        '94/131 Å 应出现间歇且可重复的热通道增强',
        '目标窗口热通道变异应高于同活动区背景对照',
        'SHARP 矢量磁场应显示径向磁通与垂直电流代理变化',
      ]),
      hypothesis('h-cohort', '低频脉冲热过程', [
        '94/131→335→211→193→171 Å 冷却时延和 DEM 热响应应跨事件复现',
        'IRIS Si IV Doppler 位移应在留出事件出现',
      ]),
      hypothesis('h-old', '已淘汰机制', ['94/131 热峰'], 'eliminated'),
    ]
    const tasks = buildRegisteredLocalDiagnosticTasks(context(active))
    const executors = tasks.map((task) => task.executorId)

    expect(tasks.length).toBeGreaterThan(6)
    expect(new Set(executors).size).toBe(tasks.length)
    expect(executors).toEqual(
      expect.arrayContaining([
        'coronal-wcs-unified-roi-v2',
        'coronal-timeseries-lag-v1',
        'coronal-hot-channel-variability-v1',
        'coronal-background-variability-v1',
        'coronal-dem-inversion-v1',
        'coronal-cooling-sequence-v2',
        'coronal-event-threshold-sensitivity-v2',
        'coronal-spatial-wave-v1',
        'coronal-event-fluence-distribution-v1',
        'coronal-hmi-sharp-vector-v1',
        'coronal-aia-hmi-temporal-association-v1',
        'coronal-iris-spectroscopy-v1',
      ]),
    )
    expect(tasks.every((task) => task.readiness === 'executable_now')).toBe(true)
    expect(tasks.every((task) => task.detectability?.adequate === false)).toBe(true)
    expect(tasks.every((task) => task.detectability?.minimumIndependentEventCount === 3)).toBe(true)
    expect(tasks.some((task) => task.hypothesisIds.includes('h-old'))).toBe(false)
    expect(
      tasks.find((task) => task.executorId === 'coronal-wcs-unified-roi-v2')?.hypothesisIds,
    ).toEqual(['h-wave', 'h-reconnection', 'h-cohort'])
  })

  it('keeps a concrete external discrimination path for every active candidate', () => {
    const active = [
      hypothesis('h-wave', '阿尔芬波耗散', ['171/193 Å 应出现传播、相位差和候选周期']),
      hypothesis('h-reconnection', '间歇磁重联纳耀斑', [
        '94/131 Å 事件 fluence 与磁拓扑演化应共同出现',
      ]),
      hypothesis('h-old', '已淘汰机制', ['94/131 热峰'], 'eliminated'),
    ]
    const tasks = buildExternalCompletenessTasks(context(active), [])

    expect(tasks.map((task) => task.hypothesisIds[0])).toEqual(['h-wave', 'h-reconnection'])
    expect(tasks.every((task) => task.executorId === 'external')).toBe(true)
    expect(tasks.every((task) => task.readiness === 'requires_data')).toBe(true)
    expect(tasks.every((task) => task.detectability?.adequate === false)).toBe(true)
    expect(
      tasks.find((task) => task.hypothesisIds.includes('h-reconnection'))?.requiredSourceIds,
    ).toContain('future:event-matched-hard-xray')

    const alreadyCovered = buildExternalCompletenessTasks(context(active), [tasks[0]!])
    expect(alreadyCovered.map((task) => task.hypothesisIds[0])).toEqual(['h-reconnection'])
  })

  it('runs each registered local executor once while retaining every binding', () => {
    const active = [
      hypothesis('h-wave', '阿尔芬波耗散', ['171/193 Å 应出现传播']),
      hypothesis('h-coupled', '波动触发重联', ['171/193 Å 与热峰应耦合']),
    ]
    const registered = buildRegisteredLocalDiagnosticTasks(context(active))
    const base = registered.find((task) => task.executorId === 'coronal-timeseries-lag-v1')!
    const duplicate = {
      ...base,
      taskId: 'model-duplicate',
      hypothesisIds: ['h-coupled'],
      predictionIds: ['h-coupled:prediction:1'],
      falsificationConditionIds: ['h-coupled:falsification:1'],
      fingerprint: 'model-duplicate',
    }
    const external = buildExternalCompletenessTasks(context(active), [])[0]!
    const merged = mergeSharedExecutableTasks([base, duplicate, external])
    const local = merged.filter((task) => task.executorId === 'coronal-timeseries-lag-v1')

    expect(local).toHaveLength(1)
    expect(local[0]?.hypothesisIds).toEqual(expect.arrayContaining(['h-wave', 'h-coupled']))
    expect(local[0]?.predictionIds).toContain('h-coupled:prediction:1')
    expect(merged).toContain(external)
  })
})
