import type { UIMessageChunk } from '@/lib/types/sse-events'

export type ScientificTaskTraceStatus = 'queued' | 'running' | 'completed' | 'skipped' | 'failed'

export function validationTaskTraceStatus(status: unknown): ScientificTaskTraceStatus {
  if (status === 'running') return 'running'
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'rejected') return 'skipped'
  return 'queued'
}

export interface ScientificTraceMetrics {
  modelCalls: number
  reasoningTokens: number
  processingRuns: number
}

export function summarizeScientificTrace(
  chunks: readonly UIMessageChunk[],
): ScientificTraceMetrics {
  return chunks.reduce<ScientificTraceMetrics>(
    (summary, chunk) => {
      if (chunk.type !== 'custom') return summary
      const payload = chunk as unknown as Record<string, unknown>
      if (payload.kind === 'scientific.model-run') {
        summary.modelCalls += 1
        const usage =
          payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage)
            ? (payload.usage as Record<string, unknown>)
            : null
        summary.reasoningTokens +=
          typeof usage?.reasoningTokens === 'number' ? usage.reasoningTokens : 0
      }
      if (payload.kind === 'scientific.processing-result') summary.processingRuns += 1
      return summary
    },
    { modelCalls: 0, reasoningTokens: 0, processingRuns: 0 },
  )
}
