import type { TournamentWorkflowInput, TournamentResult } from '@open-scientist/agents'
import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { RunRegistryImpl, type Run, type WorkflowFn } from '../src/lib/run-stream.ts'

/**
 * Unit tests for `RunRegistryImpl` — the deep module that was previously
 * mocked entirely in runs.test.ts, leaving its replay / live-forward / cancel
 * / eviction / race-handling logic untested.
 *
 * Each test constructs a `RunRegistryImpl` with a fake `WorkflowFn` that
 * emits deterministic chunks, so the registry's buffering + stream semantics
 * are exercised without a real tournament.
 */

function makeChunk(text: string): UIMessageChunk {
  return { type: 'text', text } as unknown as UIMessageChunk
}

function makeResult(rounds = 1, f1 = 0.5): TournamentResult {
  return {
    bestF1: f1,
    totalRounds: rounds,
    winningStatement: 'test hypothesis',
    hypotheses: [],
  } as unknown as TournamentResult
}

/** Collect all chunks from a RunReadable into an array. */
async function drainChunks(run: Run, startIndex?: number): Promise<UIMessageChunk[]> {
  const readable = run.getReadable(startIndex !== undefined ? { startIndex } : {})
  const chunks: UIMessageChunk[] = []
  const stream = readable.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        chunks.push(chunk)
        controller.enqueue(chunk)
      },
    }),
  )
  const reader = stream.getReader()
  for (;;) {
    const { done } = await reader.read()
    if (done) break
  }
  return chunks
}

/**
 * Fake workflow that emits chunks on a timer, then resolves.
 * Returns the emitChunk sink so tests can push chunks from outside.
 */
function makeDelayedWorkflow(_emitDelayMs = 0): {
  workflowFn: WorkflowFn
  emit: (chunk: UIMessageChunk) => void
  resolve: (r: TournamentResult) => void
  reject: (e: Error) => void
} {
  let emitFn: ((chunk: UIMessageChunk) => void) | null = null
  let resolveFn: ((r: TournamentResult) => void) | null = null
  let rejectFn: ((e: Error) => void) | null = null
  const workflowFn = vi.fn(async (input: TournamentWorkflowInput) => {
    emitFn = input.emitChunk ?? null
    return new Promise<TournamentResult>((resolve, reject) => {
      resolveFn = resolve
      rejectFn = reject
    })
  })
  return {
    workflowFn,
    emit: (chunk: UIMessageChunk) => emitFn?.(chunk),
    resolve: (r: TournamentResult) => resolveFn?.(r),
    reject: (e: Error) => rejectFn?.(e),
  }
}

describe('RunRegistryImpl', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('start + getRun', () => {
    it('registers a run and returns it via getRun', async () => {
      const { workflowFn, resolve } = makeDelayedWorkflow()
      const registry = new RunRegistryImpl(workflowFn)

      const run = registry.start({
        seed: 'test',
        projectId: 'proj',
        runId: 'run-1',
        modelConfig: {
          provider: 'openai',
          model: 'm',
          thinkingLevel: 'medium',
          apiMode: 'chat',
          apiKey: 'k',
        },
      } as TournamentWorkflowInput)

      expect(run.runId).toBe('run-1')
      expect(registry.getRun('run-1')).toBe(run)

      resolve(makeResult())
      await run.result
    })

    it('throws on duplicate runId', () => {
      const { workflowFn } = makeDelayedWorkflow()
      const registry = new RunRegistryImpl(workflowFn)

      registry.start({
        seed: 'test',
        projectId: 'proj',
        runId: 'dup',
        modelConfig: {
          provider: 'openai',
          model: 'm',
          thinkingLevel: 'medium',
          apiMode: 'chat',
          apiKey: 'k',
        },
      } as TournamentWorkflowInput)

      expect(() =>
        registry.start({
          seed: 'test',
          projectId: 'proj',
          runId: 'dup',
          modelConfig: {
            provider: 'openai',
            model: 'm',
            thinkingLevel: 'medium',
            apiMode: 'chat',
            apiKey: 'k',
          },
        } as TournamentWorkflowInput),
      ).toThrow('already registered')
    })

    it('returns undefined for unknown runId', () => {
      const { workflowFn } = makeDelayedWorkflow()
      const registry = new RunRegistryImpl(workflowFn)
      expect(registry.getRun('nonexistent')).toBeUndefined()
    })
  })

  describe('chunk buffering + replay', () => {
    it('buffers chunks emitted by the workflow', async () => {
      const { workflowFn, emit, resolve } = makeDelayedWorkflow()
      const registry = new RunRegistryImpl(workflowFn)

      const run = registry.start({
        seed: 'test',
        projectId: 'proj',
        runId: 'run-buf',
        modelConfig: {
          provider: 'openai',
          model: 'm',
          thinkingLevel: 'medium',
          apiMode: 'chat',
          apiKey: 'k',
        },
      } as TournamentWorkflowInput)

      emit(makeChunk('a'))
      emit(makeChunk('b'))
      emit(makeChunk('c'))

      expect(run.chunks.map((c) => (c as unknown as { text: string }).text)).toEqual([
        'a',
        'b',
        'c',
      ])

      resolve(makeResult())
      await run.result
    })

    it('replays buffered chunks from startIndex 0 on connect', async () => {
      const { workflowFn, emit, resolve } = makeDelayedWorkflow()
      const registry = new RunRegistryImpl(workflowFn)

      const run = registry.start({
        seed: 'test',
        projectId: 'proj',
        runId: 'run-replay',
        modelConfig: {
          provider: 'openai',
          model: 'm',
          thinkingLevel: 'medium',
          apiMode: 'chat',
          apiKey: 'k',
        },
      } as TournamentWorkflowInput)

      emit(makeChunk('a'))
      emit(makeChunk('b'))

      // Resolve so the stream closes after replaying buffered chunks
      resolve(makeResult())

      const chunks = await drainChunks(run, 0)
      expect(chunks.map((c) => (c as unknown as { text: string }).text)).toEqual(['a', 'b'])

      await run.result
    })

    it('supports tail-relative startIndex (negative)', async () => {
      const { workflowFn, emit, resolve } = makeDelayedWorkflow()
      const registry = new RunRegistryImpl(workflowFn)

      const run = registry.start({
        seed: 'test',
        projectId: 'proj',
        runId: 'run-tail',
        modelConfig: {
          provider: 'openai',
          model: 'm',
          thinkingLevel: 'medium',
          apiMode: 'chat',
          apiKey: 'k',
        },
      } as TournamentWorkflowInput)

      emit(makeChunk('a'))
      emit(makeChunk('b'))
      emit(makeChunk('c'))
      emit(makeChunk('d'))

      // -2 → last 2 chunks
      const readable = run.getReadable({ startIndex: -2 })
      const tailIndex = await readable.getTailIndex()
      expect(tailIndex).toBe(3) // 0-indexed, 4 chunks → last index is 3

      // Resolve so the stream closes after replaying
      resolve(makeResult())

      const chunks = await drainChunks(run, -2)
      expect(chunks.map((c) => (c as unknown as { text: string }).text)).toEqual(['c', 'd'])

      await run.result
    })

    it('clamps out-of-range positive startIndex to buffer end (no chunks replayed)', async () => {
      const { workflowFn, emit, resolve } = makeDelayedWorkflow()
      const registry = new RunRegistryImpl(workflowFn)

      const run = registry.start({
        seed: 'test',
        projectId: 'proj',
        runId: 'run-clamp',
        modelConfig: {
          provider: 'openai',
          model: 'm',
          thinkingLevel: 'medium',
          apiMode: 'chat',
          apiKey: 'k',
        },
      } as TournamentWorkflowInput)

      emit(makeChunk('a'))

      // startIndex 100 → way past the buffer end, should replay nothing
      const readable = run.getReadable({ startIndex: 100 })
      expect(await readable.getTailIndex()).toBe(0)

      resolve(makeResult())
      await run.result
    })
  })

  describe('live-forward', () => {
    it('forwards new chunks to an active subscriber in real time', async () => {
      const { workflowFn, emit, resolve } = makeDelayedWorkflow()
      const registry = new RunRegistryImpl(workflowFn)

      const run = registry.start({
        seed: 'test',
        projectId: 'proj',
        runId: 'run-live',
        modelConfig: {
          provider: 'openai',
          model: 'm',
          thinkingLevel: 'medium',
          apiMode: 'chat',
          apiKey: 'k',
        },
      } as TournamentWorkflowInput)

      // Subscribe before chunks are emitted
      const collected: string[] = []
      const stream = run.getReadable({ startIndex: 0 }).pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform(chunk, controller) {
            collected.push((chunk as unknown as { text: string }).text)
            controller.enqueue(chunk)
          },
        }),
      )
      const reader = stream.getReader()

      // Give the stream's start() callback time to register the controller
      // with the activeControllers set. The ReadableStream constructor calls
      // start() synchronously, but we need to yield to the microtask queue
      // to ensure the registration is visible.
      await new Promise((r) => setTimeout(r, 20))

      emit(makeChunk('live-1'))
      emit(makeChunk('live-2'))

      // Read the two chunks to pump the transform
      await reader.read()
      await reader.read()

      expect(collected).toEqual(['live-1', 'live-2'])

      resolve(makeResult())
      await run.result
      reader.releaseLock()
    })

    it('drops a controller that throws on enqueue (closed by consumer)', async () => {
      const { workflowFn, emit, resolve } = makeDelayedWorkflow()
      const registry = new RunRegistryImpl(workflowFn)

      const run = registry.start({
        seed: 'test',
        projectId: 'proj',
        runId: 'run-drop',
        modelConfig: {
          provider: 'openai',
          model: 'm',
          thinkingLevel: 'medium',
          apiMode: 'chat',
          apiKey: 'k',
        },
      } as TournamentWorkflowInput)

      // Subscribe and immediately cancel to close the controller
      const readable = run.getReadable({ startIndex: 0 })
      const reader = readable
        .pipeThrough(
          new TransformStream<UIMessageChunk, UIMessageChunk>({
            transform(chunk, controller) {
              controller.enqueue(chunk)
            },
          }),
        )
        .getReader()

      reader.releaseLock()

      // Emitting after the consumer is gone should not throw
      emit(makeChunk('after-close'))

      resolve(makeResult())
      await run.result
    })
  })

  describe('cancellation', () => {
    it('cancel() aborts the AbortController signal', async () => {
      let signalAborted = false
      const customWorkflow: WorkflowFn = async (input) => {
        input.abortSignal?.addEventListener('abort', () => {
          signalAborted = true
        })
        return new Promise<TournamentResult>(() => {})
      }
      const customRegistry = new RunRegistryImpl(customWorkflow)

      const run = customRegistry.start({
        seed: 'test',
        projectId: 'proj',
        runId: 'run-cancel',
        modelConfig: {
          provider: 'openai',
          model: 'm',
          thinkingLevel: 'medium',
          apiMode: 'chat',
          apiKey: 'k',
        },
      } as TournamentWorkflowInput)

      await run.cancel()
      expect(signalAborted).toBe(true)
    })

    it('cancel() causes result to resolve to undefined (not reject)', async () => {
      const customWorkflow: WorkflowFn = async (input) => {
        return new Promise<TournamentResult>((_resolve, reject) => {
          input.abortSignal?.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        })
      }
      const registry = new RunRegistryImpl(customWorkflow)

      const run = registry.start({
        seed: 'test',
        projectId: 'proj',
        runId: 'run-cancel-result',
        modelConfig: {
          provider: 'openai',
          model: 'm',
          thinkingLevel: 'medium',
          apiMode: 'chat',
          apiKey: 'k',
        },
      } as TournamentWorkflowInput)

      await run.cancel()
      // Should resolve to undefined, not reject
      const result = await run.result
      expect(result).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('emits an error chunk and rejects result when workflow throws', async () => {
      const errorWorkflow: WorkflowFn = async () => {
        throw new Error('workflow boom')
      }
      const registry = new RunRegistryImpl(errorWorkflow)

      const run = registry.start({
        seed: 'test',
        projectId: 'proj',
        runId: 'run-err',
        modelConfig: {
          provider: 'openai',
          model: 'm',
          thinkingLevel: 'medium',
          apiMode: 'chat',
          apiKey: 'k',
        },
      } as TournamentWorkflowInput)

      // The error chunk should be buffered
      await expect(run.result).rejects.toThrow('workflow boom')

      // An error chunk was emitted
      const errorChunks = run.chunks.filter((c) => c.type === 'error')
      expect(errorChunks).toHaveLength(1)
      expect((errorChunks[0] as unknown as { errorText: string }).errorText).toBe('workflow boom')
    })
  })

  describe('settlement + eviction', () => {
    it('auto-evicts the run 60s after settlement', async () => {
      vi.useFakeTimers()
      const { workflowFn, resolve } = makeDelayedWorkflow()
      const registry = new RunRegistryImpl(workflowFn)

      const run = registry.start({
        seed: 'test',
        projectId: 'proj',
        runId: 'run-evict',
        modelConfig: {
          provider: 'openai',
          model: 'm',
          thinkingLevel: 'medium',
          apiMode: 'chat',
          apiKey: 'k',
        },
      } as TournamentWorkflowInput)

      resolve(makeResult())
      await run.result

      // Run is still registered immediately after settlement
      expect(registry.getRun('run-evict')).toBeDefined()

      // Advance 60s → evicted
      vi.advanceTimersByTime(60_000)
      expect(registry.getRun('run-evict')).toBeUndefined()
    })

    it('closes active controllers on settlement', async () => {
      const { workflowFn, resolve } = makeDelayedWorkflow()
      const registry = new RunRegistryImpl(workflowFn)

      const run = registry.start({
        seed: 'test',
        projectId: 'proj',
        runId: 'run-close',
        modelConfig: {
          provider: 'openai',
          model: 'm',
          thinkingLevel: 'medium',
          apiMode: 'chat',
          apiKey: 'k',
        },
      } as TournamentWorkflowInput)

      // Subscribe
      const collected: string[] = []
      const stream = run.getReadable({ startIndex: 0 }).pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform(chunk, controller) {
            collected.push((chunk as unknown as { text: string }).text)
            controller.enqueue(chunk)
          },
        }),
      )
      const reader = stream.getReader()

      // Give the stream time to start
      await new Promise((r) => setTimeout(r, 10))

      resolve(makeResult())
      await run.result

      // The stream should end (reader.read() returns done)
      const { done } = await reader.read()
      expect(done).toBe(true)
    })
  })
})
