/**
 * Shared helpers for forwarding agent `fullStream` events to an orchestrator
 * chunk sink. Used by all 6 agent workflow wrappers.
 */
import { type TextStreamPart, type ToolSet, toUIMessageStream, type UIMessageChunk } from 'ai'

/**
 * Chunk sink callback used by workflow wrappers to forward UI chunks up to the
 * tournament orchestrator (and from there to the {@link RunRegistry} buffer).
 */
export type EmitChunk = (chunk: UIMessageChunk) => void

/**
 * Forward every {@link UIMessageChunk} produced by an agent's `fullStream` to
 * the optional `emitChunk` callback.
 *
 * Conversion path: `result.fullStream` (an `AsyncIterableStream<
 * TextStreamPart<TOOLS>>`, which is also a `ReadableStream`) →
 * `toUIMessageStream({stream, tools})` (AI SDK's official transformer) →
 * `ReadableStream<UIMessageChunk>` → drained chunk-by-chunk into `emitChunk`.
 *
 * When `emitChunk` is undefined this function still drains the stream (so the
 * agent's tool loop runs to completion and `result.output` resolves), it just
 * discards the chunks.
 *
 * The drain is awaited so that by the time the caller reads `result.output`,
 * all stream events have been forwarded — preserving causal ordering across
 * sequential sub-agent invocations in the tournament orchestrator.
 */
export async function streamAgentOutput<TOOLS extends ToolSet>(
  fullStream: ReadableStream<TextStreamPart<TOOLS>>,
  tools: ToolSet | undefined,
  emitChunk: EmitChunk | undefined,
): Promise<void> {
  const uiStream = toUIMessageStream({
    stream: fullStream,
    ...(tools !== undefined ? { tools } : {}),
  })
  const reader = uiStream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value !== undefined && emitChunk !== undefined) {
      emitChunk(value)
    }
  }
}
