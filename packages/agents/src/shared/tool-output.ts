/**
 * Tool Output mode — PydanticAI-style structured output without
 * `response_format` API parameter.
 *
 * vLLM (and some other OpenAI-compatible gateways) disable `tool_calls`
 * generation when `response_format: { type: 'json_object' }` is sent. AI SDK's
 * `Output.object({ schema })` sets `responseFormat`, which means agents on vLLM
 * never call their function tools.
 *
 * This module replaces `Output.object` with a **submit_result** tool whose
 * `inputSchema` IS the desired output schema. The agent calls function tools to
 * do research, then calls `submit_result` to deliver its structured result.
 * `stopWhen: [isStepCount(N), hasToolCall('submit_result')]` terminates the
 * loop as soon as the result is submitted. No `response_format` is sent —
 * tool calling and structured output coexist.
 *
 * See: https://ai-sdk.dev/docs/agents/loop-control (Forced Tool Calling)
 */
import { type StaticToolCall, type ToolSet, tool } from 'ai'
import type { ZodSchema } from 'zod'

/**
 * Create a `submit_result` tool whose input schema matches the desired output
 * type. The tool has **no execute function** — it is a pure signal tool: the
 * agent calls it to submit its final result, and the loop stops.
 *
 * The caller extracts the submitted value from `result.staticToolCalls` (see
 * {@link extractSubmitResult}).
 */
export function makeSubmitResultTool<T extends ZodSchema>(schema: T) {
  return tool({
    description:
      'Submit your final structured result. Call this tool ONCE when you have completed all research and are ready to deliver the output. Do NOT call any other tool after this one.',
    inputSchema: schema,
    // No execute — this is a signal tool. The loop stops via hasToolCall.
  })
}

/**
 * Extract the submitted result from `result.staticToolCalls`.
 *
 * Finds the first `submit_result` tool call in the array and returns its
 * `input`. When no `submit_result` call was made (the agent hit the step
 * limit without submitting), returns `fallback` if provided, otherwise throws.
 *
 * Providing a `fallback` makes the tournament resilient to agents that
 * exhaust their step budget during iterative exploration without ever
 * submitting — the caller gets a zero-valued result and the tournament
 * can continue to the next phase (e.g. Oracle critique) instead of crashing.
 */
export function extractSubmitResult<TOOLS extends ToolSet, T>(
  staticToolCalls: Array<StaticToolCall<TOOLS>>,
  toolName: string = 'submit_result',
  fallback?: T,
): T {
  for (const tc of staticToolCalls) {
    if (tc.toolName === toolName) {
      return tc.input as T
    }
  }
  if (fallback !== undefined) return fallback
  throw new Error(
    `Agent did not call '${toolName}' — it hit the step limit without submitting a result. Check the agent's tool calls and instructions.`,
  )
}
