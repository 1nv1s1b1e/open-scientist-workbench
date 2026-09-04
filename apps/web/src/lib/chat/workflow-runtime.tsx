/**
 * WorkflowRuntimeProvider — 把 useRunStream 桥接到 assistant-ui ExternalStoreRuntime。
 *
 * 架构：
 *   useRunStream (SSE 消费) → toThreadMessages → useExternalStoreRuntime → AssistantRuntimeProvider
 *
 * 单轮 workflow：
 *   - onNew: 用户提交说明；科学模式实际发送 phenomenon
 *   - onCancel: 用户停止 → stop()
 *   - isSendDisabled: 已启动且不在运行 → 禁止再发
 *   - 不提供 onEdit/onReload → 编辑/重生成按钮不渲染
 */

'use client'

import {
  type AppendMessage,
  AssistantRuntimeProvider,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from '@assistant-ui/react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useRunStream } from '@/lib/hooks/useRunStream'
import type { RoundUpdateState, RunMessage } from '@/lib/hooks/useRunStream'
import type { UIMessageChunk } from '@/lib/types/sse-events'
import type { AgentRole, AgentState } from '@/lib/types/visualizers'
import type { PhenomenonInput } from '@open-scientist/schema'
import type { ScientificWorkbenchState } from '@/lib/workbench/state'
import { toThreadMessages } from './to-thread-messages'

interface WorkflowRuntimeProviderProps {
  project: string
  modelAlias?: string
  phenomenon?: PhenomenonInput
  maxRounds?: number
  executionMode?: ExecutionMode
  selectedAgent?: string | null
  selectedRound?: number | null
  selectedHypoId?: string | null
  onRunIdChange?: (runId: string | null) => void
  onStateChange?: (state: string) => void
  onAgentStatesChange?: (states: Partial<Record<AgentRole, AgentState>>) => void
  onRoundUpdateChange?: (update: RoundUpdateState) => void
  onMessagesChange?: (messages: RunMessage[]) => void
  onChunksChange?: (chunks: UIMessageChunk[]) => void
  onScientificStateChange?: (state: ScientificWorkbenchState) => void
  /** 静态预览（示例项目）用：注入初始科学状态与智能体状态。 */
  initialScientificState?: ScientificWorkbenchState
  initialAgentStates?: Partial<Record<AgentRole, AgentState>>
  /** 静态预览：跳过挂载时的历史加载，保留注入的初始状态。 */
  skipHistoryLoad?: boolean
  children: ReactNode
}

export interface WorkflowControls {
  submit: (text?: string, phenomenonOverride?: PhenomenonInput) => Promise<void>
  stop: () => Promise<void>
  reset: () => void
  isRunning: boolean
  hasStarted: boolean
}

export type ExecutionMode = 'model-assisted' | 'local-grounded'

const WorkflowControlsContext = createContext<WorkflowControls | null>(null)

export function WorkflowRuntimeProvider({
  project,
  modelAlias,
  phenomenon,
  maxRounds,
  executionMode = 'model-assisted',
  selectedAgent,
  selectedRound,
  selectedHypoId,
  onRunIdChange,
  onStateChange,
  onAgentStatesChange,
  onRoundUpdateChange,
  onMessagesChange,
  onChunksChange,
  onScientificStateChange,
  initialScientificState,
  initialAgentStates,
  skipHistoryLoad,
  children,
}: WorkflowRuntimeProviderProps) {
  const [submittedText, setSubmittedText] = useState<string | null>(null)
  const {
    messages,
    chunks,
    state,
    runId,
    agentStates,
    roundUpdate,
    scientificState,
    start,
    stop,
    reset,
  } = useRunStream({
    project,
    initialScientificState,
    initialAgentStates,
    skipHistoryLoad,
    onError: (e) => console.error('[workflow] run error', e),
  })

  // 通知父组件 runId 变化
  const notifyRunId = useCallback((id: string | null) => onRunIdChange?.(id), [onRunIdChange])
  useEffect(() => {
    notifyRunId(runId)
  }, [runId, notifyRunId])

  // 通知父组件 state 变化
  const notifyState = useCallback((s: string) => onStateChange?.(s), [onStateChange])
  useEffect(() => {
    notifyState(state)
  }, [state, notifyState])

  // 通知父组件 agentStates 变化
  const notifyAgentStates = useCallback(
    (s: Partial<Record<AgentRole, AgentState>>) => onAgentStatesChange?.(s),
    [onAgentStatesChange],
  )
  useEffect(() => {
    notifyAgentStates(agentStates)
  }, [agentStates, notifyAgentStates])

  // 通知父组件 roundUpdate 变化（hypotheses + convergence for visualizers）
  const notifyRoundUpdate = useCallback(
    (u: RoundUpdateState) => onRoundUpdateChange?.(u),
    [onRoundUpdateChange],
  )
  useEffect(() => {
    notifyRoundUpdate(roundUpdate)
  }, [roundUpdate, notifyRoundUpdate])

  // 通知父组件 messages 变化（for debate theater speech bubbles）
  const notifyMessages = useCallback((m: RunMessage[]) => onMessagesChange?.(m), [onMessagesChange])
  useEffect(() => {
    notifyMessages(messages)
  }, [messages, notifyMessages])

  useEffect(() => {
    onChunksChange?.(chunks)
  }, [chunks, onChunksChange])

  const notifyScientificState = useCallback(
    (s: ScientificWorkbenchState) => onScientificStateChange?.(s),
    [onScientificStateChange],
  )
  useEffect(() => {
    notifyScientificState(scientificState)
  }, [scientificState, notifyScientificState])

  // 用户说明优先取本次会话输入；刷新/重连后，从 persisted scientific.phenomenon chunk 恢复
  const userInputText =
    submittedText ??
    (scientificState?.phenomenon?.description?.trim() ||
      scientificState?.phenomenon?.title?.trim() ||
      null)

  // RunMessage[] + 用户说明 → ThreadMessageLike[] (filtered by selectedAgent / selectedRound / selectedHypoId)
  const threadMessages = useMemo(
    () =>
      toThreadMessages(
        userInputText,
        messages,
        state,
        selectedAgent,
        selectedRound,
        selectedHypoId,
      ),
    [userInputText, messages, state, selectedAgent, selectedRound, selectedHypoId],
  )

  const isRunning = state === 'connecting' || state === 'streaming' || state === 'reconnecting'
  const hasStarted = submittedText !== null || runId !== null || messages.length > 0

  // 统一提交入口：主工作台和 assistant-ui 都经过同一条运行链路。
  const submit = useCallback(
    async (inputText?: string, phenomenonOverride?: PhenomenonInput) => {
      const resolved = phenomenonOverride ?? phenomenon
      const text = inputText?.trim() || resolved?.description?.trim() || ''
      if (!text && !resolved) throw new Error('请输入活动区现象')
      setSubmittedText(text || resolved?.title || '活动区现象分析')
      await start(resolved ? undefined : text, modelAlias, {
        phenomenon: resolved,
        maxRounds,
        executionMode,
      })
    },
    [start, modelAlias, phenomenon, maxRounds, executionMode],
  )

  // assistant-ui 的消息提交也复用统一入口。
  const onNew = useCallback(
    async (message: AppendMessage) => {
      const textPart = message.content.find((p) => p.type === 'text')
      if (!textPart?.type || textPart.type !== 'text')
        throw new Error('Only text messages are supported')
      await submit(textPart.text)
    },
    [submit],
  )

  // onCancel: 停止 workflow run
  const onCancel = useCallback(async () => {
    await stop()
  }, [stop])

  // reset: 重置整个会话（外部按钮调用）
  const handleReset = useCallback(() => {
    setSubmittedText(null)
    reset()
  }, [reset])

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: threadMessages,
    isRunning,
    isSendDisabled: hasStarted && !isRunning,
    onNew,
    onCancel,
    // ThreadMessageLike 不 extends ThreadMessage，需提供 convertMessage
    convertMessage: (msg: ThreadMessageLike) => msg,
  })

  const controls: WorkflowControls = { submit, stop, reset: handleReset, isRunning, hasStarted }

  return (
    <WorkflowControlsContext.Provider value={controls}>
      <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
    </WorkflowControlsContext.Provider>
  )
}

export function useWorkflowControls(): WorkflowControls | null {
  return useContext(WorkflowControlsContext)
}

/** 保留旧 hook，供已有控制台组件使用。 */
export function useWorkflowReset(): (() => void) | null {
  return useContext(WorkflowControlsContext)?.reset ?? null
}
