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
        result: part.output ?? null,
        isError: part.errorText != null,
      }
    case 'custom': {
      // Custom chunks (agent-state, phase-start, round-update) are used for
      // state tracking only — they should NOT render as message content parts.
      // Returning null here filters them out of the content array.
      return null
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
 * - 每个 RunMessage 成为一条 assistant 消息（按 parts 在流中的原始时间序排列）
 * - 自动过滤内部 submit_result 工具与纯空完成消息，防止产生空卡片框
 * - 当 hideTools 为 true 时，过滤所有 tool-call parts
 * - 当 selectedAgent 非空时，仅显示该 agent 的消息（未到达的 agent 显示提示）
 * - 当 selectedRound 非空时，仅显示该轮次的消息
 * - 当 selectedHypoId 非空时，仅显示该假设的消息（Explore 并行多假设时区分）
 */
export function toThreadMessages(
  seed: string | null,
  runMessages: RunMessage[],
  state: StreamState,
  selectedAgent?: string | null,
  selectedRound?: number | null,
  selectedHypoId?: string | null,
  hideTools?: boolean,
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

  // 多级过滤：agent → round → hypoId
  let filteredMessages = runMessages
  if (selectedAgent) {
    filteredMessages = filteredMessages.filter((m) => m.agentRole === selectedAgent)
  }
  if (selectedRound != null) {
    filteredMessages = filteredMessages.filter((m) => m.round === selectedRound)
  }
  if (selectedHypoId) {
    // Show messages for the selected hypothesis PLUS non-hypothesis-specific
    // messages (Librarian/Oracle/Prometheus have hypoId == undefined/null).
    filteredMessages = filteredMessages.filter(
      (m) => m.hypoId === selectedHypoId || m.hypoId == null,
    )
  }

  // selectedAgent 非空且该 agent 还没有任何消息 → 显示占位提示
  if (selectedAgent && filteredMessages.length === 0) {
    msgs.push({
      id: 'agent-placeholder',
      role: 'assistant',
      content: [{ type: 'text', text: `等待 ${selectedAgent} agent 启动…` }],
      status: { type: 'running' },
    })
    return msgs
  }

  // assistant 消息
  for (let i = 0; i < filteredMessages.length; i++) {
    const runMsg = filteredMessages[i]!
    const isLast = i === filteredMessages.length - 1
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
        // hideTools 模式下跳过所有 tool-call
        if (hideTools && converted.type === 'tool-call') {
          continue
        }
        parts.push(converted)
      }
    }

    // 保留原始时间序（流中的产出顺序），不重排
    // — 之前的 sort(reasoning→tool→text) 会把所有 tool 提到文本前面，不符合实际对话流

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
