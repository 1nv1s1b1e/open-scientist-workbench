import { describe, expect, it } from 'vite-plus/test'
import { DEMO_ORCHESTRATION } from '../src/lib/workbench/demo-data.ts'
import {
  buildOrchestrationViewModel,
  toConsoleAgentRole,
} from '../src/lib/workbench/orchestration-view-model.ts'
import { emptyScientificWorkbenchState } from '../src/lib/workbench/state.ts'

describe('orchestration view model', () => {
  it('groups the real graph nodes and exposes the active B stage', () => {
    const view = buildOrchestrationViewModel(DEMO_ORCHESTRATION)

    expect(view.stages.map((stage) => stage.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(view.stages.find((stage) => stage.id === 'B')?.nodes.map((node) => node.id)).toEqual([
      'B.run',
      'B.dispatch',
      'B.aggregate',
      'BC.verify',
    ])
    expect(view.suggestedSelection).toEqual({ kind: 'node', id: 'B.run' })
  })

  it('keeps B worker states distinct and maps workers to console roles', () => {
    const view = buildOrchestrationViewModel(DEMO_ORCHESTRATION)

    expect(view.workers.summary).toEqual({
      running: 1,
      completed: 1,
      queued: 3,
      skipped: 0,
      failed: 0,
    })
    expect(view.workers.items.find((worker) => worker.id === 'looker-source-audit')?.state).toBe(
      'running',
    )
    expect(toConsoleAgentRole('looker-source-audit')).toBe('looker')
    expect(toConsoleAgentRole('explorer-history-search')).toBe('explore')
    expect(toConsoleAgentRole('oracle-fact-check')).toBe('oracle')
  })

  it('describes the D route without inventing a conclusion', () => {
    const view = buildOrchestrationViewModel(DEMO_ORCHESTRATION)
    const emptyView = buildOrchestrationViewModel(emptyScientificWorkbenchState().orchestration)

    expect(view.route).toMatchObject({ target: 'B', label: '返回证据工作组', continuing: true })
    expect(view.route.reason).toBe(DEMO_ORCHESTRATION.latestRoute?.reason)
    expect(emptyView.route).toMatchObject({
      target: 'WAIT',
      label: '等待本轮路由',
      continuing: false,
    })
  })

  it('uses the actual seven-work-item fallback and preserves execution order semantics', () => {
    const view = buildOrchestrationViewModel(emptyScientificWorkbenchState().orchestration)
    const deterministic = view.workers.items.filter(
      (worker) => worker.executionKind === 'deterministic',
    )
    const model = view.workers.items.filter((worker) => worker.executionKind === 'model')

    expect(deterministic).toHaveLength(4)
    expect(model.map((worker) => worker.id)).toEqual([
      'looker-model-observation-review',
      'explorer-model-diagnostic-review',
      'oracle-model-counterexample-review',
    ])
    expect(view.stages.find((stage) => stage.id === 'B')?.description).toContain('确定性并行')
    expect(view.stages.find((stage) => stage.id === 'B')?.description).toContain('模型串行')
  })
})
