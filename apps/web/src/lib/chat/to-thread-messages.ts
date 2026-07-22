/**
 * RunMessage → ThreadMessageLike 转换。
 *
 * 把 useRunStream 累积的 RunMessage[] 转成 assistant-ui 的 ThreadMessageLike[]，
 * 用于 useExternalStoreRuntime 的 messages 字段。
 */

import type { ThreadMessageLike } from '@assistant-ui/react'
import type { MessagePart, RunMessage, StreamState } from '@/lib/hooks/useRunStream'

/** 从 ThreadMessageLike['content'] 提取数组形式的元素类型（即单个 Part） */
type ContentArray = Exclude<NonNullable<ThreadMessageLike['content']>, string>
type ContentPart = ContentArray[number]

/** tool-call part 成员的 args 类型 */
type ToolCallArgs = NonNullable<Extract<ContentPart, { type: 'tool-call' }>['args']>

/**
 * 单个 MessagePart → ThreadMessageLike content part。
 */
function toMessagePart(part: MessagePart): ContentPart | null {
  switch (part.kind) {
    case 'text':
      return { type: 'text', text: part.text ?? '' }
    case 'reasoning':
      return { type: 'reasoning', text: part.text ?? '' }
    case 'tool':
      return {
        type: 'tool-call',
        toolCallId: part.toolCallId ?? `call-${part.id}`,
        toolName: part.toolName ?? 'unknown',
        args: (part.input ?? {}) as ToolCallArgs,
        result: part.output,
        isError: part.errorText != null,
      }
    case 'custom': {
      return {
        type: `data-${part.customKind ?? 'event'}` as `data-${string}`,
        data: {},
      }
    }
    default:
      return null
  }
}

/**
 * StreamState → assistant-ui MessageStatus。
 */
function toMessageStatus(state: StreamState): ThreadMessageLike['status'] {
  switch (state) {
    case 'connecting':
    case 'streaming':
    case 'reconnecting':
      return { type: 'running' }
    case 'done':
      return { type: 'complete', reason: 'stop' }
    case 'error':
      return { type: 'incomplete', reason: 'error' }
    case 'stopped':
      return { type: 'incomplete', reason: 'cancelled' }
    default:
      return { type: 'complete', reason: 'unknown' }
  }
}

/**
 * 把 seed + RunMessage[] 转成 ThreadMessageLike[]。
 *
 * - seed 作为第一条 user 消息
 * - 每个 RunMessage 成为一条 assistant 消息（含多个 parts）
 * - 最后一条 assistant 消息的 status 反映当前 stream state
 */
export function toThreadMessages(
  seed: string | null,
  runMessages: RunMessage[],
  state: StreamState,
): ThreadMessageLike[] {
  const msgs: ThreadMessageLike[] = []

  // 用户消息（seed）
  if (seed) {
    msgs.push({
      id: 'user-seed',
      role: 'user',
      content: [{ type: 'text', text: seed }],
    })
  }

  // assistant 消息
  for (let i = 0; i < runMessages.length; i++) {
    const runMsg = runMessages[i]!
    const isLast = i === runMessages.length - 1
    const parts: ContentPart[] = []

    for (const part of runMsg.parts) {
      const converted = toMessagePart(part)
      if (converted) parts.push(converted)
    }

    // 确保 id 唯一：runMsg.id 已含 counter 后缀，但再加 index 双保险
    msgs.push({
      id: `${runMsg.id}-${i}`,
      role: 'assistant',
      content: parts.length > 0 ? parts : [{ type: 'text', text: '' }],
      status: isLast ? toMessageStatus(state) : { type: 'complete', reason: 'stop' },
    })
  }

  return msgs
}
