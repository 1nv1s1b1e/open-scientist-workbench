'use client'

import { RotateCcw, X } from 'lucide-react'
import { Thread } from '@/components/assistant-ui/thread'
import { Button } from '@/components/ui/button'
import { WorkflowDataUIs } from '@/lib/chat/data-ui'
import { WorkflowToolUIs } from '@/lib/chat/toolkit'
import { useWorkflowReset, WorkflowRuntimeProvider } from '@/lib/chat/workflow-runtime'
import type { AgentRole } from '@/lib/types/visualizers'

interface ChatPanelProps {
  project: string
  modelAlias?: string
  selectedAgent?: AgentRole | null
  onSelectAgent?: (role: AgentRole | null) => void
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
}

/** 顶部工具栏（含聚焦 Agent 状态与 reset 按钮） */
function ChatToolbar({
  selectedAgent,
  onSelectAgent,
}: {
  selectedAgent?: AgentRole | null
  onSelectAgent?: (role: AgentRole | null) => void
}) {
  const reset = useWorkflowReset()
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
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
      {reset && (
        <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5">
          <RotateCcw className="h-3 w-3" />
          <span className="font-mono text-[10px] uppercase tracking-[1px]">new run</span>
        </Button>
      )}
    </div>
  )
}

export function ChatPanel({
  project,
  modelAlias,
  selectedAgent,
  onSelectAgent,
  onRunIdChange,
  onStateChange,
  onAgentStatesChange,
}: ChatPanelProps) {
  return (
    <WorkflowRuntimeProvider
      project={project}
      modelAlias={modelAlias}
      onRunIdChange={onRunIdChange}
      onStateChange={onStateChange}
      onAgentStatesChange={onAgentStatesChange}
    >
      {/* 注册工具 + 自定义事件渲染器（挂载即注册） */}
      <WorkflowToolUIs />
      <WorkflowDataUIs />
      <div className="flex h-full flex-col">
        <ChatToolbar selectedAgent={selectedAgent} onSelectAgent={onSelectAgent} />
        <div className="flex-1 overflow-hidden">
          <Thread />
        </div>
      </div>
    </WorkflowRuntimeProvider>
  )
}
