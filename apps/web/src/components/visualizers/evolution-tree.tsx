'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { EvolutionTreeData, HypothesisTreeNode } from '@/lib/types/visualizers'
import { cn } from '@/lib/utils/cn'
import { DEFAULT_EVOLUTION_TREE } from '@/lib/visualizers/evolution-tree-data'

interface PositionedNode {
  data: HypothesisTreeNode
  x: number
  y: number
  depth: number
  parentId: string | null
}

interface ConnectionLink {
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  isWinner: boolean
  isWithered: boolean
}

export function EvolutionTree({ data = DEFAULT_EVOLUTION_TREE }: { data?: EvolutionTreeData }) {
  const activeData = data?.root ? data : DEFAULT_EVOLUTION_TREE
  const [selectedNode, setSelectedNode] = useState<HypothesisTreeNode | null>(null)

  // Canvas Pan & Zoom States
  const containerRef = useRef<HTMLDivElement>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    setIsDragging(true)
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return
      setPan({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      })
    },
    [isDragging],
  )

  const handleMouseUp = () => setIsDragging(false)

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92
    setScale((prev) => Math.min(2.5, Math.max(0.4, prev * zoomFactor)))
  }

  const handleReset = () => {
    setPan({ x: 0, y: 0 })
    setScale(1)
  }

  // 深度优先计算二维 Tree 节点坐标（无重叠，严格横向展开）
  const { nodes, links, bounds } = useMemo(() => {
    if (!activeData.root) return { nodes: [], links: [], bounds: { width: 800, height: 600 } }

    const nodePositions: PositionedNode[] = []
    const connectionLinks: ConnectionLink[] = []

    let leafYCounter = 0
    const LEVEL_WIDTH = 320 // 轮次层级横向间距
    const NODE_HEIGHT = 120 // 纵向分布间距

    function layoutNode(node: HypothesisTreeNode, depth: number, parentId: string | null): number {
      const children = node.children || []
      let currentY: number

      if (children.length === 0) {
        currentY = leafYCounter * NODE_HEIGHT + 60
        leafYCounter += 1
      } else {
        const childYs = children.map((child) => layoutNode(child, depth + 1, node.hypothesis.id))
        currentY = (childYs[0]! + childYs[childYs.length - 1]!) / 2
      }

      const currentX = depth * LEVEL_WIDTH + 80

      nodePositions.push({
        data: node,
        x: currentX,
        y: currentY,
        depth,
        parentId,
      })

      return currentY
    }

    layoutNode(activeData.root, 0, null)

    // 构建 SVG 连接线
    for (const target of nodePositions) {
      if (!target.parentId) continue
      const parent = nodePositions.find((n) => n.data.hypothesis.id === target.parentId)
      if (!parent) continue

      const isWinnerEdge = target.data.status === 'winner'
      const isWitheredEdge = target.data.status === 'withered'

      connectionLinks.push({
        id: `${parent.data.hypothesis.id}->${target.data.hypothesis.id}`,
        sourceX: parent.x + 240,
        sourceY: parent.y + 45,
        targetX: target.x,
        targetY: target.y + 45,
        isWinner: isWinnerEdge,
        isWithered: isWitheredEdge,
      })
    }

    const maxX = Math.max(...nodePositions.map((n) => n.x)) + 320
    const maxY = Math.max(...nodePositions.map((n) => n.y)) + 160

    return {
      nodes: nodePositions,
      links: connectionLinks,
      bounds: { width: Math.max(maxX, 1200), height: Math.max(maxY, 700) },
    }
  }, [activeData])

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      className={cn(
        'relative h-full w-full select-none overflow-hidden rounded-lg border border-[var(--color-border)] bg-[#090a0f]',
        isDragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
    >
      {/* Dynamic Grid Background */}
      <div
        className="bg-grid pointer-events-none absolute inset-0 opacity-30 transition-transform duration-75"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      />

      {/* Legend & Header Toolbar */}
      <div className="absolute left-4 top-4 z-20 flex items-center justify-between gap-4 rounded-full border border-white/10 bg-black/70 px-4 py-2 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-semibold uppercase tracking-[1.4px] text-white">
            假说演化树 Topology
          </span>
        </div>
        <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[1px]">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> 存活
          </span>
          <span className="flex items-center gap-1.5 text-amber-400">
            <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]" /> 胜出
            (Winner 🏆)
          </span>
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="h-2 w-2 rounded-full bg-slate-500" /> 淘汰
          </span>
        </div>
        <div className="h-3 w-px bg-white/20" />
        <span className="font-mono text-[10px] uppercase text-white/50">
          按住鼠标拖动平移 · 滚轮缩放 ({Math.round(scale * 100)}%)
        </span>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[10px] uppercase text-white/80 hover:bg-white/20"
        >
          重置视图
        </button>
      </div>

      {/* Interactive 2D Stage with Mouse Pan & Zoom */}
      <div
        className="relative transition-transform duration-75"
        style={{
          width: bounds.width,
          height: bounds.height,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {/* SVG Bezier Lines */}
        <svg
          width={bounds.width}
          height={bounds.height}
          className="pointer-events-none absolute inset-0 z-0"
        >
          {links.map((link) => {
            const midX = (link.sourceX + link.targetX) / 2
            const d = `M ${link.sourceX} ${link.sourceY} C ${midX} ${link.sourceY}, ${midX} ${link.targetY}, ${link.targetX} ${link.targetY}`

            return (
              <g key={link.id}>
                {link.isWinner && (
                  <path d={d} fill="none" stroke="#f59e0b" strokeWidth={4} strokeOpacity={0.25} />
                )}
                <path
                  d={d}
                  fill="none"
                  stroke={link.isWinner ? '#f59e0b' : link.isWithered ? '#334155' : '#3b82f6'}
                  strokeWidth={link.isWinner ? 2.5 : 1.5}
                  strokeOpacity={link.isWithered ? 0.35 : 0.8}
                  strokeDasharray={link.isWithered ? '4 4' : undefined}
                />
              </g>
            )
          })}
        </svg>

        {/* Node Cards */}
        {nodes.map(({ data: node, x, y }) => {
          const isWinner = node.status === 'winner'
          const isWithered = node.status === 'withered'
          const f1 = node.hypothesis.f1
          const round = node.hypothesis.round
          const isSelected = selectedNode?.hypothesis.id === node.hypothesis.id

          return (
            <motion.div
              key={node.hypothesis.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              style={{ left: x, top: y, width: 240 }}
              onClick={(e) => {
                e.stopPropagation()
                setSelectedNode(node)
              }}
              className={cn(
                'absolute z-10 cursor-pointer rounded-xl border p-3.5 backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5',
                isWinner
                  ? 'border-amber-500/70 bg-amber-500/15 shadow-[0_0_25px_rgba(245,158,11,0.2)] hover:border-amber-400'
                  : isWithered
                    ? 'border-white/5 bg-[#12141c]/60 opacity-60 hover:opacity-90'
                    : 'border-white/15 bg-[#121624]/80 hover:border-emerald-500/60 hover:bg-[#161d30]',
                isSelected && 'ring-2 ring-white/90',
              )}
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[1px] text-white/70">
                  R{round} · {node.hypothesis.id}
                </span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.8px]',
                    isWinner
                      ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                      : isWithered
                        ? 'bg-slate-500/20 text-slate-400'
                        : 'bg-emerald-500/20 text-emerald-300',
                  )}
                >
                  {isWinner ? '🏆 胜出' : isWithered ? '淘汰' : '候选'}
                </span>
              </div>

              <p className="mt-2 text-xs font-medium leading-relaxed text-white/90 line-clamp-2">
                {node.hypothesis.statement}
              </p>

              {f1 != null && (
                <div className="mt-2.5 flex items-center justify-between border-t border-white/5 pt-2">
                  <span className="font-mono text-[10px] uppercase text-white/50">F1 Score</span>
                  <span
                    className={cn(
                      'font-mono text-[11px] font-bold',
                      isWinner ? 'text-amber-400' : 'text-emerald-400',
                    )}
                  >
                    {f1.toFixed(2)}
                  </span>
                </div>
              )}
            </motion.div>
          )
        })}
      </div>

      {/* Selected Node Details Drawer */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-30 w-96 rounded-xl border border-white/20 bg-black/90 p-5 backdrop-blur-2xl shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="font-mono text-xs uppercase tracking-[1px] text-amber-400">
                Round {selectedNode.hypothesis.round} · {selectedNode.hypothesis.id}
              </span>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="font-mono text-xs text-white/40 hover:text-white"
              >
                ✕
              </button>
            </div>
            <h4 className="mt-3 text-sm font-semibold leading-relaxed text-white">
              {selectedNode.hypothesis.statement}
            </h4>

            {selectedNode.mutationRationale && (
              <div className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                <span className="font-mono text-[10px] uppercase tracking-[1px] text-blue-300">
                  突变依据 (Mutation Rationale)
                </span>
                <p className="mt-1 text-xs text-white/80">{selectedNode.mutationRationale}</p>
              </div>
            )}

            {selectedNode.critiqueSummary && (
              <div className="mt-2.5 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3">
                <span className="font-mono text-[10px] uppercase tracking-[1px] text-rose-300">
                  Oracle 评审摘要
                </span>
                <p className="mt-1 text-xs text-white/80">{selectedNode.critiqueSummary}</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default EvolutionTree
