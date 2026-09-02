'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConceptCategory, ConceptNetData, ConceptNode } from '@/lib/types/visualizers'
import { CONCEPT_COLORS } from '@/lib/visualizers/colorTheme'

interface Node2D extends ConceptNode {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
}

const CATEGORY_LABELS: Record<ConceptCategory, string> = {
  waves: 'MHD 波动',
  reconnection: '磁重联',
  magnetic: '光球/磁场',
  thermodynamics: '热力学',
  other: '其他物理机制',
}

export function ConceptNet3D({ data }: { data?: ConceptNetData }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [selectedNode, setSelectedNode] = useState<ConceptNode | null>(null)
  const [activeCategory, setActiveCategory] = useState<ConceptCategory | 'all'>('all')
  const [hoveredNode, setHoveredNode] = useState<ConceptNode | null>(null)

  const nodesRef = useRef<Node2D[]>([])
  const animFrameRef = useRef<number | null>(null)

  const nodes = useMemo(() => data?.nodes ?? [], [data])
  const links = useMemo(() => data?.links ?? [], [data])

  // Initialize node positions
  useEffect(() => {
    const width = containerRef.current?.clientWidth || 800
    const height = containerRef.current?.clientHeight || 600

    nodesRef.current = nodes.map((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2
      const radius = 180 + (i % 2) * 50
      return {
        ...n,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        radius: 22,
      }
    })
  }, [nodes])

  // Canvas Force & High-DPI Render Loop
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let time = 0

    const render = () => {
      time += 0.015
      const rect = container.getBoundingClientRect()
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

      // High DPI Canvas Auto-scale
      const targetWidth = Math.floor(rect.width * dpr)
      const targetHeight = Math.floor(rect.height * dpr)
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth
        canvas.height = targetHeight
      }

      ctx.save()
      ctx.scale(dpr, dpr)

      const width = rect.width
      const height = rect.height
      const nodes = nodesRef.current
      const rawLinks = links

      // Force simulation calculations
      const cx = width / 2
      const cy = height / 2

      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i]!
        n1.vx += (cx - n1.x) * 0.0004
        n1.vy += (cy - n1.y) * 0.0004

        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j]!
          const dx = n2.x - n1.x
          const dy = n2.y - n1.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          if (dist < 200) {
            const force = ((200 - dist) / dist) * 0.06
            n1.vx -= dx * force
            n1.vy -= dy * force
            n2.vx += dx * force
            n2.vy += dy * force
          }
        }

        n1.vx *= 0.93
        n1.vy *= 0.93
        n1.x += n1.vx
        n1.y += n1.vy

        n1.x = Math.max(60, Math.min(width - 60, n1.x))
        n1.y = Math.max(60, Math.min(height - 60, n1.y))
      }

      ctx.clearRect(0, 0, width, height)

      // Draw Links
      for (const link of rawLinks) {
        const sourceNode = nodes.find((n) => n.id === link.source)
        const targetNode = nodes.find((n) => n.id === link.target)
        if (!sourceNode || !targetNode) continue

        const isFilteredOut =
          activeCategory !== 'all' &&
          sourceNode.category !== activeCategory &&
          targetNode.category !== activeCategory

        ctx.beginPath()
        ctx.moveTo(sourceNode.x, sourceNode.y)
        ctx.lineTo(targetNode.x, targetNode.y)
        ctx.lineWidth = isFilteredOut ? 0.5 : 1.5
        ctx.strokeStyle = isFilteredOut
          ? 'rgba(255,255,255,0.03)'
          : link.kind === 'supports'
            ? 'rgba(16,185,129,0.35)'
            : link.kind === 'contradicts'
              ? 'rgba(239,68,68,0.35)'
              : 'rgba(59,130,246,0.3)'
        ctx.setLineDash(link.kind === 'references' ? [4, 4] : [])
        ctx.stroke()
        ctx.setLineDash([])

        // Particle dynamics along link
        if (!isFilteredOut) {
          const t = (time + (sourceNode.x % 5) * 0.2) % 1
          const px = sourceNode.x + (targetNode.x - sourceNode.x) * t
          const py = sourceNode.y + (targetNode.y - sourceNode.y) * t
          ctx.beginPath()
          ctx.arc(px, py, 2.5, 0, Math.PI * 2)
          ctx.fillStyle = CONCEPT_COLORS[sourceNode.category] ?? '#3b82f6'
          ctx.fill()
        }
      }

      // Draw Nodes & High-DPI Crisp Labels
      for (const node of nodes) {
        const color = CONCEPT_COLORS[node.category] ?? '#8b5cf6'
        const isHovered = hoveredNode?.id === node.id
        const isSelected = selectedNode?.id === node.id
        const isFilteredOut = activeCategory !== 'all' && node.category !== activeCategory

        const r = node.radius * (isHovered || isSelected ? 1.25 : 1)

        // Outer glow
        if (!isFilteredOut) {
          ctx.beginPath()
          ctx.arc(node.x, node.y, r + (isHovered || isSelected ? 10 : 5), 0, Math.PI * 2)
          ctx.fillStyle = isSelected
            ? 'rgba(255,255,255,0.25)'
            : `${color}${isHovered ? '45' : '18'}`
          ctx.fill()
        }

        // Main node body
        ctx.beginPath()
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
        ctx.fillStyle = isFilteredOut ? '#1a1c22' : isSelected ? '#ffffff' : color
        ctx.globalAlpha = isFilteredOut ? 0.2 : node.state === 'faded' ? 0.4 : 1
        ctx.fill()

        ctx.lineWidth = isSelected ? 2.5 : 1.5
        ctx.strokeStyle = isSelected ? color : 'rgba(255,255,255,0.3)'
        ctx.stroke()
        ctx.globalAlpha = 1

        // Crisp High-DPI Text Label with background badge
        const fontSize = isHovered || isSelected ? 13 : 12
        ctx.font = `${isHovered || isSelected ? '600' : '500'} ${fontSize}px "Inter", system-ui, -apple-system, sans-serif`
        const textWidth = ctx.measureText(node.label).width
        const textY = node.y + r + 18

        // Subtle dark pill background for text readability
        ctx.fillStyle = 'rgba(9, 10, 15, 0.85)'
        ctx.fillRect(node.x - textWidth / 2 - 6, textY - 11, textWidth + 12, 18)
        ctx.strokeStyle = isSelected ? color : 'rgba(255, 255, 255, 0.12)'
        ctx.lineWidth = 1
        ctx.strokeRect(node.x - textWidth / 2 - 6, textY - 11, textWidth + 12, 18)

        // High contrast text
        ctx.fillStyle = isFilteredOut
          ? 'rgba(255,255,255,0.3)'
          : isSelected
            ? '#ffffff'
            : 'rgba(255,255,255,0.95)'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(node.label, node.x, textY)
      }

      ctx.restore()
      animFrameRef.current = requestAnimationFrame(render)
    }

    render()

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [data, links, activeCategory, hoveredNode, selectedNode])

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top

    const hit = nodesRef.current.find((n) => {
      const dx = n.x - clickX
      const dy = n.y - clickY
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 6
    })

    setSelectedNode(hit ?? null)
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const hit = nodesRef.current.find((n) => {
      const dx = n.x - mx
      const dy = n.y - my
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 6
    })

    setHoveredNode(hit ?? null)
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-[#090a0f]"
    >
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        className="h-full w-full cursor-pointer"
      />

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="rounded-lg border border-white/10 bg-black/80 px-6 py-4 text-center backdrop-blur-md">
            <p className="font-mono text-sm text-white/60">暂无知识图谱数据</p>
            <p className="mt-1 font-mono text-[11px] text-white/40">
              启动 Tournament Run 后将实时显示概念网络
            </p>
          </div>
        </div>
      )}

      {/* Category Filters */}
      <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-1.5 rounded-full border border-white/10 bg-black/70 p-1.5 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setActiveCategory('all')}
          className={`rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[1px] transition-colors ${
            activeCategory === 'all'
              ? 'bg-white text-black font-semibold'
              : 'text-white/60 hover:text-white'
          }`}
        >
          全部分类
        </button>
        {(Object.keys(CATEGORY_LABELS) as ConceptCategory[]).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[1px] transition-colors ${
              activeCategory === cat
                ? 'bg-white/20 text-white font-semibold'
                : 'text-white/50 hover:text-white'
            }`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: CONCEPT_COLORS[cat] }}
            />
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Detail Drawer */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-4 right-4 z-20 w-80 rounded-lg border border-white/15 bg-black/85 p-4 backdrop-blur-xl shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span
                className="rounded-full px-2 py-0.5 font-mono text-[11px] uppercase tracking-[1px]"
                style={{
                  backgroundColor: `${CONCEPT_COLORS[selectedNode.category]}30`,
                  color: CONCEPT_COLORS[selectedNode.category],
                }}
              >
                {CATEGORY_LABELS[selectedNode.category]}
              </span>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="font-mono text-xs text-white/40 hover:text-white"
              >
                ✕
              </button>
            </div>
            <h4 className="mt-2 font-semibold text-white">{selectedNode.label}</h4>
            <p className="mt-1.5 text-xs leading-relaxed text-white/70">
              {selectedNode.description ?? '太阳物理知识库提取概念'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default ConceptNet3D
