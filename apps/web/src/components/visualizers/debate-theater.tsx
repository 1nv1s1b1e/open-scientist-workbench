'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentRole, AgentState, OrchestratorData } from '@/lib/types/visualizers'
import { cn } from '@/lib/utils/cn'

const AGENT_CONFIGS: Record<
  AgentRole,
  {
    name: string
    tag: string
    title: string
    color: string
    bgGlow: string
    icon: string
    desc: string
  }
> = {
  sisyphus: {
    name: 'SISYPHUS',
    tag: 'SIS',
    title: '锦标赛总控编排器',
    color: '#f97316',
    bgGlow: 'rgba(249,115,22,0.3)',
    icon: '👑',
    desc: '纯确定性控制流，负责调度 5 个子 Agent 并执行 Tournament Evolution 工作流。',
  },
  librarian: {
    name: 'LIBRARIAN',
    tag: 'LIB',
    title: 'RAG 文献与假设检索',
    color: '#10b981',
    bgGlow: 'rgba(16,185,129,0.3)',
    icon: '📚',
    desc: '检索 HelixDB 图谱数据库，提取太阳物理初始假设池与学术文献背景。',
  },
  explore: {
    name: 'EXPLORE',
    tag: 'EXP',
    title: 'MHD 算法演化评估',
    color: '#8b5cf6',
    bgGlow: 'rgba(139,92,246,0.3)',
    icon: '⚡',
    desc: '在 1.75M 快照数据集上运行 Python 仿真代码，计算 F1 评价分数。',
  },
  oracle: {
    name: 'ORACLE',
    tag: 'ORA',
    title: 'Co-Scientist 五维批判',
    color: '#ef4444',
    bgGlow: 'rgba(239,68,68,0.3)',
    icon: '👁️',
    desc: '执行 Co-Scientist 五维假设批判与反例 debug，生成下一步突变策略。',
  },
  prometheus: {
    name: 'PROMETHEUS',
    tag: 'PRO',
    title: 'MHD 配置与观测建议书',
    color: '#f59e0b',
    bgGlow: 'rgba(245,158,11,0.3)',
    icon: '🔥',
    desc: '多轮规划计算预算，并在末轮输出最终 MHD 仿真配置 (.cfg) 与卫星观测建议书。',
  },
  looker: {
    name: 'LOOKER',
    tag: 'LOK',
    title: 'FITS / MP4 多模态对齐',
    color: '#06b6d4',
    bgGlow: 'rgba(6,182,212,0.3)',
    icon: '🔭',
    desc: '处理 SDO/AIA FITS 图像与 MP4 演化视频，对齐多模态特征。',
  },
}

const AGENT_ANGLES: Record<AgentRole, number> = {
  sisyphus: -90, // Top
  prometheus: -30, // Top Right
  oracle: 30, // Bottom Right
  explore: 90, // Bottom
  looker: 150, // Bottom Left
  librarian: -150, // Top Left
}

interface DebateTheaterProps {
  data?: OrchestratorData
  selectedAgent?: AgentRole | null
  onSelectAgent?: (role: AgentRole | null) => void
}

export function DebateTheater({ data, selectedAgent, onSelectAgent }: DebateTheaterProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  const [hoveredAgent, setHoveredAgent] = useState<AgentRole | null>(null)
  const [activeSpeech, setActiveSpeech] = useState<{ role: AgentRole; text: string } | null>(null)

  // 鼠标拖动 (Pan)
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

  // 滚轮缩放 (Zoom)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92
    setScale((prev) => Math.min(2.5, Math.max(0.4, prev * zoomFactor)))
  }

  const handleReset = () => {
    setPan({ x: 0, y: 0 })
    setScale(1)
  }

  // 模拟活动 Agent 的 Live 对话气泡
  useEffect(() => {
    if (!data) return
    const activeAgent = data.agents.find((a) => a.state !== 'idle')
    if (activeAgent) {
      const role = activeAgent.role as AgentRole
      const speeches: Record<AgentRole, string> = {
        sisyphus: '正在调度 Round 2 假说演化锦标赛控制流...',
        librarian: '已检索到 14 篇 SDO/AIA 日冕波阻尼文献，提取关键词...',
        explore: '正在运行 Python MHD 迭代，当前 F1Score = 0.89...',
        oracle: '已识别出模型在磁重联极化角上的偏差，提交突变策略...',
        prometheus: '构建 final MHD .cfg 仿真参数，生成卫星观测建议书...',
        looker: '对齐 SOHO/UVCS 图像与 MP4 演化视频特征...',
      }
      setActiveSpeech({ role, text: speeches[role] ?? '智能体协作思考中...' })
    }
  }, [data])

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      className={cn(
        'relative h-full w-full select-none overflow-hidden rounded-lg border border-[var(--color-border)] bg-[#08090d]',
        isDragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
    >
      {/* Dynamic Grid Background */}
      <div
        className="bg-grid pointer-events-none absolute inset-0 opacity-40 transition-transform duration-75"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      />

      {/* Top Toolbar */}
      <div className="absolute left-4 top-4 z-20 flex items-center gap-3 rounded-full border border-white/10 bg-black/70 px-4 py-2 backdrop-blur-md">
        <span className="font-mono text-xs uppercase tracking-[1.4px] text-white font-semibold">
          主界面 · 六大 AI 智能体拓扑与辩论场
        </span>
        <div className="h-3 w-px bg-white/20" />
        {selectedAgent ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase text-amber-400 font-bold">
              已聚焦: {selectedAgent.toUpperCase()}
            </span>
            <button
              type="button"
              onClick={() => onSelectAgent?.(null)}
              className="rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[9px] text-amber-300 hover:bg-amber-500/30"
            >
              显示全部
            </button>
          </div>
        ) : (
          <span className="font-mono text-[10px] uppercase text-white/50">
            点击球体聚焦右侧 Agent 输出 · 拖动手感平移
          </span>
        )}
        <button
          type="button"
          onClick={handleReset}
          className="ml-2 rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[10px] uppercase text-white/80 hover:bg-white/20"
        >
          重置视图
        </button>
      </div>

      {/* Main Stage */}
      <div
        className="relative flex h-full w-full items-center justify-center transition-transform duration-75"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        {/* Central Solar Core */}
        <div className="relative flex h-56 w-56 items-center justify-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 30, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
            className="absolute inset-0 rounded-full border border-dashed border-amber-500/30"
          />
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ duration: 20, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
            className="absolute inset-4 rounded-full border border-amber-400/20"
          />
          <div className="h-24 w-24 rounded-full bg-gradient-to-tr from-amber-600/40 via-orange-500/20 to-transparent blur-xl" />
          <div className="relative flex flex-col items-center text-center">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[2px] text-amber-400">
              Solar Core
            </span>
            <span className="mt-1 font-mono text-[11px] text-white/70">日冕加热演化核心</span>
          </div>
        </div>

        {/* 6 Glowing Agent Spheres */}
        {Object.entries(AGENT_CONFIGS).map(([roleKey, config]) => {
          const role = roleKey as AgentRole
          const angle = AGENT_ANGLES[role]
          const rad = (angle * Math.PI) / 180
          const radius = 240

          const sphereX = Math.cos(rad) * radius
          const sphereY = Math.sin(rad) * radius

          const agentData = data?.agents.find((a) => a.role === role)
          const state: AgentState = agentData?.state ?? 'idle'
          const isRunning = state !== 'idle'
          const isSelected = selectedAgent === role
          const isHovered = hoveredAgent === role
          const isSpeechActive = activeSpeech?.role === role

          return (
            <div
              key={role}
              style={{
                position: 'absolute',
                left: `calc(50% + ${sphereX}px)`,
                top: `calc(50% + ${sphereY}px)`,
                transform: 'translate(-50%, -50%)',
              }}
              className="relative z-10"
            >
              {/* Outer Pulsing Colored Aura Ring (思考/工具调用时激活) */}
              {isRunning && (
                <>
                  <motion.div
                    animate={{ scale: [1, 1.45, 1], opacity: [0.6, 0.1, 0.6] }}
                    transition={{
                      duration: 2,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: 'easeInOut',
                    }}
                    className="pointer-events-none absolute -inset-4 rounded-full border-2"
                    style={{ borderColor: config.color }}
                  />
                  <motion.div
                    animate={{ scale: [1, 1.25, 1], opacity: [0.8, 0.3, 0.8] }}
                    transition={{
                      duration: 1.5,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: 'easeInOut',
                    }}
                    className="pointer-events-none absolute -inset-2 rounded-full"
                    style={{
                      boxShadow: `0 0 24px ${config.color}`,
                    }}
                  />
                </>
              )}

              {/* Glowing Sphere Body */}
              <motion.button
                type="button"
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.95 }}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelectAgent?.(isSelected ? null : role)
                }}
                onMouseEnter={() => setHoveredAgent(role)}
                onMouseLeave={() => setHoveredAgent(null)}
                className={cn(
                  'group relative flex h-20 w-20 flex-col items-center justify-center rounded-full border-2 transition-all duration-300 shadow-2xl backdrop-blur-xl',
                  isSelected && 'ring-4 ring-amber-400/80 ring-offset-2 ring-offset-black',
                )}
                style={{
                  borderColor: isRunning || isSelected ? config.color : 'rgba(255,255,255,0.2)',
                  background: `radial-gradient(circle at 30% 30%, ${config.color}80, #0a0c14)`,
                  boxShadow: `0 0 25px ${isRunning ? config.color : `${config.color}40`}`,
                }}
              >
                <span className="text-xl">{config.icon}</span>
                <span className="font-mono text-[11px] font-bold uppercase tracking-[1px] text-white">
                  {config.name}
                </span>

                {/* Subtitle Badge */}
                <span
                  className={cn(
                    'mt-0.5 rounded-full px-1.5 py-0.2 font-mono text-[8px] font-semibold uppercase tracking-[0.5px]',
                    isRunning ? 'bg-amber-400 text-black font-bold' : 'bg-white/20 text-white/80',
                  )}
                >
                  {isRunning ? 'RUNNING' : 'IDLE'}
                </span>
              </motion.button>

              {/* Active Speech Bubble */}
              <AnimatePresence>
                {isSpeechActive && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.9 }}
                    className="absolute -top-16 left-1/2 z-30 w-56 -translate-x-1/2 rounded-lg border border-amber-400/50 bg-black/95 p-2 text-[11px] text-amber-200 shadow-2xl backdrop-blur-xl"
                  >
                    💬 {activeSpeech.text}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Hover Detailed Info Glass Card */}
              <AnimatePresence>
                {isHovered && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                    className="pointer-events-none absolute -bottom-36 left-1/2 z-40 w-64 -translate-x-1/2 rounded-xl border border-white/20 bg-black/90 p-3.5 shadow-2xl backdrop-blur-2xl"
                  >
                    <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                      <span className="font-mono text-xs font-bold" style={{ color: config.color }}>
                        {config.name}
                      </span>
                      <span className="font-mono text-[9px] uppercase text-white/50">
                        {state.toUpperCase()}
                      </span>
                    </div>
                    <div className="mt-1.5 font-medium text-xs text-white">{config.title}</div>
                    <p className="mt-1 text-[10px] leading-relaxed text-white/70">{config.desc}</p>
                    <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-1.5 font-mono text-[9px] text-white/50">
                      <span>STATUS</span>
                      <span className={isRunning ? 'text-amber-400 font-bold' : 'text-emerald-400'}>
                        {isRunning ? 'EXECUTING STEP' : 'READY'}
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default DebateTheater
