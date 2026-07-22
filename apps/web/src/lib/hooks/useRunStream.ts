/**
 * 订阅 run SSE 流。
 *
 * 核心逻辑（见 docs/web/02-architecture.md §Transport 流 + 05-api-contracts.md §8）：
 * 1. startRun POST → 拿 x-workflow-run-id + SSE body
 * 2. 逐行解析 `data: <JSON>\n\n`，累积成 messages
 * 3. 流中断（未 finish）→ 自动 reconnectRunStream GET 续传
 * 4. 用户停止 → stopRun POST，不自动重连
 *
 * 不依赖 assistant-ui runtime（先打基础，集成 assistant-ui 在后续 Phase）。
 */

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, reconnectRunStream, startRun, stopRun } from '@/lib/api/client'
import type { UIMessageChunk } from '@/lib/types/sse-events'
import { CustomEventKind } from '@/lib/types/sse-events'
import type { AgentRole, AgentState } from '@/lib/types/visualizers'

/** 累积后的消息 part（一个 tool call / 一段 text / 一段 reasoning） */
export interface MessagePart {
  id: string
  kind: 'text' | 'reasoning' | 'tool' | 'custom'
  toolName?: string
  toolCallId?: string
  /** text / reasoning 的累积内容 */
  text?: string
  /** tool 的 input（解析后） */
  input?: unknown
  /** tool 的 output */
  output?: unknown
  /** tool 错误 */
  errorText?: string
  /** custom 事件的 kind */
  customKind?: string
}

export interface RunMessage {
  id: string
  parts: MessagePart[]
}

export type StreamState =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'reconnecting'
  | 'done'
  | 'error'
  | 'stopped'

interface UseRunStreamOptions {
  project: string
  onError?: (err: Error) => void
  onFinish?: () => void
  /** 连续重连失败上限（默认 5） */
  maxConsecutiveErrors?: number
}

interface UseRunStreamReturn {
  runId: string | null
  messages: RunMessage[]
  state: StreamState
  error: Error | null
  /** Per-agent live state (updated from agent-state custom chunks) */
  agentStates: Partial<Record<AgentRole, AgentState>>
  start: (seed: string, modelAlias?: string) => Promise<void>
  stop: () => Promise<void>
  /** 重置（离开页面时） */
  reset: () => void
}

const DONE_MARKER = '[DONE]'
const MAX_RECONNECT_ERRORS = 5

export function useRunStream(opts: UseRunStreamOptions): UseRunStreamReturn {
  const { project, onError, onFinish, maxConsecutiveErrors = MAX_RECONNECT_ERRORS } = opts
  const [runId, setRunId] = useState<string | null>(null)
  const [messages, setMessages] = useState<RunMessage[]>([])
  const [state, setState] = useState<StreamState>('idle')
  const [error, setError] = useState<Error | null>(null)
  const [agentStates, setAgentStates] = useState<Partial<Record<AgentRole, AgentState>>>({})

  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef<string | null>(null)
  const reconnectErrorsRef = useRef(0)
  const userStoppedRef = useRef(false)
  const partMapRef = useRef<Map<string, MessagePart>>(new Map())
  const currentMessageRef = useRef<RunMessage | null>(null)
  const msgCounterRef = useRef(0)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    runIdRef.current = null
    reconnectErrorsRef.current = 0
    userStoppedRef.current = false
    partMapRef.current = new Map()
    currentMessageRef.current = null
    msgCounterRef.current = 0
    setRunId(null)
    setMessages([])
    setState('idle')
    setError(null)
    setAgentStates({})
  }, [])

  const pushPart = useCallback((part: MessagePart) => {
    partMapRef.current.set(part.id, part)
    if (currentMessageRef.current) {
      // 重建 parts 数组触发 React 更新
      currentMessageRef.current = {
        ...currentMessageRef.current,
        parts: Array.from(partMapRef.current.values()),
      }
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = currentMessageRef.current!
        return next
      })
    }
  }, [])

  const handleChunk = useCallback(
    (chunk: UIMessageChunk): 'done' | 'continue' => {
      switch (chunk.type) {
        case 'start': {
          msgCounterRef.current += 1
          const msgId = chunk.messageId ?? `msg-${msgCounterRef.current}`
          // 确保唯一：即使后端多个 start chunk 带相同 messageId 也不冲突
          const uniqueId = `${msgId}-${msgCounterRef.current}`
          currentMessageRef.current = { id: uniqueId, parts: [] }
          partMapRef.current = new Map()
          setMessages((prev) => [...prev, currentMessageRef.current!])
          break
        }
        case 'start-step':
        case 'finish-step':
          // step 边界，当前不特殊处理（可后续渲染 step 分隔）
          break
        case 'text-start': {
          pushPart({ id: chunk.id, kind: 'text', text: '' })
          break
        }
        case 'text-delta': {
          const existing = partMapRef.current.get(chunk.id)
          if (existing) {
            pushPart({ ...existing, text: (existing.text ?? '') + chunk.delta })
          }
          break
        }
        case 'text-end':
          break
        case 'reasoning-start': {
          pushPart({ id: chunk.id, kind: 'reasoning', text: '' })
          break
        }
        case 'reasoning-delta': {
          const existing = partMapRef.current.get(chunk.id)
          if (existing) {
            pushPart({ ...existing, text: (existing.text ?? '') + chunk.delta })
          }
          break
        }
        case 'reasoning-end':
          break
        case 'tool-input-start': {
          pushPart({
            id: chunk.toolCallId,
            kind: 'tool',
            toolName: chunk.toolName,
            toolCallId: chunk.toolCallId,
          })
          break
        }
        case 'tool-input-delta':
          // 增量 input，暂不累积（等 tool-input-available 拿完整 input）
          break
        case 'tool-input-available': {
          const existing = partMapRef.current.get(chunk.toolCallId)
          pushPart({
            ...(existing ?? {
              id: chunk.toolCallId,
              kind: 'tool' as const,
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
            }),
            input: chunk.input,
          })
          break
        }
        case 'tool-output-available': {
          const existing = partMapRef.current.get(chunk.toolCallId)
          if (existing) {
            pushPart({ ...existing, output: chunk.output })
          }
          break
        }
        case 'tool-input-error':
        case 'tool-output-error': {
          const existing = partMapRef.current.get(chunk.toolCallId)
          if (existing) {
            pushPart({ ...existing, errorText: chunk.errorText })
          }
          break
        }
        case 'finish':
          // finish = one agent step completed. In a tournament, multiple
          // finish chunks arrive (one per agent). We don't stop reading —
          // the SSE [DONE] marker handles stream termination.
          break
        case 'abort':
        case 'error':
          // error/abort = agent-level failure. Don't stop the stream —
          // the tournament may continue with the next agent.
          break
        case 'custom': {
          // Agent-state custom chunk: update agentStates for live UI
          if (chunk.kind === CustomEventKind.AgentState) {
            const role = (chunk as Record<string, unknown>).role as AgentRole
            const agentState = (chunk as Record<string, unknown>).state as AgentState
            if (role && agentState) {
              setAgentStates((prev) => ({ ...prev, [role]: agentState }))
            }
          }
          // 自定义事件（steering-injected / round-transition 等）
          pushPart({
            id: `custom-${Date.now()}-${Math.random()}`,
            kind: 'custom',
            customKind: chunk.kind,
          })
          break
        }
        default:
          // 未处理的事件类型（source-url / file / message-metadata 等）暂忽略
          break
      }
      return 'continue'
    },
    [pushPart],
  )

  const consumeStream = useCallback(
    async (response: Response, isReconnect: boolean): Promise<void> => {
      if (!response.body) throw new Error('SSE response has no body')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // SSE 事件以 `\n\n` 分隔
          let idx = buffer.indexOf('\n\n')
          while (idx >= 0) {
            const raw = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            const line = raw.trim()
            if (!line.startsWith('data:')) {
              idx = buffer.indexOf('\n\n')
              continue
            }
            const payload = line.slice(5).trim()
            if (payload === DONE_MARKER) {
              setState('done')
              onFinish?.()
              return
            }
            try {
              const chunk = JSON.parse(payload) as UIMessageChunk
              const result = handleChunk(chunk)
              if (result === 'done') {
                setState('done')
                onFinish?.()
                return
              }
            } catch {
              // 非 JSON 行，忽略
            }
            idx = buffer.indexOf('\n\n')
          }
        }
        // 流自然结束但没收到 [DONE] / finish → 可能中断，触发重连
        if (!isReconnect && !userStoppedRef.current) {
          // 原始流中断，需要重连
          throw new Error('stream ended without finish')
        }
      } finally {
        reader.releaseLock()
      }
    },
    [handleChunk, onFinish],
  )

  const reconnect = useCallback(async (): Promise<void> => {
    const id = runIdRef.current
    if (!id || userStoppedRef.current) return
    if (reconnectErrorsRef.current >= maxConsecutiveErrors) {
      setState('error')
      setError(new Error('Max consecutive reconnect errors reached'))
      onError?.(new Error('Max consecutive reconnect errors reached'))
      return
    }

    setState('reconnecting')
    reconnectErrorsRef.current += 1
    try {
      // tail-relative：只取最后 50 chunks（见 02-architecture.md）
      const { response } = await reconnectRunStream(project, id, -50)
      reconnectErrorsRef.current = 0
      setState('streaming')
      await consumeStream(response, true)
    } catch {
      // 重连失败，延迟后重试
      setTimeout(() => void reconnect(), 1000 * reconnectErrorsRef.current)
    }
  }, [project, maxConsecutiveErrors, consumeStream, onError])

  const start = useCallback(
    async (seed: string, modelAlias?: string): Promise<void> => {
      reset()
      setState('connecting')
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const { response, runId: id } = await startRun(project, { seed, modelAlias })
        runIdRef.current = id
        setRunId(id)
        setState('streaming')
        await consumeStream(response, false)
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        if (e instanceof ApiError) {
          setState('error')
          setError(e)
          onError?.(e)
        } else if (!userStoppedRef.current) {
          // 网络中断，尝试重连
          void reconnect()
        }
      }
    },
    [project, reset, consumeStream, reconnect, onError],
  )

  const stop = useCallback(async (): Promise<void> => {
    userStoppedRef.current = true
    abortRef.current?.abort()
    const id = runIdRef.current
    if (id) {
      try {
        await stopRun(project, id)
      } catch {
        // 停止失败不阻塞 UI
      }
    }
    setState('stopped')
  }, [project])

  // 组件卸载时 abort fetch（路由卸载不调 stop，后端继续跑）
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  return { runId, messages, state, error, agentStates, start, stop, reset }
}
