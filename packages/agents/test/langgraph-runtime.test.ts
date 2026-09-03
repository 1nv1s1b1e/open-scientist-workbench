import { END, START, StateGraph, StateSchema } from '@langchain/langgraph'
import { describe, expect, it } from 'vite-plus/test'
import { z } from 'zod'

import {
  createInMemoryScientificRuntime,
  createSqliteScientificRuntime,
  scientificThreadId,
} from '../src/orchestration/langgraph-runtime.ts'

const CounterState = new StateSchema({
  count: z.number(),
})

function counterGraph(runtime: ReturnType<typeof createInMemoryScientificRuntime>) {
  return new StateGraph(CounterState)
    .addNode('increment', ({ count }) => ({ count: count + 1 }))
    .addEdge(START, 'increment')
    .addEdge('increment', END)
    .compile({ checkpointer: runtime.checkpointer })
}

describe('LangGraph scientific runtime', () => {
  it('uses a stable project and run scoped thread id', () => {
    expect(scientificThreadId('project-a', 'run-a')).toBe('project-a:run-a')
  })

  it('persists graph state under the same in-memory thread', async () => {
    const runtime = createInMemoryScientificRuntime()
    const graph = counterGraph(runtime)
    const config = runtime.config('project-a', 'run-a')

    await graph.invoke({ count: 0 }, config)
    const snapshot = await graph.getState(config)

    expect(snapshot.values.count).toBe(1)
    expect(snapshot.next).toEqual([])
  })

  it('supports the SQLite checkpointer used by project runs', async () => {
    const runtime = createSqliteScientificRuntime(':memory:')
    const graph = counterGraph(runtime)
    const config = runtime.config('project-sqlite', 'run-sqlite')

    await graph.invoke({ count: 4 }, config)
    const snapshot = await graph.getState(config)

    expect(snapshot.values.count).toBe(5)
    expect(snapshot.config.configurable?.thread_id).toBe('project-sqlite:run-sqlite')
  })
})
