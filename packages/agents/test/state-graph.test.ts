import { describe, expect, it } from 'vite-plus/test'

import { GRAPH_END, StateGraph } from '../src/orchestration/state-graph.ts'

describe('StateGraph', () => {
  it('runs conditional cycles and checkpoints every completed node', async () => {
    type State = { count: number; log: string[] }
    const checkpoints: Array<{ currentNode: string; nextNode: string; step: number; state: State }> = []
    const graph = new StateGraph<State>()
      .addNode('increment', (state) => ({
        count: state.count + 1,
        log: [...state.log, 'increment'],
      }))
      .addNode('route', (state) => ({ log: [...state.log, 'route'] }))
      .setEntryPoint('increment')
      .addEdge('increment', 'route')
      .addConditionalEdges('route', (state) =>
        state.count < 2 ? 'increment' : GRAPH_END,
      )
      .compile()

    const result = await graph.run(
      { count: 0, log: [] },
      { checkpoint: (checkpoint) => checkpoints.push(checkpoint) },
    )

    expect(result.state).toEqual({
      count: 2,
      log: ['increment', 'route', 'increment', 'route'],
    })
    expect(result.steps).toBe(4)
    expect(checkpoints).toHaveLength(4)
    expect(checkpoints.at(-1)).toMatchObject({
      currentNode: 'route',
      nextNode: GRAPH_END,
      step: 4,
    })
  })

  it('retries a failed node within its configured attempt budget', async () => {
    let attempts = 0
    const events: string[] = []
    const graph = new StateGraph<{ value: number }>()
      .addNode(
        'unstable',
        () => {
          attempts += 1
          if (attempts < 3) throw new Error('temporary')
          return { value: 7 }
        },
        { maxAttempts: 3 },
      )
      .setEntryPoint('unstable')
      .addEdge('unstable', GRAPH_END)
      .compile()

    const result = await graph.run(
      { value: 0 },
      { onEvent: (event) => events.push(event.type) },
    )

    expect(result.state.value).toBe(7)
    expect(attempts).toBe(3)
    expect(events.filter((event) => event === 'node-retry')).toHaveLength(2)
  })

  it('resumes from a checkpoint target without replaying completed nodes', async () => {
    let firstCalls = 0
    const graph = new StateGraph<{ value: number }>()
      .addNode('first', () => {
        firstCalls += 1
        return { value: 1 }
      })
      .addNode('second', (state) => ({ value: state.value + 1 }))
      .setEntryPoint('first')
      .addEdge('first', 'second')
      .addEdge('second', GRAPH_END)
      .compile()

    const result = await graph.run({ value: 1 }, { startAt: 'second' })

    expect(firstCalls).toBe(0)
    expect(result.state.value).toBe(2)
  })

  it('stops before execution when aborted and rejects unbounded cycles', async () => {
    const controller = new AbortController()
    controller.abort()
    const graph = new StateGraph<{ count: number }>()
      .addNode('cycle', (state) => ({ count: state.count + 1 }))
      .setEntryPoint('cycle')
      .addEdge('cycle', 'cycle')
      .compile()

    await expect(
      graph.run({ count: 0 }, { signal: controller.signal }),
    ).rejects.toThrow('aborted')
    await expect(graph.run({ count: 0 }, { maxSteps: 2 })).rejects.toThrow(
      'maximum step count',
    )
  })
})
