'use client'

import { RotateCcw } from 'lucide-react'
import { Thread } from '@/components/assistant-ui/thread'
import { Button } from '@/components/ui/button'
import { WorkflowDataUIs } from '@/lib/chat/data-ui'
import { WorkflowToolUIs } from '@/lib/chat/toolkit'
import { useWorkflowReset, WorkflowRuntimeProvider } from '@/lib/chat/workflow-runtime'

interface ChatPanelProps {
  project: string
  modelAlias?: string
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

/** 顶部工具栏（含 reset 按钮） */
function ChatToolbar() {
  const reset = useWorkflowReset()
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-[var(--color-sunset)]" />
        <span className="font-mono text-[11px] uppercase tracking-[1.2px] text-body">
          sisyphus tournament
        </span>
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
        <ChatToolbar />
        <div className="flex-1 overflow-hidden">
          <Thread />
        </div>
      </div>
    </WorkflowRuntimeProvider>
  )
}
