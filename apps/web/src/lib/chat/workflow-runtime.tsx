/**
 * WorkflowRuntimeProvider — 把 useRunStream 桥接到 assistant-ui ExternalStoreRuntime。
 *
 * 架构：
 *   useRunStream (SSE 消费) → toThreadMessages → useExternalStoreRuntime → AssistantRuntimeProvider
 *
 * 单轮 workflow：
 *   - onNew: 用户提交 seed → start(seed)
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
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useRunStream } from '@/lib/hooks/useRunStream'
import type { RoundUpdateState } from '@/lib/hooks/useRunStream'
import type { RunMessage } from '@/lib/hooks/useRunStream'
import type { AgentRole, AgentState } from '@/lib/types/visualizers'
import { toThreadMessages } from './to-thread-messages'

interface WorkflowRuntimeProviderProps {
  project: string
  modelAlias?: string
  selectedAgent?: string | null
  selectedRound?: number | null
  selectedHypoId?: string | null
  onRunIdChange?: (runId: string | null) => void
  onStateChange?: (state: string) => void
  onAgentStatesChange?: (states: Partial<Record<AgentRole, AgentState>>) => void
  onRoundUpdateChange?: (update: RoundUpdateState) => void
  onMessagesChange?: (messages: RunMessage[]) => void
  children: ReactNode
}

export function WorkflowRuntimeProvider({
  project,
  modelAlias,
  selectedAgent,
  selectedRound,
  selectedHypoId,
  onRunIdChange,
  onStateChange,
  onAgentStatesChange,
  onRoundUpdateChange,
  onMessagesChange,
  children,
}: WorkflowRuntimeProviderProps) {
  const [seed, setSeed] = useState<string | null>(null)
  const { messages, state, runId, agentStates, roundUpdate, start, stop, reset } = useRunStream({
    project,
    onFinish: () => console.log('[workflow] run finished'),
    onError: (e) => console.error('[workflow] run error', e),
  })

  // 通知父组件 runId 变化
  const notifyRunId = useCallback((id: string | null) => onRunIdChange?.(id), [onRunIdChange])
  useEffect(() => {
    if (runId !== undefined && runId !== null) {
      notifyRunId(runId)
    }
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

  // RunMessage[] + seed → ThreadMessageLike[] (filtered by selectedAgent / selectedRound / selectedHypoId)
  const threadMessages = useMemo(
    () => toThreadMessages(seed, messages, state, selectedAgent, selectedRound, selectedHypoId),
    [seed, messages, state, selectedAgent, selectedRound, selectedHypoId],
  )

  const isRunning = state === 'connecting' || state === 'streaming' || state === 'reconnecting'
  const hasStarted = seed !== null || messages.length > 0

  // onNew: 用户提交 seed → 启动 workflow run
  const onNew = useCallback(
    async (message: AppendMessage) => {
      const textPart = message.content.find((p) => p.type === 'text')
      if (!textPart?.type || textPart.type !== 'text') {
        throw new Error('Only text messages are supported')
      }
      const seedText = textPart.text
      setSeed(seedText)
      await start(seedText, modelAlias)
    },
    [start, modelAlias],
  )

  // onCancel: 停止 workflow run
  const onCancel = useCallback(async () => {
    await stop()
  }, [stop])

  // reset: 重置整个会话（外部按钮调用）
  const handleReset = useCallback(() => {
    setSeed(null)
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

  // 暴露 reset 给子组件（通过 context-like prop）
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ResetContext.Provider value={handleReset}>{children}</ResetContext.Provider>
    </AssistantRuntimeProvider>
  )
}

import { createContext, useContext } from 'react'

const ResetContext = createContext<(() => void) | null>(null)

/** 获取 reset 函数（在 WorkflowRuntimeProvider 内部使用） */
export function useWorkflowReset(): (() => void) | null {
  return useContext(ResetContext)
}
