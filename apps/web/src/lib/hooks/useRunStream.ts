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
  getRunStatus,
  listRuns,
  reconnectRunStream,
  startRun,
  stopRun,
} from '@/lib/api/client'
import type { RoundUpdatePayload, UIMessageChunk } from '@/lib/types/sse-events'
import { CustomEventKind } from '@/lib/types/sse-events'
import type { AgentRole, AgentState } from '@/lib/types/visualizers'
import {
  emptyScientificWorkbenchState,
  reduceScientificChunk,
  type ScientificWorkbenchState,
} from '@/lib/workbench/state'
import type { PhenomenonInput } from '@open-scientist/schema'

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

export type StreamState =
  | 'idle'
  | 'connecting'
  | 'loading'
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
  /** 静态预览（示例项目）用：注入科学状态与智能体状态的初始值。 */
  initialScientificState?: ScientificWorkbenchState
  initialAgentStates?: Partial<Record<AgentRole, AgentState>>
  /** 静态预览：跳过挂载时的历史加载（否则 loadHistory 会 reset 掉注入的初始状态）。 */
  skipHistoryLoad?: boolean
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
  /** Scientific A-B-C-D state replayed from custom SSE chunks. */
  scientificState: ScientificWorkbenchState
  /** Raw persisted/live stream events used by the auditable execution trace. */
  chunks: UIMessageChunk[]
  start: (
    seed: string | undefined,
    modelAlias?: string,
    options?: {
      phenomenon?: PhenomenonInput
      maxRounds?: number
      executionMode?: 'model-assisted' | 'local-grounded'
    },
  ) => Promise<void>
  stop: () => Promise<void>
  /** 重置（离开页面时） */
  reset: () => void
  /** 加载最近一次 run 的持久化历史 */
  loadHistory: () => Promise<void>
}

const DONE_MARKER = '[DONE]'
const MAX_RECONNECT_ERRORS = 15

function roleFromScientificAgent(agentId: unknown, stage?: unknown): AgentRole | undefined {
  const id = typeof agentId === 'string' ? agentId.toLowerCase() : ''
  if (id.includes('librarian')) return 'librarian'
  if (id.includes('looker')) return 'looker'
  if (id.includes('explore')) return 'explore'
  if (id.includes('oracle')) return 'oracle'
  if (id.includes('prometheus')) return 'prometheus'
  if (stage === 'C') return 'sisyphus'
  if (stage === 'D') return 'prometheus'
  return undefined
}

export function useRunStream(opts: UseRunStreamOptions): UseRunStreamReturn {
  const { project, maxConsecutiveErrors = MAX_RECONNECT_ERRORS, skipHistoryLoad = false } = opts
  const [runId, setRunId] = useState<string | null>(null)
  const [messages, setMessages] = useState<RunMessage[]>([])
  const [state, setState] = useState<StreamState>('idle')
  const [error, setError] = useState<Error | null>(null)
  const [agentStates, setAgentStates] = useState<Partial<Record<AgentRole, AgentState>>>(
    opts.initialAgentStates ?? {},
  )
  const [roundUpdate, setRoundUpdate] = useState<RoundUpdateState>(null)
  const [scientificState, setScientificState] = useState(
    opts.initialScientificState ?? emptyScientificWorkbenchState,
  )
  const [chunks, setChunks] = useState<UIMessageChunk[]>([])

  // Stable refs for callbacks that would otherwise break useCallback memoization
  const onFinishRef = useRef(opts.onFinish)
  const onErrorRef = useRef(opts.onError)
  onFinishRef.current = opts.onFinish
  onErrorRef.current = opts.onError

  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef<string | null>(null)
  const reconnectErrorsRef = useRef(0)
  const userStoppedRef = useRef(false)
  const partMapRef = useRef<Map<string, MessagePart>>(new Map())
  const currentMessageRef = useRef<RunMessage | null>(null)
  const msgCounterRef = useRef(0)
  const currentAgentRef = useRef<string | null>(null)
  const currentRoundRef = useRef<number | null>(null)
  const currentHypoIdRef = useRef<string | null>(null)
  const nextChunkIndexRef = useRef(0)
  const historyGenerationRef = useRef(0)

  // Batch mode: when replaying history, accumulate messages locally to avoid
  // O(n²) array growth from repeated setMessages calls.
  const batchModeRef = useRef(false)
  const batchMessagesRef = useRef<RunMessage[]>([])
  const batchChunksRef = useRef<UIMessageChunk[]>([])
  const batchScientificStateRef = useRef<ScientificWorkbenchState>(emptyScientificWorkbenchState())
  const batchAgentStatesRef = useRef<Partial<Record<AgentRole, AgentState>>>({})
  const batchRoundUpdateRef = useRef<RoundUpdateState>(null)

  const reset = useCallback(() => {
    historyGenerationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    runIdRef.current = null
    reconnectErrorsRef.current = 0
    userStoppedRef.current = false
    partMapRef.current = new Map()
    currentMessageRef.current = null
    msgCounterRef.current = 0
    currentAgentRef.current = null
    currentRoundRef.current = null
    currentHypoIdRef.current = null
    nextChunkIndexRef.current = 0
    batchModeRef.current = false
    batchMessagesRef.current = []
    batchChunksRef.current = []
    batchScientificStateRef.current = emptyScientificWorkbenchState()
    batchAgentStatesRef.current = {}
    batchRoundUpdateRef.current = null
    setRunId(null)
    setMessages([])
    setState('idle')
    setError(null)
    setAgentStates({})
    setRoundUpdate(null)
    setScientificState(emptyScientificWorkbenchState())
    setChunks([])
  }, [])

  const pushPart = useCallback((part: MessagePart) => {
    partMapRef.current.set(part.id, part)
    if (currentMessageRef.current) {
      // 重建 parts 数组触发 React 更新
      currentMessageRef.current = {
        ...currentMessageRef.current,
        parts: Array.from(partMapRef.current.values()),
      }
      if (batchModeRef.current) {
        // In batch mode, update the last message in the local array
        const arr = batchMessagesRef.current
        arr[arr.length - 1] = currentMessageRef.current
      } else {
        setMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = currentMessageRef.current!
          return next
        })
      }
    }
  }, [])

  const recordChunk = useCallback((chunk: UIMessageChunk) => {
    nextChunkIndexRef.current += 1
    if (batchModeRef.current) {
      batchChunksRef.current.push(chunk)
      return
    }
    setChunks((previous) => [...previous, chunk])
  }, [])

  const appendStandaloneMessage = useCallback((message: RunMessage) => {
    if (batchModeRef.current) {
      batchMessagesRef.current.push(message)
      return
    }
    setMessages((previous) => [...previous, message])
  }, [])

  const handleChunk = useCallback(
    (chunk: UIMessageChunk): 'done' | 'continue' => {
      recordChunk(chunk)
      switch (chunk.type) {
        case 'start': {
          msgCounterRef.current += 1
          const msgId = chunk.messageId ?? `msg-${msgCounterRef.current}`
          // 确保唯一：即使后端多个 start chunk 带相同 messageId 也不冲突
          const uniqueId = `${msgId}-${msgCounterRef.current}`
          currentMessageRef.current = {
            id: uniqueId,
            parts: [],
            ...(currentAgentRef.current ? { agentRole: currentAgentRef.current } : {}),
            ...(currentRoundRef.current != null ? { round: currentRoundRef.current } : {}),
            ...(currentHypoIdRef.current ? { hypoId: currentHypoIdRef.current } : {}),
          }
          partMapRef.current = new Map()
          if (batchModeRef.current) {
            batchMessagesRef.current.push(currentMessageRef.current)
          } else {
            setMessages((prev) => [...prev, currentMessageRef.current!])
          }
          break
        }
        case 'start-step':
        case 'finish-step':
          // step 边界，当前不特殊处理
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
          if (batchModeRef.current) {
            batchScientificStateRef.current = reduceScientificChunk(
              batchScientificStateRef.current,
              chunk,
            )
          } else {
            setScientificState((prev) => reduceScientificChunk(prev, chunk))
          }
          const customPayload = chunk as Record<string, unknown>
          // Agent-state custom chunk: update agentStates for live UI
          if (chunk.kind === CustomEventKind.AgentState) {
            const role = (chunk as Record<string, unknown>).role as AgentRole
            const agentState = (chunk as Record<string, unknown>).state as AgentState
            if (role && agentState) {
              if (batchModeRef.current) {
                batchAgentStatesRef.current = { ...batchAgentStatesRef.current, [role]: agentState }
              } else {
                setAgentStates((prev) => ({ ...prev, [role]: agentState }))
              }
              // Track current agent — when an agent enters 'thinking', it becomes
              // the active agent for subsequent messages.
              if (agentState === 'thinking') {
                currentAgentRef.current = role
              }
            }
          }
          if (chunk.kind === CustomEventKind.ScientificAgentState) {
            const role = roleFromScientificAgent(customPayload.agentId, customPayload.stage)
            const scientificState = customPayload.state
            const mappedState: AgentState =
              scientificState === 'running'
                ? 'thinking'
                : scientificState === 'failed'
                  ? 'error'
                  : 'idle'
            if (role) {
              if (batchModeRef.current) {
                batchAgentStatesRef.current = {
                  ...batchAgentStatesRef.current,
                  [role]: mappedState,
                }
              } else {
                setAgentStates((previous) => ({ ...previous, [role]: mappedState }))
              }
              if (scientificState === 'running') currentAgentRef.current = role
            }
          }
          // Round-update custom chunk: accumulate hypotheses + convergence for visualizers
          if (chunk.kind === CustomEventKind.RoundUpdate) {
            if (batchModeRef.current) {
              batchRoundUpdateRef.current = chunk as unknown as RoundUpdatePayload
            } else {
              setRoundUpdate(chunk as unknown as RoundUpdatePayload)
            }
          }
          // Phase-start custom chunk: track current round + hypoId for message tagging
          if (chunk.kind === CustomEventKind.PhaseStart) {
            const payload = customPayload
            const round = payload.round as number | undefined
            const hypoId = payload.hypoId as string | null | undefined
            if (round != null) {
              currentRoundRef.current = round
            }
            currentHypoIdRef.current = hypoId ?? null
          }
          if (chunk.kind === CustomEventKind.ScientificReasoningSummary) {
            const summary =
              typeof customPayload.summary === 'string' ? customPayload.summary.trim() : ''
            if (summary) {
              const title =
                typeof customPayload.title === 'string' && customPayload.title.trim()
                  ? customPayload.title.trim()
                  : '本阶段工作依据'
              const role = roleFromScientificAgent(customPayload.agentId, customPayload.stage)
              const round =
                typeof customPayload.round === 'number'
                  ? customPayload.round
                  : (currentRoundRef.current ?? undefined)
              const hypoId =
                typeof customPayload.hypothesisId === 'string'
                  ? customPayload.hypothesisId
                  : typeof customPayload.hypoId === 'string'
                    ? customPayload.hypoId
                    : undefined
              msgCounterRef.current += 1
              appendStandaloneMessage({
                id: `model-summary-${msgCounterRef.current}`,
                parts: [
                  {
                    id: `model-summary-part-${msgCounterRef.current}`,
                    kind: 'reasoning',
                    text: `### ${title}\n\n${summary}`,
                  },
                ],
                ...(role ? { agentRole: role } : {}),
                ...(round != null ? { round } : {}),
                ...(hypoId ? { hypoId } : {}),
              })
            }
          }
          break
        }
        default:
          // 未处理的事件类型（source-url / file / message-metadata 等）暂忽略
          break
      }
      return 'continue'
    },
    [appendStandaloneMessage, pushPart, recordChunk],
  )

  const consumeStream = useCallback(
    async (response: Response, generation: number): Promise<void> => {
      if (!response.body) throw new Error('SSE response has no body')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          // 新会话已开始（reset/start 使 generation 递增）→ 丢弃过期流
          if (generation !== historyGenerationRef.current) return
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
              if (generation !== historyGenerationRef.current) return
              setState('done')
              onFinishRef.current?.()
              return
            }
            try {
              const chunk = JSON.parse(payload) as UIMessageChunk
              const result = handleChunk(chunk)
              if (result === 'done') {
                if (generation !== historyGenerationRef.current) return
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
        // Any stream that ends without [DONE] is incomplete.  Reconnect from
        // the absolute client cursor instead of silently freezing a restored
        // running page.
        if (generation !== historyGenerationRef.current) return
        if (!userStoppedRef.current) {
          throw new Error('stream ended without finish')
        }
      } finally {
        reader.releaseLock()
      }
    },
    [handleChunk],
  )

  const reconnect = useCallback(
    async (expectedGeneration?: number): Promise<void> => {
      // 由过期退避定时器触发的重连：期间已 reset/start 新会话则直接放弃
      if (expectedGeneration != null && expectedGeneration !== historyGenerationRef.current) return
      const generation = historyGenerationRef.current
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
      let controller = abortRef.current
      if (!controller || controller.signal.aborted) {
        controller = new AbortController()
        abortRef.current = controller
      }
      try {
        const { response } = await reconnectRunStream(
          project,
          id,
          nextChunkIndexRef.current,
          fetch,
          controller.signal,
        )
        // 过期重连：期间已 reset/start 新会话
        if (generation !== historyGenerationRef.current) return
        reconnectErrorsRef.current = 0
        setState('streaming')
        await consumeStream(response, generation)
      } catch (reconnectError) {
        if (generation !== historyGenerationRef.current) return
        if (userStoppedRef.current || controller.signal.aborted) return
        // A run may finish while the transport is reconnecting.  Hydrate any
        // persisted tail once, then stop reconnecting when storage is terminal.
        try {
          const status = await getRunStatus(project, id)
          if (generation !== historyGenerationRef.current) return
          if (
            status.status === 'completed' ||
            status.status === 'failed' ||
            status.status === 'stopped'
          ) {
            const entries = await getRunChunks(project, id)
            if (generation !== historyGenerationRef.current) return
            const cursor = nextChunkIndexRef.current
            for (const entry of entries) {
              if (entry.seq >= cursor) handleChunk(entry.chunk as UIMessageChunk)
            }
            if (entries.length > 0) {
              nextChunkIndexRef.current = Math.max(
                nextChunkIndexRef.current,
                entries[entries.length - 1]!.seq + 1,
              )
            }
            setState(
              status.status === 'completed'
                ? 'done'
                : status.status === 'stopped'
                  ? 'stopped'
                  : 'error',
            )
            if (status.status === 'completed') onFinishRef.current?.()
            return
          }
        } catch {
          // Status may be temporarily unavailable; use the normal backoff.
        }
        // 重连失败，指数退避后重试（1s, 2s, 4s, 8s, 16s...）
        const delay = Math.min(1000 * 2 ** (reconnectErrorsRef.current - 1), 30000)
        setTimeout(() => void reconnect(generation), delay)
      }
    },
    [project, maxConsecutiveErrors, consumeStream, handleChunk],
  )

  const loadHistory = useCallback(async (): Promise<void> => {
    reset()
    const generation = historyGenerationRef.current
    setState('loading')
    try {
      const runs = await listRuns(project)
      if (generation !== historyGenerationRef.current) return
      if (runs.length === 0) {
        setState('idle')
        return
      }
      const latest = runs[0]!
      const entries = await getRunChunks(project, latest.runId)
      if (generation !== historyGenerationRef.current) return
      runIdRef.current = latest.runId
      setRunId(latest.runId)
      // Batch mode: accumulate messages in a local array to avoid O(n²)
      // array growth from repeated setMessages calls during replay.
      batchModeRef.current = true
      batchMessagesRef.current = []
      batchChunksRef.current = []
      batchScientificStateRef.current = emptyScientificWorkbenchState()
      batchAgentStatesRef.current = {}
      batchRoundUpdateRef.current = null
      for (const entry of entries) {
        handleChunk(entry.chunk as UIMessageChunk)
      }
      batchModeRef.current = false
      nextChunkIndexRef.current = entries.length > 0 ? entries[entries.length - 1]!.seq + 1 : 0
      setMessages(batchMessagesRef.current)
      setChunks(batchChunksRef.current)
      setScientificState(batchScientificStateRef.current)
      setAgentStates(batchAgentStatesRef.current)
      setRoundUpdate(batchRoundUpdateRef.current)
      if (latest.status === 'running' || latest.status === 'awaiting_approval') {
        void reconnect()
      } else if (latest.status === 'stopped') setState('stopped')
      else if (latest.status === 'failed') setState('error')
      else setState('done')
    } catch (historyError) {
      if (generation !== historyGenerationRef.current) return
      batchModeRef.current = false
      const nextError =
        historyError instanceof Error ? historyError : new Error(String(historyError))
      console.warn('[workflow] unable to load persisted run', nextError)
      setError(nextError)
      setState('error')
      onErrorRef.current?.(nextError)
    }
  }, [project, handleChunk, reconnect, reset])

  const start = useCallback(
    async (
      seed: string | undefined,
      modelAlias?: string,
      options?: {
        phenomenon?: PhenomenonInput
        maxRounds?: number
        executionMode?: 'model-assisted' | 'local-grounded'
      },
    ): Promise<void> => {
      reset()
      const generation = historyGenerationRef.current
      setState('connecting')
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const { response, runId: id } = await startRun(
          project,
          {
            ...(seed ? { seed } : {}),
            modelAlias,
            ...(options?.phenomenon ? { phenomenon: options.phenomenon } : {}),
            ...(options?.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
            ...(options?.executionMode ? { executionMode: options.executionMode } : {}),
          },
          fetch,
          controller.signal,
        )
        if (generation !== historyGenerationRef.current) return
        runIdRef.current = id
        setRunId(id)
        setState('streaming')
        await consumeStream(response, generation)
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        if (generation !== historyGenerationRef.current) return
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
      } catch (stopError) {
        const nextError = stopError instanceof Error ? stopError : new Error(String(stopError))
        userStoppedRef.current = false
        setError(nextError)
        setState('error')
        onErrorRef.current?.(nextError)
        void reconnect()
        return
      }
    }
    setState('stopped')
  }, [project, reconnect])

  // Load persisted history on mount, then abort on unmount
  useEffect(() => {
    if (skipHistoryLoad) return
    void loadHistory()
    return () => {
      historyGenerationRef.current += 1
      abortRef.current?.abort()
    }
  }, [loadHistory, skipHistoryLoad])

  return {
    runId,
    messages,
    chunks,
    state,
    error,
    agentStates,
    roundUpdate,
    scientificState,
    start,
    stop,
    reset,
    loadHistory,
  }
}
