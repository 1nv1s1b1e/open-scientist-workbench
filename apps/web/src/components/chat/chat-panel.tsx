'use client'

import { RotateCcw, Wrench, X } from 'lucide-react'
import { useState } from 'react'
import { Thread } from '@/components/assistant-ui/thread'
import { Button } from '@/components/ui/button'
import type { RoundUpdateState } from '@/lib/hooks/useRunStream'
import type { RunMessage } from '@/lib/hooks/useRunStream'
import { WorkflowDataUIs } from '@/lib/chat/data-ui'
import { WorkflowToolUIs } from '@/lib/chat/toolkit'
import { useWorkflowReset, WorkflowRuntimeProvider } from '@/lib/chat/workflow-runtime'
import type { AgentRole } from '@/lib/types/visualizers'

interface ChatPanelProps {
  project: string
  modelAlias?: string
  selectedAgent?: AgentRole | null
  onSelectAgent?: (role: AgentRole | null) => void
  selectedRound?: number | null
  selectedHypoId?: string | null
  onSelectRoundHypo?: (round: number | null, hypoId: string | null) => void
  availableRounds?: number[]
  availableHypos?: Array<{ id: string; round: number }>
  onRunIdChange?: (runId: string | null) => void
  onStateChange?: (state: string) => void
  onAgentStatesChange?: (
    states: Partial<
      Record<
        import('@/lib/types/visualizers').AgentRole,
        import('@/lib/types/visualizers').AgentState
      >
    >,
  ) => void
  onRoundUpdateChange?: (update: RoundUpdateState) => void
  onMessagesChange?: (messages: RunMessage[]) => void
}

/** 顶部工具栏（含聚焦 Agent 状态、轮次-假设选择器、reset 按钮） */
function ChatToolbar({
  selectedAgent,
  onSelectAgent,
  selectedRound,
  selectedHypoId,
  onSelectRoundHypo,
  availableRounds,
  availableHypos,
  hideTools,
  onToggleHideTools,
}: {
  selectedAgent?: AgentRole | null
  onSelectAgent?: (role: AgentRole | null) => void
  selectedRound?: number | null
  selectedHypoId?: string | null
  onSelectRoundHypo?: (round: number | null, hypoId: string | null) => void
  availableRounds?: number[]
  availableHypos?: Array<{ id: string; round: number }>
  hideTools: boolean
  onToggleHideTools: () => void
}) {
  const reset = useWorkflowReset()
  // 当选择了某个 round 时，过滤出该 round 的 hypotheses
  const hyposForRound =
    selectedRound != null ? (availableHypos ?? []).filter((h) => h.round === selectedRound) : []
  return (
    <div className="flex flex-col gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--color-sunset)]" />
          <span className="font-mono text-[11px] uppercase tracking-[1.2px] text-body">
            {selectedAgent ? `AGENT · ${selectedAgent.toUpperCase()}` : 'SISYPHUS TOURNAMENT'}
          </span>
          {selectedAgent && (
            <button
              type="button"
              onClick={() => onSelectAgent?.(null)}
              className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.8px] text-muted hover:text-white"
            >
              <span>Show All</span>
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleHideTools}
            title={hideTools ? '显示工具调用' : '隐藏工具调用'}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.8px] transition-colors ${
              hideTools
                ? 'bg-white/10 text-muted hover:text-white'
                : 'bg-[var(--color-sunset)]/15 text-[var(--color-sunset-soft)] hover:bg-[var(--color-sunset)]/25'
            }`}
          >
            <Wrench className="h-3 w-3" />
            <span>{hideTools ? 'Tools Off' : 'Tools On'}</span>
          </button>
          {reset && (
            <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5">
              <RotateCcw className="h-3 w-3" />
              <span className="font-mono text-[10px] uppercase tracking-[1px]">new run</span>
            </Button>
          )}
        </div>
      </div>
      {/* 轮次-假设选择器 */}
      {(availableRounds?.length ?? 0) > 0 && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.8px] text-muted">FILTER</span>
          <select
            value={selectedRound ?? ''}
            onChange={(e) => {
              const val = e.target.value
              onSelectRoundHypo?.(val === '' ? null : Number(val), null)
            }}
            className="rounded border border-[var(--color-border)] bg-transparent px-2 py-0.5 font-mono text-[10px] text-body"
          >
            <option value="">全部轮次</option>
            {(availableRounds ?? []).map((r) => (
              <option key={r} value={r}>
                Round {r}
              </option>
            ))}
          </select>
          {selectedRound != null && hyposForRound.length > 0 && (
            <select
              value={selectedHypoId ?? ''}
              onChange={(e) => {
                const val = e.target.value
                onSelectRoundHypo?.(selectedRound, val === '' ? null : val)
              }}
              className="rounded border border-[var(--color-border)] bg-transparent px-2 py-0.5 font-mono text-[10px] text-body"
            >
              <option value="">全部假设</option>
              {hyposForRound.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.id}
                </option>
              ))}
            </select>
          )}
          {selectedRound != null && (
            <button
              type="button"
              onClick={() => onSelectRoundHypo?.(null, null)}
              className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[9px] uppercase text-muted hover:text-white"
            >
              清除
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function ChatPanel({
  project,
  modelAlias,
  selectedAgent,
  onSelectAgent,
  selectedRound,
  selectedHypoId,
  onSelectRoundHypo,
  availableRounds,
  availableHypos,
  onRunIdChange,
  onStateChange,
  onAgentStatesChange,
  onRoundUpdateChange,
  onMessagesChange,
}: ChatPanelProps) {
  const [hideTools, setHideTools] = useState(false)
  return (
    <WorkflowRuntimeProvider
      project={project}
      modelAlias={modelAlias}
      selectedAgent={selectedAgent}
      selectedRound={selectedRound}
      selectedHypoId={selectedHypoId}
      hideTools={hideTools}
      onRunIdChange={onRunIdChange}
      onStateChange={onStateChange}
      onAgentStatesChange={onAgentStatesChange}
      onRoundUpdateChange={onRoundUpdateChange}
      onMessagesChange={onMessagesChange}
    >
      {/* 注册工具 + 自定义事件渲染器（挂载即注册） */}
      <WorkflowToolUIs />
      <WorkflowDataUIs />
      <div className="flex h-full flex-col">
        <ChatToolbar
          selectedAgent={selectedAgent}
          onSelectAgent={onSelectAgent}
          selectedRound={selectedRound}
          selectedHypoId={selectedHypoId}
          onSelectRoundHypo={onSelectRoundHypo}
          availableRounds={availableRounds}
          availableHypos={availableHypos}
          hideTools={hideTools}
          onToggleHideTools={() => setHideTools((v) => !v)}
        />
        <div className="flex-1 overflow-hidden">
          <Thread />
        </div>
      </div>
    </WorkflowRuntimeProvider>
  )
}
