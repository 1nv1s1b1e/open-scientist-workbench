/**
 * Tool Output mode — PydanticAI-style structured output without a response_format
 * API parameter.
 *
 * Some OpenAI-compatible gateways disable tool_calls generation when a JSON
 * response format is sent. This module uses a submit_result tool whose input
 * schema is the desired output schema, so tool calling and structured output
 * can coexist.
 */
import { type StaticToolCall, type ToolSet, tool } from 'ai'
import { z, type ZodSchema } from 'zod'

function parseJsonValue(value: string): unknown {
  const trimmed = value.trim().replace(/,\s*$/, '')
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value.trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value.trim()
  }
}

/**
 * A second Qwen-compatible form puts a complete JSON value under the first
 * parameter and appends the remaining named parameters as JSON members, e.g.
 * `[{...}], "rationale": "..."`. Re-wrap it as an object so JSON.parse can
 * recover every parameter without guessing at quoted content.
 */
function parsePackedParameterValue(parameter: string, value: string): Record<string, unknown> | null {
  const trimmed = value.trim().replace(/,\s*$/, '')
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(`{${JSON.stringify(parameter)}:${trimmed}}`) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}


/**
 * Some OpenAI-compatible providers emit a multi-parameter tool call as one
 * string under the first parameter, followed by <parameter=name> segments.
 * Normalize that representation before Zod validates the desired schema.
 */
export function normalizeSubmitResultInput(input: unknown): unknown {
  if (typeof input === 'string') return parseJsonValue(input)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input

  const normalized: Record<string, unknown> = { ...(input as Record<string, unknown>) }
  for (const [key, value] of Object.entries(normalized)) {
    if (typeof value !== 'string') continue
    const marker = /<parameter=([A-Za-z_][A-Za-z0-9_]*)>\s*/g
    const first = marker.exec(value)
    if (!first) {
      const packed = parsePackedParameterValue(key, value)
      if (packed) {
        Object.assign(normalized, packed)
      } else {
        normalized[key] = parseJsonValue(value)
      }
      continue
    }

    normalized[key] = parseJsonValue(value.slice(0, first.index))
    let activeParameter = first[1]!
    let segmentStart = marker.lastIndex
    let next: RegExpExecArray | null
    while ((next = marker.exec(value)) !== null) {
      normalized[activeParameter] = parseJsonValue(value.slice(segmentStart, next.index))
      activeParameter = next[1]!
      segmentStart = marker.lastIndex
    }
    normalized[activeParameter] = parseJsonValue(value.slice(segmentStart))
  }
  return normalized
}

/**
 * Create a submit_result tool whose input schema matches the desired output.
 * The tool has no execute function: it is a signal tool that stops the loop.
 */
export function makeSubmitResultTool<T extends ZodSchema>(schema: T) {
  return tool({
    description:
      '提交最终的结构化结果。研究完成后必须调用且仅调用一次；调用后不要再使用其他工具。所有自然语言字段必须使用中文。',
    inputSchema: z.preprocess(normalizeSubmitResultInput, schema),
  })
}

/**
 * Extract the submitted result from static tool calls.
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
    'Agent did not call ' + toolName + ' — it hit the step limit without submitting a result. Check the agent tool calls and instructions.',
  )
}
