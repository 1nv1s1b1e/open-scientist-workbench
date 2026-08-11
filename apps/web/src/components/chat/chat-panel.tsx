'use client'

import { RotateCcw, Square, X } from 'lucide-react'
import { Thread } from '@/components/assistant-ui/thread'
import type { RoundUpdateState, RunMessage } from '@/lib/hooks/useRunStream'
import { WorkflowDataUIs } from '@/lib/chat/data-ui'
import { WorkflowToolUIs } from '@/lib/chat/toolkit'
import { useWorkflowControls, WorkflowRuntimeProvider, type ExecutionMode } from '@/lib/chat/workflow-runtime'
import type { AgentRole } from '@/lib/types/visualizers'
import type { PhenomenonInput } from '@open-scientist/schema'

interface ChatPanelProps {
  project: string
  modelAlias?: string
  phenomenon?: PhenomenonInput
  maxRounds?: number
  executionMode?: ExecutionMode
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
    states: Partial<Record<import('@/lib/types/visualizers').AgentRole, import('@/lib/types/visualizers').AgentState>>,
  ) => void
  onRoundUpdateChange?: (update: RoundUpdateState) => void
  onMessagesChange?: (messages: RunMessage[]) => void
  onScientificStateChange?: Parameters<typeof WorkflowRuntimeProvider>[0]['onScientificStateChange']
  runtimeProvided?: boolean
}

function ChatToolbar({
  selectedAgent,
  onSelectAgent,
  selectedRound,
  selectedHypoId,
  onSelectRoundHypo,
  availableRounds,
  availableHypos,
  onClearRun,
}: Pick<ChatPanelProps, 'selectedAgent' | 'onSelectAgent' | 'selectedRound' | 'selectedHypoId' | 'onSelectRoundHypo' | 'availableRounds' | 'availableHypos'> & { onClearRun?: () => void }) {
  const workflow = useWorkflowControls()
  const hyposForRound = selectedRound != null ? (availableHypos ?? []).filter((h) => h.round === selectedRound) : []

  return (
    <div className="console-toolbar">
      <div className="console-toolbar-main">
        <div className="min-w-0">
          <div className="eyebrow-mono text-[var(--color-sunset-soft)]">MODEL WORK LOG</div>
          <div className="mt-1 flex items-center gap-2"><span className="console-toolbar-dot" /><span className="text-sm font-medium text-white">模型工作摘要</span></div>
          <div className="mt-1 truncate text-[11px] text-[var(--color-text-muted)]">同步展示模型提交的依据、科学判断与关键工具结果</div>
          {selectedAgent && <button type="button" onClick={() => onSelectAgent?.(null)} className="mt-2 flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 font-mono text-[9px] tracking-[.5px] text-muted hover:text-white">当前聚焦：{selectedAgent}<X className="h-2.5 w-2.5" /></button>}
        </div>
        <div className="flex items-center gap-2">
          {workflow?.isRunning && <button type="button" onClick={() => void workflow.stop()} className="console-stop-button inline-flex items-center gap-1.5" title="终止当前运行"><Square className="h-3 w-3" />停止</button>}
          {onClearRun && <button type="button" onClick={onClearRun} className="console-reset-button inline-flex items-center gap-1.5" title="清空当前记录；随后可在工作台重新开始分析"><RotateCcw className="h-3 w-3" />清空记录</button>}
          <span className="console-readonly-badge">公开摘要</span>
        </div>
      </div>

      {(availableRounds?.length ?? 0) > 0 && <details className="console-filter-details">
        <summary className="console-filter-summary"><span>消息范围</span><span className="console-filter-current">{selectedRound == null ? '全部轮次' : `Round ${selectedRound}`}</span></summary>
        <div className="console-filter-body">
          <label><span>轮次</span><select value={selectedRound ?? ''} onChange={(e) => onSelectRoundHypo?.(e.target.value === '' ? null : Number(e.target.value), null)}><option value="">全部轮次</option>{(availableRounds ?? []).map((r) => <option key={r} value={r}>Round {r}</option>)}</select></label>
          {selectedRound != null && hyposForRound.length > 0 && <label><span>假设</span><select value={selectedHypoId ?? ''} onChange={(e) => onSelectRoundHypo?.(selectedRound, e.target.value === '' ? null : e.target.value)}><option value="">全部假设</option>{hyposForRound.map((h) => <option key={h.id} value={h.id}>{h.id}</option>)}</select></label>}
          {selectedRound != null && <button type="button" onClick={() => onSelectRoundHypo?.(null, null)} className="console-filter-clear">清除筛选</button>}
        </div>
      </details>}
    </div>
  )
}

function ChatPanelContent(props: ChatPanelProps) {
  const workflow = useWorkflowControls()

  return (
    <div className="flex h-full flex-col">
      <ChatToolbar {...props} onClearRun={workflow?.reset} />
      <div className="min-h-0 flex-1 overflow-hidden"><Thread showComposer={false} /></div>
    </div>
  )
}

export function ChatPanel(props: ChatPanelProps) {
  const content = <><WorkflowToolUIs /><WorkflowDataUIs /><ChatPanelContent {...props} /></>
  if (props.runtimeProvided) return content

  return <WorkflowRuntimeProvider project={props.project} modelAlias={props.modelAlias} phenomenon={props.phenomenon} maxRounds={props.maxRounds} executionMode={props.executionMode} selectedAgent={props.selectedAgent} selectedRound={props.selectedRound} selectedHypoId={props.selectedHypoId} onRunIdChange={props.onRunIdChange} onStateChange={props.onStateChange} onAgentStatesChange={props.onAgentStatesChange} onRoundUpdateChange={props.onRoundUpdateChange} onMessagesChange={props.onMessagesChange} onScientificStateChange={props.onScientificStateChange}>{content}</WorkflowRuntimeProvider>
}
