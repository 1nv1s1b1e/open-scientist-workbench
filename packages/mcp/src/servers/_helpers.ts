import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** JSON-serialize a payload as a single text-content CallToolResult. */
export function textResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

/** Build an error CallToolResult with a plain text message. */
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Extract a key from an args object, returning undefined if missing. */
export function getArg(args: Record<string, unknown> | undefined, key: string): unknown {
  return args?.[key]
}

/** Assert that a value is a string, throwing a TypeError with the key name. */
export function asString(v: unknown, key: string): string {
  if (typeof v !== 'string') throw new TypeError(`'${key}' must be a string`)
  return v
}

/** Assert that a value is a finite number, throwing a TypeError with the key name. */
export function asNumber(v: unknown, key: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`'${key}' must be a finite number`)
  }
  return v
}

/** Assert that a value is an array of strings, throwing a TypeError with the key name. */
export function asStringArray(v: unknown, key: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new TypeError(`'${key}' must be an array of strings`)
  }
  return v
}

/** Assert that a value is one of the allowed enum values. */
export function asEnum<T extends string>(v: unknown, key: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new TypeError(`'${key}' must be one of ${allowed.join(', ')}`)
  }
  return v as T
}

/** Build a `{ type: 'string', description }` JSON Schema fragment. */
export function str(desc: string) {
  return { type: 'string' as const, description: desc }
}

/** Build a `{ type: 'number', description }` JSON Schema fragment. */
export function num(desc: string) {
  return { type: 'number' as const, description: desc }
}

/** Build a `{ type: 'integer', description }` JSON Schema fragment. */
export function int(desc: string) {
  return { type: 'integer' as const, description: desc }
}

/** Build a `{ type: 'array', items: { type: 'string' }, description }` JSON Schema fragment. */
export function arrStr(desc: string) {
  return { type: 'array' as const, items: { type: 'string' as const }, description: desc }
}
