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
  idle: { label: '空闲', cls: 'bg-zinc-500/20 text-zinc-300' },
  thinking: { label: '思考中', cls: 'bg-blue-500/20 text-blue-300' },
  'executing-tool': { label: '执行工具', cls: 'bg-amber-500/20 text-amber-300' },
  'waiting-approval': { label: '等待审批', cls: 'bg-purple-500/20 text-purple-300' },
  error: { label: '错误', cls: 'bg-red-500/20 text-red-300' },
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
        'w-40 rounded-lg border-2 bg-[var(--color-surface)] px-3 py-2 text-center shadow-md',
        data.state === 'error' && 'animate-pulse',
      )}
      style={{ borderColor: color }}
    >
      <div className="text-sm font-semibold" style={{ color }}>
        {AGENT_LABELS[data.role]}
      </div>
      <div className={cn('mt-1 inline-block rounded px-1.5 py-0.5 text-[10px]', badge.cls)}>
        {badge.label}
      </div>
      {data.currentTool && (
        <div
          className="mt-1 truncate text-[10px] text-[var(--color-text-muted)]"
          title={data.currentTool}
        >
          ⚙ {data.currentTool}
        </div>
      )}
      {tokenPct !== null && (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(tokenPct, 100)}%`, backgroundColor: color }}
            />
          </div>
          <div className="mt-0.5 text-[9px] text-[var(--color-text-muted)]">
            {data.tokenUsage}/{data.tokenLimit}
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
        labelStyle: { fill: '#e8eaf0', fontSize: 10 },
        labelBgStyle: { fill: '#161b30' },
        style: { stroke: EDGE_COLORS[e.kind], strokeWidth: e.active ? 2 : 1 },
      })),
    [data.edges],
  )

  const onInit = useCallback((rf: { fitView: () => void }) => {
    setTimeout(() => rf.fitView(), 50)
  }, [])

  return (
    <div className="h-full w-full">
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
        <Background color="#232a44" gap={20} />
      </ReactFlow>
    </div>
  )
}
