import { describe, expect, it } from 'vite-plus/test'
import {
  evidenceCounts,
  scientificRounds,
  scientificRoundView,
  taskExecutionRound,
} from '../src/lib/workbench/scientific-rounds.ts'
import { emptyScientificWorkbenchState } from '../src/lib/workbench/state.ts'

describe('scientific round view', () => {
  it('separates the round where a task was proposed from the round where it ran', () => {
    const state = emptyScientificWorkbenchState()
    state.round = 2
    state.validationTasks = [{
      taskId: 'task-1',
      route: 'B',
      status: 'completed',
      objective: 'measure lag',
      round: 1,
      resultEvidenceIds: ['e-result'],
    }]
    state.evidence = [{
      evidenceId: 'e-result',
      taskId: 'task-1',
      hypothesisId: 'h-1',
      status: 'unknown',
      claim: 'lag is not discriminating',
      round: 2,
    }]

    expect(scientificRounds(state)).toEqual([1, 2])
    expect(scientificRoundView(state, 1).tasksProposed.map((item) => item.taskId)).toEqual([
      'task-1',
    ])
    expect(scientificRoundView(state, 2).tasksExecuted.map((item) => item.taskId)).toEqual([
      'task-1',
    ])
    expect(taskExecutionRound(state.validationTasks[0]!, state.evidence)).toBe(2)
    expect(evidenceCounts(state.evidence)).toEqual({
      support: 0,
      contradict: 0,
      unknown: 1,
      deterministic: 0,
    })
  })
})
