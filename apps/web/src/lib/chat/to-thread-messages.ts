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

const INTERNAL_TOOL_NAMES = new Set([
  'bash',
  'bashtool',
  'readfile',
  'writefile',
  'loadskill',
  'submitresult',
])

function isInternalTool(toolName: string): boolean {
  return INTERNAL_TOOL_NAMES.has(toolName.toLowerCase().replace(/[-_]/g, ''))
}

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
 * - 用户说明作为第一条 user 消息；科学模式的现象内容由工作台单独展示
 * - 每个 RunMessage 成为一条 assistant 消息（按 reasoning → tools → text 优先次序排列）
 * - 自动过滤内部 submit_result 工具与纯空完成消息，防止产生空卡片框
 * - 当 selectedAgent 非空时，仅显示该 agent 的消息（未到达的 agent 显示提示）
 * - 当 selectedRound 非空时，仅显示该轮次的消息
 * - 当 selectedHypoId 非空时，仅显示该假设的消息（Explore 并行多假设时区分）
 */
export function toThreadMessages(
  inputText: string | null,
  runMessages: RunMessage[],
  state: StreamState,
  selectedAgent?: string | null,
  selectedRound?: number | null,
  selectedHypoId?: string | null,
): ThreadMessageLike[] {
  const msgs: ThreadMessageLike[] = []

  // 用户说明（不是科学模式的 phenomenon payload）
  if (inputText) {
    msgs.push({
      id: 'user-input',
      role: 'user',
      content: [{ type: 'text', text: inputText }],
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
        // 低层文件、shell 与 schema 提交事件保留在“执行轨迹”，不挤占模型摘要侧栏。
        if (converted.type === 'tool-call' && isInternalTool(converted.toolName)) {
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
    if (validParts.length === 0) {
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
