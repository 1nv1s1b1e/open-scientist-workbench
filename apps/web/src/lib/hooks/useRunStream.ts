/**
 * 订阅 run SSE 流。
 *
 * 核心逻辑（见 docs/web/02-architecture.md §Transport 流 + 05-api-contracts.md §8）：
 * 1. startRun POST → 拿 x-workflow-run-id + SSE body
 * 2. 逐行解析 `data: <JSON>\n\n`，累积成 messages
 * 3. 流中断（未 finish）→ 自动 reconnectRunStream GET 续传
 * 4. 用户停止 → stopRun POST，不自动重连
 *
 * 不依赖 assistant-ui runtime。
 */

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  getRunChunks,
  listRuns,
  reconnectRunStream,
  startRun,
  stopRun,
} from '@/lib/api/client'
import type { RoundUpdatePayload, UIMessageChunk } from '@/lib/types/sse-events'
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
  /** Which agent produced this message (tracked from agent-state chunks). */
  agentRole?: string
  /** Tournament round when this message was produced (tracked from phase-start chunks). */
  round?: number
  /** Hypothesis ID this message is associated with (Explore runs per-hypothesis). */
  hypoId?: string
}

/**
 * Per-stream bookkeeping. The tournament runs Explore hypotheses in parallel
 * via `Promise.all`, so multiple agent streams' chunks interleave in the SSE
 * feed. Each tagged Explore chunk carries `_exploreHypoId`; we key the
 * message context by that id so parallel runs don't clobber each other.
 *
 * For non-Explore streams (Librarian/Oracle/Prometheus) there is no
 * `_exploreHypoId`, so the key falls back to `'__main__'` (single context).
 */
interface StreamContext {
  message: RunMessage | null
  partMap: Map<string, MessagePart>
}

const MAIN_STREAM_KEY = '__main__'

export type StreamState =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'reconnecting'
  | 'done'
  | 'error'
  | 'stopped'

/** Latest round-update payload (null until first tournament.round-update chunk arrives) */
export type RoundUpdateState = RoundUpdatePayload | null

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
  /** Latest round-update from the tournament (hypotheses + convergence history) */
  roundUpdate: RoundUpdateState
  start: (seed: string, modelAlias?: string) => Promise<void>
  stop: () => Promise<void>
  /** 重置（离开页面时） */
  reset: () => void
  /** 加载最近一次 run 的持久化历史 */
  loadHistory: () => Promise<void>
}

const DONE_MARKER = '[DONE]'
const MAX_RECONNECT_ERRORS = 15

export function useRunStream(opts: UseRunStreamOptions): UseRunStreamReturn {
  const { project, maxConsecutiveErrors = MAX_RECONNECT_ERRORS } = opts
  const [runId, setRunId] = useState<string | null>(null)
  const [messages, setMessages] = useState<RunMessage[]>([])
  const [state, setState] = useState<StreamState>('idle')
  const [error, setError] = useState<Error | null>(null)
  const [agentStates, setAgentStates] = useState<Partial<Record<AgentRole, AgentState>>>({})
  const [roundUpdate, setRoundUpdate] = useState<RoundUpdateState>(null)

  // Stable refs for callbacks that would otherwise break useCallback memoization
  const onFinishRef = useRef(opts.onFinish)
  const onErrorRef = useRef(opts.onError)
  onFinishRef.current = opts.onFinish
  onErrorRef.current = opts.onError

  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef<string | null>(null)
  const reconnectErrorsRef = useRef(0)
  const userStoppedRef = useRef(false)
  /** Per-stream message contexts keyed by `_exploreHypoId` (or `'__main__'`). */
  const contextsRef = useRef<Map<string, StreamContext>>(new Map())
  const msgCounterRef = useRef(0)
  const currentAgentRef = useRef<string | null>(null)
  const currentRoundRef = useRef<number | null>(null)
  const currentHypoIdRef = useRef<string | null>(null)

  // Batch mode: when replaying history, accumulate messages locally to avoid
  // O(n²) array growth from repeated setMessages calls.
  const batchModeRef = useRef(false)
  const batchMessagesRef = useRef<RunMessage[]>([])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    runIdRef.current = null
    reconnectErrorsRef.current = 0
    userStoppedRef.current = false
    contextsRef.current = new Map()
    msgCounterRef.current = 0
    currentAgentRef.current = null
    currentRoundRef.current = null
    currentHypoIdRef.current = null
    setRunId(null)
    setMessages([])
    setState('idle')
    setError(null)
    setAgentStates({})
    setRoundUpdate(null)
  }, [])

  /**
   * Push a part into the StreamContext identified by `ctxKey`.
   * `ctxKey` must match the key used for the originating chunk.
   */
  const pushPart = useCallback((part: MessagePart, ctxKey: string = MAIN_STREAM_KEY) => {
    const ctx = contextsRef.current.get(ctxKey) ?? contextsRef.current.get(MAIN_STREAM_KEY)
    if (!ctx) return
    ctx.partMap.set(part.id, part)
    if (ctx.message) {
      ctx.message = {
        ...ctx.message,
        parts: Array.from(ctx.partMap.values()),
      }
      if (batchModeRef.current) {
        const arr = batchMessagesRef.current
        const idx = arr.findIndex((m) => m.id === ctx.message!.id)
        if (idx >= 0) arr[idx] = ctx.message
      } else {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === ctx.message!.id)
          if (idx < 0) return prev
          const next = [...prev]
          next[idx] = ctx.message!
          return next
        })
      }
    }
  }, [])

  const handleChunk = useCallback(
    (chunk: UIMessageChunk): 'done' | 'continue' => {
      // Custom chunks (agent-state / phase-start / round-update) carry no
      // _exploreHypoId tag and drive global refs — handle them before the
      // per-stream context dispatch.
      if (chunk.type === 'custom') {
        // Agent-state custom chunk: update agentStates for live UI
        if (chunk.kind === CustomEventKind.AgentState) {
          const role = (chunk as Record<string, unknown>).role as AgentRole
          const agentState = (chunk as Record<string, unknown>).state as AgentState
          if (role && agentState) {
            setAgentStates((prev) => ({ ...prev, [role]: agentState }))
            // Track current agent — when an agent enters 'thinking', it becomes
            // the active agent for subsequent messages.
            if (agentState === 'thinking') {
              currentAgentRef.current = role
            }
          }
        }
        // Round-update custom chunk: accumulate hypotheses + convergence for visualizers
        if (chunk.kind === CustomEventKind.RoundUpdate) {
          setRoundUpdate(chunk as unknown as RoundUpdatePayload)
        }
        // Phase-start custom chunk: track current round + hypoId for message tagging
        if (chunk.kind === CustomEventKind.PhaseStart) {
          const payload = chunk as Record<string, unknown>
          const round = payload.round as number | undefined
          const hypoId = payload.hypoId as string | null | undefined
          if (round != null) {
            currentRoundRef.current = round
          }
          currentHypoIdRef.current = hypoId ?? null
        }
        // Custom events are NOT pushed as message parts (they'd render as
        // empty cards). They are state-only. (Previously pushPart was called
        // here, but to-thread-messages.ts filtered custom parts out anyway.)
        return 'continue'
      }

      // Resolve the per-stream context for this chunk. Explore chunks carry
      // `_exploreHypoId` (injected by exploreWorkflow); all other streams
      // share the `'__main__'` context.
      const ctxKey =
        ((chunk as Record<string, unknown>)._exploreHypoId as string | undefined) ?? MAIN_STREAM_KEY
      let ctx = contextsRef.current.get(ctxKey)
      if (!ctx) {
        ctx = { message: null, partMap: new Map() }
        contextsRef.current.set(ctxKey, ctx)
      }

      switch (chunk.type) {
        case 'start': {
          msgCounterRef.current += 1
          const msgId = chunk.messageId ?? `msg-${msgCounterRef.current}`
          // 确保唯一：即使后端多个 start chunk 带相同 messageId 也不冲突
          const uniqueId = `${msgId}-${msgCounterRef.current}`
          // For tagged Explore chunks, use the tag as hypoId (not the global
          // currentHypoIdRef, which may have been overwritten by a parallel
          // Explore's phase-start).
          const exploreHypoId = (chunk as Record<string, unknown>)._exploreHypoId as
            | string
            | undefined
          ctx.message = {
            id: uniqueId,
            parts: [],
            ...(currentAgentRef.current ? { agentRole: currentAgentRef.current } : {}),
            ...(currentRoundRef.current != null ? { round: currentRoundRef.current } : {}),
            ...(exploreHypoId
              ? { hypoId: exploreHypoId }
              : currentHypoIdRef.current
                ? { hypoId: currentHypoIdRef.current }
                : {}),
          }
          ctx.partMap = new Map()
          if (batchModeRef.current) {
            batchMessagesRef.current.push(ctx.message)
          } else {
            setMessages((prev) => [...prev, ctx!.message!])
          }
          break
        }
        case 'start-step':
        case 'finish-step':
          // step 边界，当前不特殊处理
          break
        case 'text-start': {
          ctx.partMap.set(chunk.id, { id: chunk.id, kind: 'text', text: '' })
          pushPart(ctx.partMap.get(chunk.id)!, ctxKey)
          break
        }
        case 'text-delta': {
          const existing = ctx.partMap.get(chunk.id)
          if (existing) {
            existing.text = (existing.text ?? '') + chunk.delta
            pushPart(existing, ctxKey)
          }
          break
        }
        case 'text-end':
          break
        case 'reasoning-start': {
          ctx.partMap.set(chunk.id, { id: chunk.id, kind: 'reasoning', text: '' })
          pushPart(ctx.partMap.get(chunk.id)!, ctxKey)
          break
        }
        case 'reasoning-delta': {
          const existing = ctx.partMap.get(chunk.id)
          if (existing) {
            existing.text = (existing.text ?? '') + chunk.delta
            pushPart(existing, ctxKey)
          }
          break
        }
        case 'reasoning-end':
          break
        case 'tool-input-start': {
          ctx.partMap.set(chunk.toolCallId, {
            id: chunk.toolCallId,
            kind: 'tool',
            toolName: chunk.toolName,
            toolCallId: chunk.toolCallId,
          })
          pushPart(ctx.partMap.get(chunk.toolCallId)!, ctxKey)
          break
        }
        case 'tool-input-delta':
          // 增量 input，暂不累积（等 tool-input-available 拿完整 input）
          break
        case 'tool-input-available': {
          const existing = ctx.partMap.get(chunk.toolCallId) ?? {
            id: chunk.toolCallId,
            kind: 'tool' as const,
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
          }
          existing.input = chunk.input
          pushPart(existing, ctxKey)
          break
        }
        case 'tool-output-available': {
          const existing = ctx.partMap.get(chunk.toolCallId)
          if (existing) {
            existing.output = chunk.output
            pushPart(existing, ctxKey)
          }
          break
        }
        case 'tool-input-error':
        case 'tool-output-error': {
          const existing = ctx.partMap.get(chunk.toolCallId)
          if (existing) {
            existing.errorText = chunk.errorText
            pushPart(existing, ctxKey)
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
              onFinishRef.current?.()
              return
            }
            try {
              const chunk = JSON.parse(payload) as UIMessageChunk
              const result = handleChunk(chunk)
              if (result === 'done') {
                setState('done')
                onFinishRef.current?.()
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
    [handleChunk],
  )

  const reconnect = useCallback(async (): Promise<void> => {
    const id = runIdRef.current
    if (!id || userStoppedRef.current) return
    if (reconnectErrorsRef.current >= maxConsecutiveErrors) {
      setState('error')
      setError(new Error('Max consecutive reconnect errors reached'))
      onErrorRef.current?.(new Error('Max consecutive reconnect errors reached'))
      return
    }

    setState('reconnecting')
    reconnectErrorsRef.current += 1
    try {
      // Replay all chunks from the beginning (persisted chunks may have been lost on refresh)
      const { response } = await reconnectRunStream(project, id, 0)
      reconnectErrorsRef.current = 0
      setState('streaming')
      await consumeStream(response, true)
    } catch {
      // 重连失败，指数退避后重试（1s, 2s, 4s, 8s, 16s...）
      const delay = Math.min(1000 * 2 ** (reconnectErrorsRef.current - 1), 30000)
      setTimeout(() => void reconnect(), delay)
    }
  }, [project, maxConsecutiveErrors, consumeStream])

  const loadHistory = useCallback(async (): Promise<void> => {
    try {
      const runs = await listRuns(project)
      if (runs.length === 0) return
      const latest = runs[0]!
      const entries = await getRunChunks(project, latest.runId)
      runIdRef.current = latest.runId
      setRunId(latest.runId)
      // Batch mode: accumulate messages in a local array to avoid O(n²)
      // array growth from repeated setMessages calls during replay.
      batchModeRef.current = true
      batchMessagesRef.current = []
      for (const entry of entries) {
        handleChunk(entry.chunk as UIMessageChunk)
      }
      batchModeRef.current = false
      setMessages(batchMessagesRef.current)
      if (latest.status === 'running' || latest.status === 'awaiting_approval') {
        setState('streaming')
        const startIndex = entries.length
        void reconnectRunStream(project, latest.runId, startIndex)
          .then(({ response }) => void consumeStream(response, true))
          .catch(() => {})
      } else {
        setState('done')
      }
    } catch {
      // First visit — no runs yet
    }
  }, [project, handleChunk, consumeStream])

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
          onErrorRef.current?.(e)
        } else if (!userStoppedRef.current) {
          // 网络中断，尝试重连
          void reconnect()
        }
      }
    },
    [project, reset, consumeStream, reconnect],
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

  // Load persisted history on mount, then abort on unmount
  useEffect(() => {
    void loadHistory()
    return () => {
      abortRef.current?.abort()
    }
  }, [loadHistory])

  return {
    runId,
    messages,
    state,
    error,
    agentStates,
    roundUpdate,
    start,
    stop,
    reset,
    loadHistory,
  }
}
