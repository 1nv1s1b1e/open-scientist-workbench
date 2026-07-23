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

/** 逻辑顺序：0 = reasoning, 1 = tool-call / custom, 2 = text */
function getPartPriority(part: ContentPart): number {
  if (part.type === 'reasoning') return 0
  if (part.type === 'tool-call' || part.type.startsWith('data-')) return 1
  if (part.type === 'text') return 2
  return 3
}

/**
 * 把 seed + RunMessage[] 转成 ThreadMessageLike[]。
 *
 * - seed 作为第一条 user 消息
 * - 每个 RunMessage 成为一条 assistant 消息（按 reasoning → tools → text 优先次序排列）
 * - 自动过滤内部 submit_result 工具与纯空完成消息，防止产生空卡片框
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
    const isRunning =
      isLast && (state === 'connecting' || state === 'streaming' || state === 'reconnecting')
    const parts: ContentPart[] = []

    for (const part of runMsg.parts) {
      const converted = toMessagePart(part)
      if (converted) {
        // 过滤内部的 submit_result 结果提交工具
        if (
          converted.type === 'tool-call' &&
          (converted.toolName === 'submit_result' || converted.toolName === 'submit-result')
        ) {
          continue
        }
        parts.push(converted)
      }
    }

    // 按 reasoning → tool-call / data-* → text 排序
    parts.sort((a, b) => getPartPriority(a) - getPartPriority(b))

    // 过滤多余的纯空 text parts
    const validParts = parts.filter((p) => {
      if (p.type === 'text' && p.text.trim() === '' && !isRunning && parts.length > 1) {
        return false
      }
      return true
    })

    // 已完成且未包含任何可显示内容的消息，跳过，不渲染空卡片框
    if (validParts.length === 0 && !isRunning) {
      continue
    }

    msgs.push({
      id: `${runMsg.id}-${i}`,
      role: 'assistant',
      content: validParts.length > 0 ? validParts : [{ type: 'text', text: '' }],
      status: isLast ? toMessageStatus(state) : { type: 'complete', reason: 'stop' },
    })
  }

  return msgs
}
