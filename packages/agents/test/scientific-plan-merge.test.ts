import { describe, expect, it } from 'vite-plus/test'
import type { ValidationTask } from '@open-scientist/schema'
import {
  externalTaskSemanticKey,
  mergeValidationTaskRequirements,
} from '../src/scientific-loop/scientific-graph.ts'

function externalTask(
  id: string,
  requiredSourceIds: string[],
  predictionIds: string[],
): ValidationTask {
  return {
    taskId: id,
    executorId: 'external',
    route: 'explorer',
    type: 'observation',
    objective: `为 ${predictionIds.join('、')} 获取事件匹配观测`,
    hypothesisIds: [`h-${id}`],
    predictionIds,
    falsificationConditionIds: [],
    requiredSourceIds,
    readiness: 'requires_data',
    blockedReason: '缺少任务指定的新观测维度',
    discriminatingOutcomes: ['获得事件匹配观测后可区分候选'],
    triggeredBy: 'prometheus.plan',
    status: 'planned',
    resultEvidenceIds: [],
    round: 1,
    fingerprint: `fp-${id}`,
  }
}

describe('D.plan semantic requirement merging', () => {
  it('collapses alias spellings of the same future data need onto one key', () => {
    const a = externalTask('task-a', ['future:iris-spectroscopy-ar11158'], ['h-a:prediction:1'])
    const b = externalTask('task-b', ['future:IRIS-EIS-spectroscopy-AR11158'], ['h-b:prediction:1'])
    expect(externalTaskSemanticKey(a)).not.toBeNull()
    expect(externalTaskSemanticKey(a)).toBe(externalTaskSemanticKey(b))
  })

  it('does not merge executable local tasks or different data needs', () => {
    const local = {
      ...externalTask('task-local', ['local:coronal-evidence-70gb-v1'], []),
      executorId: 'coronal-dem-inversion-v1',
    }
    expect(externalTaskSemanticKey(local)).toBeNull()
    const spectroscopy = externalTask('task-s', ['future:spectroscopy-ar11158'], [])
    const hardXray = externalTask('task-x', ['future:event-matched-hard-xray'], [])
    expect(externalTaskSemanticKey(spectroscopy)).not.toBe(externalTaskSemanticKey(hardXray))
  })

  it('merges requirement coverage into the kept task without dropping bindings', () => {
    const kept = externalTask('task-a', ['future:iris-spectroscopy-ar11158'], ['h-a:prediction:1'])
    const incoming = externalTask(
      'task-b',
      ['future:IRIS-EIS-spectroscopy-AR11158'],
      ['h-b:prediction:1'],
    )
    const merged = mergeValidationTaskRequirements(kept, incoming)
    expect(merged.taskId).toBe('task-a')
    expect(merged.hypothesisIds).toEqual(expect.arrayContaining(['h-task-a', 'h-task-b']))
    expect(merged.predictionIds).toEqual(
      expect.arrayContaining(['h-a:prediction:1', 'h-b:prediction:1']),
    )
    expect(merged.requiredSourceIds).toEqual(['future:spectroscopy-ar11158'])
    expect(merged.fingerprint).not.toBe(kept.fingerprint)
  })
})
