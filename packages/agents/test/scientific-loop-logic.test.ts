import { describe, expect, it } from 'vite-plus/test'
import {
  deduplicateValidationTasks,
  decideNextRoute,
  summarizeEvidence,
  shouldContinueScientificLoop,
} from '../src/scientific-loop/loop-logic.ts'

const task = (overrides: Record<string, unknown> = {}) => ({
  taskId: 'task-1',
  route: 'explorer' as const,
  type: 'analysis' as const,
  objective: '比较两个活动区的时序关系',
  requiredSourceIds: ['obs-1'],
  discriminatingOutcomes: ['结果 A', '结果 B'],
  hypothesisIds: [],
  predictionIds: [],
  falsificationConditionIds: [],
  triggeredBy: 'e-1',
  status: 'planned' as const,
  resultEvidenceIds: [],
  round: 1,
  fingerprint: 'same-task',
  ...overrides,
})

describe('scientific loop routing logic', () => {
  it('routes executable data work to explorer and mechanism gaps to librarian', () => {
    expect(decideNextRoute(task())).toBe('explorer')
    expect(
      decideNextRoute(
        task({
          type: 'model-update',
          objective: '现有机制不能解释观测，需要提出新的耦合机制',
          route: 'librarian',
        }),
      ),
    ).toBe('librarian')
  })

  it('deduplicates tasks by stable fingerprint while retaining the first trigger', () => {
    const result = deduplicateValidationTasks([
      task(),
      task({ taskId: 'task-2', triggeredBy: 'e-2' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]?.taskId).toBe('task-1')
    expect(result[0]?.triggeredBy).toBe('e-1')
  })

  it('does not collapse unknown evidence into contradiction', () => {
    const result = summarizeEvidence([
      { status: 'support' },
      { status: 'unknown' },
      { status: 'contradict' },
      { status: 'unknown' },
    ])
    expect(result).toEqual({ support: 1, contradict: 1, unknown: 2 })
  })

  it('stops at maxRounds and continues only when new work exists', () => {
    expect(
      shouldContinueScientificLoop({ round: 1, maxRounds: 1, newEvidence: 1, newTasks: 1 }),
    ).toEqual({
      continue: false,
      reason: 'max_rounds_reached',
    })
    expect(
      shouldContinueScientificLoop({ round: 1, maxRounds: 3, newEvidence: 0, newTasks: 0 }),
    ).toEqual({
      continue: false,
      reason: 'no_new_evidence_or_tasks',
    })
    expect(
      shouldContinueScientificLoop({ round: 1, maxRounds: 3, newEvidence: 1, newTasks: 0 }),
    ).toEqual({
      continue: true,
      reason: 'new_evidence',
    })
    expect(
      shouldContinueScientificLoop({
        round: 1,
        maxRounds: 3,
        newEvidence: 5,
        newTasks: 0,
        hasExecutableTask: false,
        hasDeferredTask: true,
      }),
    ).toEqual({
      continue: false,
      reason: 'no_executable_validation_task',
    })
    expect(
      shouldContinueScientificLoop({
        round: 3,
        maxRounds: 3,
        newEvidence: 0,
        newTasks: 0,
        hasExecutableTask: false,
        hasDeferredTask: true,
      }),
    ).toEqual({
      continue: false,
      reason: 'no_executable_validation_task',
    })
  })
})
