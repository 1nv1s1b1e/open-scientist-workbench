'use client'

import type { HierarchyPointNode } from 'd3-hierarchy'
import { hierarchy, tree } from 'd3-hierarchy'
import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import type {
  EvolutionTreeData,
  HypothesisTreeNode,
  HypothesisTreeNodeStatus,
} from '@/lib/types/visualizers'
import { cn } from '@/lib/utils/cn'
import { EMPTY_EVOLUTION_TREE } from '@/lib/visualizers/evolution-tree-data'

const STATUS_STYLE: Record<
  HypothesisTreeNodeStatus,
  { stroke: string; fill: string; glow?: boolean; opacity: number; label: string }
> = {
  alive: { stroke: '#10b981', fill: 'rgba(16,185,129,0.12)', opacity: 1, label: '存活' },
  withered: { stroke: '#8b92ad', fill: 'rgba(139,146,173,0.08)', opacity: 0.5, label: '淘汰' },
  winner: {
    stroke: '#f59e0b',
    fill: 'rgba(245,158,11,0.18)',
    glow: true,
    opacity: 1,
    label: '胜出',
  },
}

interface TooltipState {
  x: number
  y: number
  node: HypothesisTreeNode
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

export function EvolutionTree({ data = EMPTY_EVOLUTION_TREE }: { data?: EvolutionTreeData }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const layout = useMemo(() => {
    if (!data.root) return null
    const root = hierarchy<HypothesisTreeNode>(data.root)
    const treeLayout = tree<HypothesisTreeNode>().nodeSize([120, 80])
    const rootPoint = treeLayout(root)
    const descendants = rootPoint.descendants()
    const xs = descendants.map((d) => d.x)
    const ys = descendants.map((d) => d.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const width = maxX - minX + 200
    const height = maxY - minY + 160
    return { rootPoint, descendants, width, height, minX, minY }
  }, [data.root])

  if (!layout) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-[var(--color-text-muted)]">
        等待假说生成…
      </div>
    )
  }

  const { rootPoint, descendants, width, height, minX, minY } = layout
  const offsetX = -minX + 100
  const offsetY = -minY + 80

  return (
    <div className="relative h-full w-full overflow-auto">
      <svg width={width} height={height} className="block" role="img" aria-label="假说演化树">
        <title>假说演化树</title>
        <desc>展示假说从种子到突变/淘汰/胜出的演化路径</desc>
        <g transform={`translate(${offsetX}, ${offsetY})`}>
          {rootPoint.links().map((link) => {
            const s = link.source as HierarchyPointNode<HypothesisTreeNode>
            const t = link.target as HierarchyPointNode<HypothesisTreeNode>
            const mx = (s.y + t.y) / 2
            const d = `M${s.y},${s.x} C${mx},${s.x} ${mx},${t.x} ${t.y},${t.x}`
            const key = `${s.data.hypothesis.id}->${t.data.hypothesis.id}`
            return (
              <path
                key={key}
                d={d}
                fill="none"
                stroke={t.data.status === 'withered' ? '#3a4060' : '#3b82f6'}
                strokeWidth={t.data.status === 'winner' ? 2 : 1}
                strokeOpacity={t.data.status === 'withered' ? 0.4 : 0.7}
              />
            )
          })}
          {descendants.map((node) => {
            const style = STATUS_STYLE[node.data.status]
            const f1 = node.data.hypothesis.f1
            const hypoId = node.data.hypothesis.id
            return (
              <motion.g
                key={hypoId}
                transform={`translate(${node.y}, ${node.x})`}
                style={{ cursor: 'pointer', opacity: style.opacity }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: style.opacity }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                onClick={() => console.log('selected', hypoId)}
                onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, node: node.data })}
                onMouseLeave={() => setTooltip(null)}
              >
                <title>{`假说 ${hypoId} · ${style.label} · F1 ${f1 ?? '—'}`}</title>
                {style.glow && (
                  <motion.circle
                    r={32}
                    fill="none"
                    stroke={style.stroke}
                    strokeWidth={1}
                    strokeOpacity={0.3}
                    animate={{ r: [28, 36, 28], strokeOpacity: [0.4, 0.1, 0.4] }}
                    transition={{
                      duration: 2.5,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: 'easeInOut',
                    }}
                  />
                )}
                <circle r={26} fill={style.fill} stroke={style.stroke} strokeWidth={2} />
                <text
                  textAnchor="middle"
                  dy="0.3em"
                  fontSize={10}
                  fill="#e8eaf0"
                  fontWeight={node.data.status === 'winner' ? 600 : 400}
                >
                  {truncate(node.data.hypothesis.statement, 30)}
                </text>
                {f1 !== null && (
                  <g transform="translate(18, -18)">
                    <circle r={10} fill="#161b30" stroke={style.stroke} strokeWidth={1} />
                    <text textAnchor="middle" dy="0.3em" fontSize={8} fill={style.stroke}>
                      {f1.toFixed(2)}
                    </text>
                  </g>
                )}
              </motion.g>
            )
          })}
        </g>
      </svg>
      {tooltip && (
        <div
          className={cn(
            'pointer-events-none fixed z-50 max-w-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs shadow-xl',
          )}
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
          role="tooltip"
        >
          <div className="font-semibold text-[var(--color-text)]">
            {tooltip.node.hypothesis.statement}
          </div>
          <div className="mt-1 text-[var(--color-text-muted)]">
            轮次 {tooltip.node.hypothesis.round} · F1 {tooltip.node.hypothesis.f1 ?? '—'}
          </div>
          {tooltip.node.mutationRationale && (
            <div className="mt-2">
              <div className="text-[10px] uppercase text-[var(--color-explore)]">突变依据</div>
              <div className="text-[var(--color-text-muted)]">{tooltip.node.mutationRationale}</div>
            </div>
          )}
          {tooltip.node.critiqueSummary && (
            <div className="mt-2">
              <div className="text-[10px] uppercase text-[var(--color-oracle)]">批判摘要</div>
              <div className="text-[var(--color-text-muted)]">{tooltip.node.critiqueSummary}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
