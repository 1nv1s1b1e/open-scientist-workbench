import { completeRun } from '@open-scientist/storage'
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai'
import type { Context } from 'hono'
import type { Run } from './run-stream'

/**
 * SSE response for a run stream. Wraps `run.getReadable()` in an identity
 * `TransformStream` (the hook for future keepalive / filtering / annotation)
 * and returns a `createUIMessageStreamResponse`.
 *
 * When `startIndex < 0` (tail-relative), the response carries an
 * `x-workflow-stream-tail-index` header with the absolute tail index.
 */
export async function respondWithRunStream(
  c: Context,
  run: Run,
  startIndex = 0,
): Promise<Response> {
  const headers: Record<string, string> = { 'x-workflow-run-id': run.runId }
  const readable = run.getReadable({ startIndex })

  if (startIndex < 0) {
    const tailIndex = await readable.getTailIndex()
    headers['x-workflow-stream-tail-index'] = String(tailIndex)
  }

  return createUIMessageStreamResponse({
    stream: readable.pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform(chunk, controller) {
          controller.enqueue(chunk)
        },
      }),
    ),
    headers,
  })
}

/**
 * Attach a completion handler to a run: when the tournament settles, update
 * the SQLite row with final status + metrics so GET /runs/:id returns
 * accurate data after the SSE stream ends.
 *
 * - Resolved (completed) → `completeRun(..., 'completed', { bestF1, currentRound })`
 * - Rejected (failed)    → `completeRun(..., 'failed')`
 */
export function attachRunCompletion(projectName: string, run: Run): void {
  void run.result.then(
    (output) => {
      // Cancellation resolves without a workflow result. The stop endpoint is
      // the single owner of the persisted `stopped` status, so do not race it
      // with a late `completed` update.
      if (!output) return
      void completeRun(projectName, run.runId, 'completed', {
        bestF1: 'bestF1' in output ? output.bestF1 : undefined,
        currentRound: output?.totalRounds,
      })
    },
    () => {
      void completeRun(projectName, run.runId, 'failed')
    },
  )
}
