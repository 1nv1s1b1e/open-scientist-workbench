'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import type { OrchestratorData } from '@/lib/types/visualizers'
import { cn } from '@/lib/utils/cn'
import { AGENT_COLORS, AGENT_LABELS, AGENT_ROLES } from '@/lib/visualizers/colorTheme'

const RING_RADIUS = 110

export function DebateTheater({ data }: { data: OrchestratorData }) {
  const [tick, setTick] = useState(0)

  // 轻量呼吸动画驱动（完整 GSAP 剧本待 Phase 2）
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1200)
    return () => clearInterval(id)
  }, [])

  const activeRoles = useMemo(() => {
    const set = new Set<string>()
    for (const e of data.edges) {
      if (e.active) {
        set.add(e.source)
        set.add(e.target)
      }
    }
    return set
  }, [data.edges])

  const slots = AGENT_ROLES.map((role, i) => {
    const angle = (i / AGENT_ROLES.length) * Math.PI * 2 - Math.PI / 2
    return {
      role,
      x: Math.cos(angle) * RING_RADIUS,
      y: Math.sin(angle) * RING_RADIUS,
      active: activeRoles.has(role),
    }
  })

  const activeEdges = data.edges.filter((e) => e.active)

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <h3 className="text-lg font-semibold text-[var(--color-text)]">辩论剧场（预览）</h3>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          完整 GSAP 剧本动画待 Phase 2 实现
        </p>
      </motion.div>

      <div className="relative h-[280px] w-[280px]">
        {/* 中心脉冲核心 */}
        <motion.div
          className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-sisyphus)]"
          animate={{
            scale: [1, 1.8, 1],
            opacity: [0.4, 0.9, 0.4],
          }}
          transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
        />

        {slots.map(({ role, x, y, active }) => {
          const color = AGENT_COLORS[role]
          return (
            <motion.div
              key={role}
              className={cn(
                'absolute flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-2 text-[10px] font-medium',
              )}
              style={{
                left: `calc(50% + ${x}px)`,
                top: `calc(50% + ${y}px)`,
                borderColor: color,
                backgroundColor: active ? `${color}33` : 'var(--color-surface)',
              }}
              animate={{
                scale: active ? 1.1 : 1,
                opacity: active ? 1 : 0.5,
                boxShadow: active ? `0 0 24px ${color}66` : '0 0 0px transparent',
              }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            >
              <span style={{ color }}>{AGENT_LABELS[role]}</span>
            </motion.div>
          )
        })}

        {/* 活跃边：脉冲粒子沿连线运动 */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 280 280"
          role="img"
          aria-label="agent 协作拓扑"
        >
          <title>辩论剧场协作连线</title>
          {activeEdges.map((e) => {
            const src = slots.find((s) => s.role === e.source)
            const tgt = slots.find((s) => s.role === e.target)
            if (!src || !tgt) return null
            const key = `${e.source}->${e.target}`
            return (
              <g key={key}>
                <line
                  x1={140 + src.x}
                  y1={140 + src.y}
                  x2={140 + tgt.x}
                  y2={140 + tgt.y}
                  stroke={AGENT_COLORS[e.source as keyof typeof AGENT_COLORS]}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  opacity={0.6}
                />
                <motion.circle
                  r={3}
                  fill={AGENT_COLORS[e.source as keyof typeof AGENT_COLORS]}
                  animate={{
                    cx: [140 + src.x, 140 + tgt.x],
                    cy: [140 + src.y, 140 + tgt.y],
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: 'easeInOut',
                    delay: tick * 0.01,
                  }}
                />
              </g>
            )
          })}
        </svg>
      </div>

      <AnimatePresence>
        {activeEdges.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-wrap justify-center gap-2"
          >
            {activeEdges.map((e) => (
              <span
                key={`${e.source}->${e.target}`}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-muted"
              >
                {AGENT_LABELS[e.source as keyof typeof AGENT_LABELS]} →{' '}
                {AGENT_LABELS[e.target as keyof typeof AGENT_LABELS]}
              </span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
