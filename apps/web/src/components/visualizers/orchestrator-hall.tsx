'use client'

import '@xyflow/react/dist/style.css'
import { Background, type Edge, type Node, type NodeProps, ReactFlow } from '@xyflow/react'
import { useCallback, useMemo } from 'react'
import type {
  AgentNodeData,
  AgentState,
  MessageEdgeData,
  OrchestratorData,
} from '@/lib/types/visualizers'
import { cn } from '@/lib/utils/cn'
import { AGENT_COLORS, AGENT_LABELS } from '@/lib/visualizers/colorTheme'
import { AGENT_POSITIONS, buildInitialOrchestratorData } from '@/lib/visualizers/orchestrator-data'

const STATE_BADGE: Record<AgentState, { label: string; cls: string }> = {
  idle: { label: '空闲', cls: 'border-zinc-600/40 bg-zinc-800/40 text-zinc-400' },
  thinking: { label: '思考中', cls: 'border-blue-500/40 bg-blue-500/10 text-blue-300' },
  'executing-tool': {
    label: '执行工具',
    cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  'waiting-approval': {
    label: '等待审批',
    cls: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
  },
  error: { label: '错误', cls: 'border-red-500/40 bg-red-500/10 text-red-400' },
}

const EDGE_COLORS: Record<MessageEdgeData['kind'], string> = {
  collab: '#3b82f6',
  critique: '#ef4444',
  'new-hypothesis': '#10b981',
  approval: '#a855f7',
  steering: '#f59e0b',
}

type AgentNode = Node<AgentNodeData, 'agent'>

function AgentNodeCard({ data }: NodeProps<AgentNode>) {
  const color = AGENT_COLORS[data.role]
  const badge = STATE_BADGE[data.state]
  const tokenPct =
    data.tokenUsage && data.tokenLimit ? (data.tokenUsage / data.tokenLimit) * 100 : null

  return (
    <div
      className={cn(
        'group relative w-48 rounded-sm border bg-[var(--color-surface)] p-3.5 text-left transition-all hover:border-white/40',
        data.state === 'error' && 'animate-pulse border-red-500',
      )}
      style={{ borderColor: data.state === 'idle' ? 'var(--color-border)' : color }}
    >
      {/* Role header with color dot indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full shadow-[0_0_8px_currentColor]"
            style={{ backgroundColor: color, color }}
          />
          <span className="font-mono text-sm font-normal uppercase tracking-[1.4px] text-white">
            {AGENT_LABELS[data.role]}
          </span>
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[1px]',
            badge.cls,
          )}
        >
          {badge.label}
        </span>
      </div>

      {/* Current active tool */}
      {data.currentTool && (
        <div
          className="mt-2.5 flex items-center gap-1.5 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[10px] text-muted"
          title={data.currentTool}
        >
          <span className="h-1 w-1 rounded-full bg-[var(--color-sunset)]" />
          <span className="truncate">{data.currentTool}</span>
        </div>
      )}

      {/* Token usage progress bar */}
      {tokenPct !== null && (
        <div className="mt-3 border-t border-[var(--color-border)]/60 pt-2">
          <div className="flex justify-between font-mono text-[9px] uppercase tracking-[1px] text-muted">
            <span>Tokens</span>
            <span className="tabular-nums">
              {data.tokenUsage} / {data.tokenLimit}
            </span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--color-bg)]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.min(tokenPct, 100)}%`, backgroundColor: color }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

const NODE_TYPES = { agent: AgentNodeCard }

export function OrchestratorHall({
  data = buildInitialOrchestratorData(),
}: {
  data?: OrchestratorData
}) {
  const nodes: AgentNode[] = useMemo(
    () =>
      data.agents.map((agent) => ({
        id: agent.role,
        type: 'agent',
        position: AGENT_POSITIONS[agent.role],
        data: agent,
      })),
    [data.agents],
  )

  const edges: Edge[] = useMemo(
    () =>
      data.edges.map((e, i) => ({
        id: `${e.source}->${e.target}-${i}`,
        source: e.source,
        target: e.target,
        animated: e.active,
        label: e.label,
        labelStyle: { fill: '#ffffff', fontSize: 10, fontFamily: 'var(--font-mono)' },
        labelBgStyle: { fill: '#0a0a0a', stroke: '#212327' },
        style: { stroke: EDGE_COLORS[e.kind], strokeWidth: e.active ? 2 : 1 },
      })),
    [data.edges],
  )

  const onInit = useCallback((rf: { fitView: () => void }) => {
    setTimeout(() => rf.fitView(), 50)
  }, [])

  return (
    <div className="h-full w-full bg-[var(--color-bg)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onInit={onInit}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgba(255, 255, 255, 0.05)" gap={24} />
      </ReactFlow>
    </div>
  )
}
