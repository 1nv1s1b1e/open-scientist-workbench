import { describe, expect, it } from 'vite-plus/test'
import type { ScientificHypothesis } from '@open-scientist/schema'
import {
  executorSupportsPrediction,
  filterPredictionIdsByCapability,
  predictionRequiredFamilies,
  predictionStatementForId,
} from '../src/scientific-loop/executor-capabilities.ts'
import { scientificPredictionId } from '@open-scientist/schema'

function hypothesis(id: string, predictions: string[]): ScientificHypothesis {
  return {
    id,
    statement: '测试候选',
    mechanismComposition: [{ mechanism: '测试机制', role: 'dominant' }],
    predictions,
    falsificationConditions: ['冻结处理后没有对应变化'],
    sourceIds: ['paper:1'],
    scope: '测试作用域',
    parentId: null,
    round: 1,
    status: 'candidate',
  }
}

describe('executor capability contract', () => {
  it('maps lag/ordering predictions to the cooling capability, not plain variability', () => {
    const statement = '94/131 Å 峰值先于 171/193 Å，冷却时滞为 5–15 分钟'
    expect(predictionRequiredFamilies(statement)).toEqual(['cooling_sequence'])
    expect(executorSupportsPrediction('coronal-cooling-sequence-v2', statement)).toBe(true)
    expect(executorSupportsPrediction('coronal-hot-channel-variability-v1', statement)).toBe(
      false,
    )
  })

  it('distributes compound predictions across executors that each measure one aspect', () => {
    const statement = '94/131→335→211→193→171 Å 冷却时延和 DEM 热响应应跨事件复现'
    const required = predictionRequiredFamilies(statement)
    expect(required).toContain('cooling_sequence')
    expect(required).toContain('dem_thermal_structure')
    expect(executorSupportsPrediction('coronal-cooling-sequence-v2', statement)).toBe(true)
    expect(executorSupportsPrediction('coronal-dem-inversion-v1', statement)).toBe(true)
    expect(executorSupportsPrediction('coronal-hot-channel-variability-v1', statement)).toBe(
      false,
    )
  })

  it('rejects propagation claims by executors without spatial capability', () => {
    const statement = '扰动应具有可重复的传播速度或相位差'
    expect(predictionRequiredFamilies(statement)).toEqual(['spatial_wave_propagation'])
    expect(executorSupportsPrediction('coronal-spatial-wave-v1', statement)).toBe(true)
    expect(executorSupportsPrediction('coronal-timeseries-lag-v1', statement)).toBe(false)
  })

  it('keeps plain intermittency claims with hot-channel executors only', () => {
    const statement = '94/131 Å ROI 强度时序中应出现间歇且可重复的热通道增强'
    expect(executorSupportsPrediction('coronal-hot-channel-variability-v1', statement)).toBe(
      true,
    )
    expect(executorSupportsPrediction('coronal-cooling-sequence-v2', statement)).toBe(false)
  })

  it('stays permissive for unconstrained statements and unknown executors', () => {
    expect(predictionRequiredFamilies('未登记的新诊断要求')).toEqual([])
    expect(executorSupportsPrediction('coronal-dem-inversion-v1', '未登记的新诊断要求')).toBe(
      true,
    )
    expect(executorSupportsPrediction('some-unknown-executor', '冷却时滞')).toBe(true)
    expect(executorSupportsPrediction(null, '冷却时滞')).toBe(true)
  })

  it('always binds exempt measurement-precondition executors', () => {
    expect(executorSupportsPrediction('coronal-wcs-unified-roi-v2', '冷却时滞')).toBe(true)
  })

  it('filters evidence prediction IDs to capability-supported statements', () => {
    const test = hypothesis('h-1', [
      '94/131 Å 峰值先于 171/193 Å，冷却时滞为 5–15 分钟',
      '94/131 Å 应出现间歇且可重复的热通道增强',
    ])
    const ids = test.predictions.map((_s, index) => scientificPredictionId('h-1', index))
    expect(ids[0]).toBe('h-1:prediction:1')
    expect(predictionStatementForId(test, ids[0]!)).toBe(test.predictions[0])
    expect(filterPredictionIdsByCapability('coronal-hot-channel-variability-v1', test, ids)).toEqual(
      ['h-1:prediction:2'],
    )
    expect(filterPredictionIdsByCapability('coronal-cooling-sequence-v2', test, ids)).toEqual([
      'h-1:prediction:1',
    ])
  })
})
