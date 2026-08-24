'use client'

import { ArrowRight, RotateCcw, Square, X } from 'lucide-react'
import { useState } from 'react'
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
  onPhenomenonChange?: (value: PhenomenonInput | undefined) => void
  runtimeProvided?: boolean
  readOnly?: boolean
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
          <div className="mt-1 truncate text-[12px] text-[var(--color-text-muted)]">同步展示模型提交的依据、科学判断与关键工具结果</div>
          {selectedAgent && <button type="button" onClick={() => onSelectAgent?.(null)} className="mt-2 flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 font-mono text-[12px] tracking-[.5px] text-muted hover:text-white">当前聚焦：{selectedAgent}<X className="h-2.5 w-2.5" /></button>}
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

function textToPhenomenon(text: string): PhenomenonInput | undefined {
  const narrative = text.trim()
  if (!narrative) return undefined
  const slug = narrative
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42)
  const title =
    (narrative.split(/[。！？.!?\n]/)[0] ?? narrative).trim().slice(0, 64) || '活动区现象'
  return {
    phenomenonId: `phenomenon-${slug || 'input'}`,
    title,
    description: narrative,
    observations: [],
    constraints: [],
  }
}

function ConsolePhenomenonInput({
  phenomenon,
  onPhenomenonChange,
}: {
  phenomenon?: PhenomenonInput
  onPhenomenonChange?: (value: PhenomenonInput | undefined) => void
}) {
  const workflow = useWorkflowControls()
  const [draft, setDraft] = useState(() => phenomenon?.description ?? '')

  const ready = draft.trim().length > 0
  const isRunning = workflow?.isRunning ?? false

  const handleChange = (next: string) => {
    setDraft(next)
  }

  const handleSubmit = async () => {
    if (!ready || isRunning) return
    if (workflow?.hasStarted) workflow.reset()
    const text = draft.trim()
    const formed = textToPhenomenon(text)
    setDraft('')
    onPhenomenonChange?.(formed)
    await workflow?.submit(text, formed)
  }

  return (
    <div className="console-phenomenon-input">
      <textarea
        value={draft}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="输入活动区现象描述，例如：某活动区持续升温、局部亮度突增，不同波段响应存在时间差。"
        rows={3}
        aria-label="现象输入"
      />
      <div className="console-phenomenon-actions">
        <span className="console-phenomenon-hint">只需描述现象；资料与证据会由各阶段逐步登记。</span>
        {isRunning ? (
          <button type="button" onClick={() => void workflow?.stop()} className="console-stop-button inline-flex items-center gap-1.5">
            <Square className="h-3 w-3" />停止
          </button>
        ) : (
          <button type="button" onClick={() => void handleSubmit()} disabled={!ready} className="console-submit-button inline-flex items-center gap-1.5">
            <ArrowRight className="h-3 w-3" />开始分析
          </button>
        )}
      </div>
    </div>
  )
}

function ChatPanelContent(props: ChatPanelProps) {
  const workflow = useWorkflowControls()

  return (
    <div className="flex h-full flex-col">
      <ChatToolbar {...props} onClearRun={props.readOnly ? undefined : workflow?.reset} />
      <div className="min-h-0 flex-1 overflow-hidden"><Thread showComposer={false} /></div>
      {props.readOnly ? (
        <div className="flex items-center justify-center gap-2 border-t border-white/[0.08] px-4 py-4 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
          示例预览 · 只读
        </div>
      ) : (
        <ConsolePhenomenonInput phenomenon={props.phenomenon} onPhenomenonChange={props.onPhenomenonChange} />
      )}
    </div>
  )
}

export function ChatPanel(props: ChatPanelProps) {
  const content = <><WorkflowToolUIs /><WorkflowDataUIs /><ChatPanelContent {...props} /></>
  if (props.runtimeProvided) return content

  return <WorkflowRuntimeProvider project={props.project} modelAlias={props.modelAlias} phenomenon={props.phenomenon} maxRounds={props.maxRounds} executionMode={props.executionMode} selectedAgent={props.selectedAgent} selectedRound={props.selectedRound} selectedHypoId={props.selectedHypoId} onRunIdChange={props.onRunIdChange} onStateChange={props.onStateChange} onAgentStatesChange={props.onAgentStatesChange} onRoundUpdateChange={props.onRoundUpdateChange} onMessagesChange={props.onMessagesChange} onScientificStateChange={props.onScientificStateChange}>{content}</WorkflowRuntimeProvider>
}
