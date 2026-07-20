'use client'

import {
  ArrowLeft,
  GitBranch,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Users,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { ChatPanel } from '@/components/chat/chat-panel'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ConceptNet3D,
  DebateTheater,
  EvolutionTree,
  OrchestratorHall,
} from '@/components/visualizers/index'
import { cn } from '@/lib/utils/cn'
import { buildInitialOrchestratorData } from '@/lib/visualizers/index'

type View = 'orchestrator' | 'concept-net' | 'evolution-tree' | 'debate-theater'

const VIEWS: { id: View; label: string; icon: typeof Network }[] = [
  { id: 'orchestrator', label: '协作大厅', icon: Users },
  { id: 'concept-net', label: '知识图谱', icon: Network },
  { id: 'evolution-tree', label: '演化树', icon: GitBranch },
  { id: 'debate-theater', label: '辩论剧场', icon: Sparkles },
]

const viewVariants = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 1.02 },
}

export default function ProjectRunPage() {
  const params = useParams<{ project: string }>()
  const project = decodeURIComponent(params.project)
  const [view, setView] = useState<View>('orchestrator')
  const [chatCollapsed, setChatCollapsed] = useState(false)

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)]">
      {/* ── Top banner — slim, with project label + view switch ──────────────── */}
      <header className="relative shrink-0 overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        {/* Radial sunset glow */}
        <div className="bg-radial-sunset pointer-events-none absolute inset-0 opacity-50" />
        {/* Top hairline */}
        <div className="accent-line-top pointer-events-none absolute inset-x-0 top-0" />

        <div className="relative z-10 flex items-center justify-between px-4 py-2.5">
          {/* Left — breadcrumb */}
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/"
                  className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[1.2px] text-muted transition-colors hover:text-white"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Projects
                </Link>
              </TooltipTrigger>
              <TooltipContent>返回项目列表</TooltipContent>
            </Tooltip>
            <span className="text-muted">/</span>
            <motion.span
              key={project}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="font-mono text-[12px] uppercase tracking-[1.4px] text-white"
            >
              {project}
            </motion.span>
          </div>

          {/* Center — view switch pills */}
          <div className="flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] p-1">
            {VIEWS.map((v) => {
              const Icon = v.icon
              const active = view === v.id
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className={cn(
                    'relative flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-normal transition-colors',
                    active ? 'text-[#0a0a0a]' : 'text-muted hover:text-white',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="view-pill"
                      className="absolute inset-0 rounded-full bg-white"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <Icon className="relative z-10 h-3.5 w-3.5" />
                  <span className="relative z-10">{v.label}</span>
                </button>
              )
            })}
          </div>

          {/* Right — collapse toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setChatCollapsed((c) => !c)}
                className="rounded-full border border-[var(--color-border)] p-2 text-muted transition-colors hover:border-white/30 hover:text-white"
              >
                {chatCollapsed ? (
                  <PanelRightOpen className="h-4 w-4" />
                ) : (
                  <PanelRightClose className="h-4 w-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>{chatCollapsed ? '展开对话面板' : '收起对话面板'}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* ── Main split — visualizer + chat ──────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <main className="relative flex-1 overflow-hidden p-4">
          {/* Subtle grid background for visualizers */}
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-30" />
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              variants={viewVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="relative h-full w-full"
            >
              {view === 'orchestrator' && (
                <OrchestratorHall data={buildInitialOrchestratorData()} />
              )}
              {view === 'concept-net' && <ConceptNet3D />}
              {view === 'evolution-tree' && <EvolutionTree />}
              {view === 'debate-theater' && <DebateTheater data={buildInitialOrchestratorData()} />}
            </motion.div>
          </AnimatePresence>
        </main>

        <AnimatePresence initial={false}>
          {!chatCollapsed && (
            <motion.aside
              key="chat-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 420, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="shrink-0 overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)]"
            >
              <div className="h-full w-[420px]">
                <ChatPanel project={project} />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
