'use client'

import {
  ArrowLeft,
  GitBranch,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { ChatPanel } from '@/components/chat/chat-panel'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConceptNet3D, DebateTheater, EvolutionTree } from '@/components/visualizers/index'
import type { RoundUpdateState } from '@/lib/hooks/useRunStream'
import type { RunMessage } from '@/lib/hooks/useRunStream'
import type { AgentRole, AgentState, OrchestratorData } from '@/lib/types/visualizers'
import { cn } from '@/lib/utils/cn'
import { buildInitialOrchestratorData } from '@/lib/visualizers/index'
import { buildConceptNet, EMPTY_CONCEPT_NET } from '@/lib/visualizers/concept-net-data'
import { buildEvolutionTree, EMPTY_EVOLUTION_TREE } from '@/lib/visualizers/evolution-tree-data'

type View = 'debate-theater' | 'concept-net' | 'evolution-tree'

const VIEWS: { id: View; label: string; icon: typeof Sparkles }[] = [
  { id: 'debate-theater', label: '辩论剧场', icon: Sparkles },
  { id: 'concept-net', label: '知识图谱', icon: Network },
  { id: 'evolution-tree', label: '演化树', icon: GitBranch },
]

const viewVariants = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 1.02 },
}

export default function ProjectRunPage() {
  const params = useParams<{ project: string }>()
  const project = decodeURIComponent(params.project)
  const [view, setView] = useState<View>('debate-theater')
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [agentStates, setAgentStates] = useState<Partial<Record<AgentRole, AgentState>>>({})
  const [selectedAgent, setSelectedAgent] = useState<AgentRole | null>(null)
  const [roundUpdate, setRoundUpdate] = useState<RoundUpdateState>(null)
  const [messages, setMessages] = useState<RunMessage[]>([])
  const [selectedRound, setSelectedRound] = useState<number | null>(null)
  const [selectedHypoId, setSelectedHypoId] = useState<string | null>(null)

  const handleAgentStatesChange = useCallback(
    (states: Partial<Record<AgentRole, AgentState>>) => setAgentStates(states),
    [],
  )
  const handleRoundUpdateChange = useCallback((update: RoundUpdateState) => {
    setRoundUpdate(update)
  }, [])
  const handleMessagesChange = useCallback((msgs: RunMessage[]) => setMessages(msgs), [])

  // 从消息中提取可用轮次和假设（供轮次-假设选择器使用）
  const { availableRounds, availableHypos } = useMemo(() => {
    const roundSet = new Set<number>()
    const hypoMap = new Map<string, number>()
    for (const msg of messages) {
      if (msg.round != null) roundSet.add(msg.round)
      if (msg.hypoId && msg.round != null) hypoMap.set(msg.hypoId, msg.round)
    }
    return {
      availableRounds: Array.from(roundSet).sort((a, b) => a - b),
      availableHypos: Array.from(hypoMap.entries()).map(([id, round]) => ({ id, round })),
    }
  }, [messages])

  // Build live orchestrator data from agent states
  const orchestratorData: OrchestratorData = useMemo(() => {
    const base = buildInitialOrchestratorData()
    return {
      ...base,
      agents: base.agents.map((agent) => ({
        ...agent,
        state: agentStates[agent.role] ?? 'idle',
      })),
    }
  }, [agentStates])

  // Build evolution tree from real run data
  const evolutionTreeData = useMemo(() => {
    if (roundUpdate) return buildEvolutionTree(roundUpdate)
    return EMPTY_EVOLUTION_TREE
  }, [roundUpdate])

  // Build concept net from real run data
  const conceptNetData = useMemo(() => {
    if (roundUpdate) return buildConceptNet(roundUpdate)
    return EMPTY_CONCEPT_NET
  }, [roundUpdate])

  // Extract latest text snippet from the currently-running agent for the speech bubble
  const activeSpeech = useMemo(() => {
    const activeAgent = Object.entries(agentStates).find(([, s]) => s !== 'idle')
    if (!activeAgent) return null
    const [role] = activeAgent as [AgentRole, AgentState]
    // Find the latest message from this agent that has text content
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!
      if (msg.agentRole !== role) continue
      const textPart = msg.parts.find((p) => p.kind === 'text' && p.text)
      if (textPart?.text) {
        const snippet =
          textPart.text.length > 80 ? textPart.text.slice(0, 77) + '...' : textPart.text
        return { role, text: snippet }
      }
    }
    return { role, text: '正在思考中...' }
  }, [agentStates, messages])

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)]">
      {/* ── Top banner — slim, with project label + view switch ──────────────── */}
      <header className="relative shrink-0 overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
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
                    'relative flex items-center gap-1.5 rounded-full px-3.5 py-1 text-[12px] font-medium transition-colors',
                    active ? 'text-[#0a0a0a]' : 'text-muted hover:text-white',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="view-pill"
                      className="absolute inset-0 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.4)]"
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
              {view === 'debate-theater' && (
                <DebateTheater
                  data={orchestratorData}
                  selectedAgent={selectedAgent}
                  onSelectAgent={setSelectedAgent}
                  activeSpeech={activeSpeech}
                />
              )}
              {view === 'concept-net' && <ConceptNet3D data={conceptNetData} />}
              {view === 'evolution-tree' && <EvolutionTree data={evolutionTreeData} />}
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
                <ChatPanel
                  project={project}
                  selectedAgent={selectedAgent}
                  onSelectAgent={setSelectedAgent}
                  onAgentStatesChange={handleAgentStatesChange}
                  onRoundUpdateChange={handleRoundUpdateChange}
                  onMessagesChange={handleMessagesChange}
                  selectedRound={selectedRound}
                  selectedHypoId={selectedHypoId}
                  onSelectRoundHypo={(r, h) => {
                    setSelectedRound(r)
                    setSelectedHypoId(h)
                  }}
                  availableRounds={availableRounds}
                  availableHypos={availableHypos}
                />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
