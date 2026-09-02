import { scientificLoopWorkflow, tournamentWorkflow } from '@open-scientist/agents'
import type {
  ScientificLoopWorkflowInput,
  TournamentWorkflowInput,
  TournamentResult,
} from '@open-scientist/agents'
import type { ScientificLoopResult } from '@open-scientist/schema'
import { appendRunChunk } from '@open-scientist/storage'
import type { UIMessageChunk } from 'ai'

import { createRunHumanControl, removeRunHumanControl } from './run-control'

/**
 * In-memory registry of active tournament runs.
 *
 * Hand-rolled chunk ring buffer. Each {@link Run} collects the
 * `UIMessageChunk`s emitted by the workflow (via the `emitChunk` sink) so
 * clients can:
 *   1. consume the live SSE stream from POST `/runs`, and
 *   2. reconnect from a `startIndex` via GET `/runs/:id/stream`.
 *
 * Chunks and final run state are durably persisted in SQLite. Active workflow
 * execution remains process-local, while scientific checkpoints and legacy
 * tournament snapshots provide their respective resume paths after restart.
 *
 * **Seam**: the workflow function is injected via the constructor so the
 * registry's deep logic (replay-on-connect, live-forward, tail indexing,
 * abort threading, 60s eviction, 3 rejection guards) can be unit-tested with
 * a fake workflow instead of the real workflow dispatch (scientific loop
 * vs. legacy tournament).
 */

/** A single run's state and stream surface. */
export interface Run {
  /** Transport-level run id (returned to client via `x-workflow-run-id`). */
  runId: string
  /** Business-level run id threaded through runtimeContext / snapshots. */
  workflowRunId: string
  /** Buffered `UIMessageChunk`s emitted so far, in order. */
  chunks: UIMessageChunk[]
  /** Resolves to the tournament result once the workflow completes. */
  result: Promise<TournamentResult | ScientificLoopResult | undefined>
  /** Aborts the underlying tournament (signals tool exec / LLM calls). */
  cancel: () => Promise<void>
  /**
   * Returns a `ReadableStream` of chunks starting at `startIndex`.
   *
   * Supports tail-relative indexes (`startIndex < 0`): `-3` reads the last 3
   * chunks. The returned stream also exposes `getTailIndex()` so callers can
   * reconcile the client cursor after a tail-relative reconnect.
   */
  getReadable: (opts?: { startIndex?: number }) => RunReadable
}

/** The object returned by `Run.getReadable()` — a stream + tail-index probe. */
export interface RunReadable {
  /** Pipe the chunk stream through a transform (e.g. identity for SSE). */
  pipeThrough: <T>(transform: TransformStream<UIMessageChunk, T>) => ReadableStream<T>
  /** Absolute index of the last buffered chunk (chunks.length - 1). */
  getTailIndex: () => Promise<number>
}

/**
 * Workflow function type — the seam between the registry and the two
 * supported workflows.
 *
 * Production dispatches on the input shape: a `phenomenon` (or a
 * `scientificResume`) routes to the current `scientificLoopWorkflow`; a bare
 * seed routes to the archived `tournamentWorkflow` (legacy compatibility
 * path). Tests bind this to a fake that emits deterministic chunks.
 */
export type WorkflowResult = TournamentResult | ScientificLoopResult
export type WorkflowFn = (input: TournamentWorkflowInput) => Promise<WorkflowResult>

/**
 * Run registry interface — the contract `runs.ts` depends on.
 *
 * `RunRegistryImpl` is the single production implementation. Tests can
 * construct one with a fake `WorkflowFn` to exercise the deep logic
 * (replay, live-forward, cancel, eviction, race handling) without a real
 * tournament.
 */
export interface RunRegistry {
  start(input: TournamentWorkflowInput): Run
  getRun(runId: string): Run | undefined
}

/**
 * Concrete {@link RunRegistry} backed by an in-memory `Map`.
 *
 * The workflow function is injected at construction so the registry's
 * buffering / replay / eviction logic is decoupled from the tournament
 * implementation.
 */
export class RunRegistryImpl implements RunRegistry {
  private readonly registry = new Map<string, Run>()

  constructor(private readonly workflowFn: WorkflowFn) {}

  /**
   * Start a tournament run in the background.
   *
   * Returns the {@link Run} once registered (without awaiting completion). The
   * run's chunks populate asynchronously as sub-agents emit stream events.
   *
   * Live chunk delivery: `emitChunk` pushes new chunks into the buffer AND
   * forwards them to every active stream controller (subscribers to the live
   * SSE feed). When the run settles, all active controllers are closed.
   *
   * Cancellation: the `AbortController`'s signal is threaded through
   * `TournamentWorkflowInput.abortSignal` → each sub-workflow →
   * `agent.stream({abortSignal})`, so `POST /stop` actually halts LLM calls
   * + tool execution rather than merely marking the SQLite row stopped.
   */
  start(input: TournamentWorkflowInput): Run {
    const runId = input.runId
    if (this.registry.has(runId)) {
      throw new Error(`Run "${runId}" is already registered`)
    }

    const abortController = new AbortController()
    const chunks: UIMessageChunk[] = []
    // Active stream controllers for live SSE subscribers. Each `getReadable()`
    // call registers its controller here so `emitChunk` can forward new chunks
    // in real time (not just replay the buffer at connect time). When the run
    // settles, every controller is closed and the set is cleared.
    const activeControllers = new Set<ReadableStreamDefaultController<UIMessageChunk>>()
    let chunkSeq = 0
    let chunkPersistenceError: Error | null = null
    let chunkWrites: Promise<void> = Promise.resolve()

    const emit = (chunk: UIMessageChunk) => {
      chunks.push(chunk)
      const seq = chunkSeq++
      // Keep live delivery non-blocking, but serialize writes and fail the run
      // if durable persistence did not complete.
      chunkWrites = chunkWrites.then(async () => {
        try {
          await appendRunChunk(input.projectId, input.runId, seq, JSON.stringify(chunk))
        } catch (error) {
          chunkPersistenceError ??= error instanceof Error ? error : new Error(String(error))
        }
      })
      for (const controller of activeControllers) {
        try {
          controller.enqueue(chunk)
        } catch {
          // Controller was closed by the consumer (e.g. client disconnected).
          // Drop it from the live set so we stop forwarding to a dead stream.
          activeControllers.delete(controller)
        }
      }
    }

    // Human control surface (pause / steering / optional approval gate). The
    // scientific loop treats it as fully optional: with the gate disarmed and
    // no pause request the loop reaches closure without any human input.
    const humanControl = createRunHumanControl({
      runId,
      ...(input.humanGate ? { gateMode: input.humanGate } : {}),
      ...(input.humanGateTimeoutMs !== undefined
        ? { gateTimeoutMs: input.humanGateTimeoutMs }
        : {}),
    })

    // Kick off the workflow in the background. The abort signal is threaded
    // into workflowFn → sub-workflows → agent.stream so cancellation
    // actually halts in-flight LLM + tool calls (not just marks SQLite).
    //
    // Error handling:
    // - Abort (POST /stop): resolve to `undefined` silently. The stop endpoint
    //   already marks the run as 'stopped' in SQLite; resolving (not rejecting)
    //   avoids a race where `runs.ts` would overwrite 'stopped' with 'failed'.
    // - Real errors: emit an error UIMessageChunk on the SSE feed so the client
    //   sees the failure, then re-throw so `run.result` rejects. The caller in
    //   `runs.ts` attaches `.then(onFulfilled, onRejected)` which calls
    //   `completeRun(..., 'failed')` on rejection.
    // - The `.catch(swallow)` after `.finally()` prevents unhandled rejection
    //   from the finally-derived promise.
    const workflowResult = this.workflowFn({
      ...input,
      emitChunk: emit,
      humanChannel: humanControl,
      ...(input.abortSignal ? {} : { abortSignal: abortController.signal }),
    })
    const result = workflowResult.then(
      async (output) => {
        await chunkWrites
        if (chunkPersistenceError) {
          throw new Error(`Run chunk persistence failed: ${chunkPersistenceError.message}`)
        }
        return output
      },
      async (err) => {
        if (abortController.signal.aborted) {
          await chunkWrites
          return undefined
        }
        // Emit an error chunk so the client sees the failure on the SSE feed
        // rather than the stream just silently ending.
        emit({
          type: 'error',
          errorText: err instanceof Error ? err.message : String(err),
        } as UIMessageChunk)
        await chunkWrites
        throw err
      },
    )

    const run: Run = {
      runId,
      workflowRunId: input.runId,
      chunks,
      result,
      cancel: async () => {
        // Wake any human-gate / pause waiter first so the aborted run cannot
        // hang on a promise that would never resolve.
        removeRunHumanControl(runId)
        abortController.abort()
      },
      getReadable: (opts) => makeReadable(chunks, activeControllers, opts?.startIndex),
    }

    this.registry.set(runId, run)
    // Auto-evict once the tournament settles (success or failure) so the
    // registry doesn't grow unboundedly across runs. We keep the run around
    // while in-flight so /stream reconnects work; after completion clients
    // should read final status from SQLite via GET /runs/:id.
    void result
      .finally(() => {
        // Close any remaining live subscribers so they see stream end rather
        // than hanging on a buffer that will never grow again.
        for (const controller of activeControllers) {
          try {
            controller.close()
          } catch {
            // Already closed — ignore.
          }
        }
        activeControllers.clear()
        // Drop the human control surface with the run.
        removeRunHumanControl(runId)
        // Defer eviction slightly so a reconnect landing right at completion
        // still finds the run.
        setTimeout(() => {
          this.registry.delete(runId)
        }, 60_000)
      })
      .catch(() => {})

    return run
  }

  /** Look up an active run by id. Returns `undefined` if unknown / evicted. */
  getRun(runId: string): Run | undefined {
    return this.registry.get(runId)
  }
}

/**
 * Build a `RunReadable` over the chunk buffer starting at `startIndex`.
 *
 * `startIndex < 0` is tail-relative (e.g. `-3` → last 3 chunks). Out-of-range
 * positive indexes clamp to the buffer end. After replaying existing chunks,
 * the controller is registered with `activeControllers` so live chunks
 * emitted after connect are forwarded to the subscriber. The controller is
 * unregistered on consumer cancel / error.
 */
function makeReadable(
  chunks: UIMessageChunk[],
  activeControllers: Set<ReadableStreamDefaultController<UIMessageChunk>>,
  startIndex?: number,
): RunReadable {
  const resolveStart = () => {
    if (startIndex === undefined) return 0
    if (startIndex < 0) return Math.max(0, chunks.length + startIndex)
    return startIndex
  }

  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      let cursor = resolveStart()
      // Replay any already-buffered chunks from the cursor onward.
      while (cursor < chunks.length) {
        controller.enqueue(chunks[cursor] as UIMessageChunk)
        cursor += 1
      }
      // Register for live chunk delivery. `emit` (in start()) will forward
      // each new chunk to this controller as it arrives.
      activeControllers.add(controller)
    },
    cancel(reason) {
      // Consumer disconnected (e.g. client closed the SSE connection). The
      // controller is no longer usable; drop it from the live set so `emit`
      // stops forwarding to it. We can't reference `controller` here (it's
      // scoped to `start`), so we rely on the fact that a cancelled stream's
      // controller is already detached — emit's try/catch will silently drop
      // enqueues to it. To keep the set tidy, we filter out closed
      // controllers on each emit pass (see `emit` in start()).
      // NOTE: The actual removal happens lazily in `emit`'s catch block.
      void reason
    },
  })

  return {
    pipeThrough: <T>(transform: TransformStream<UIMessageChunk, T>) =>
      stream.pipeThrough(transform),
    getTailIndex: async () => chunks.length - 1,
  }
}

/**
 * Production singleton — dispatches between the current scientific loop and
 * the archived tournament workflow by input shape (see `WorkflowFn`).
 */
const productionWorkflow: WorkflowFn = (input) =>
  input.phenomenon || input.scientificResume
    ? scientificLoopWorkflow({
        ...(input as ScientificLoopWorkflowInput),
        resume: input.scientificResume,
      })
    : tournamentWorkflow(input)

const runRegistry: RunRegistry = new RunRegistryImpl(productionWorkflow)

/**
 * Convenience functions wrapping the singleton, preserving the old
 * `start` / `getRun` call sites.
 */
export function start(input: TournamentWorkflowInput): Run {
  return runRegistry.start(input)
}

export function getRun(runId: string): Run | undefined {
  return runRegistry.getRun(runId)
}
