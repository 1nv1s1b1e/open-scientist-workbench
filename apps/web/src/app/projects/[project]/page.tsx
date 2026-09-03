'use client'
import type { PhenomenonInput } from '@open-scientist/schema'
import {
  ArrowLeft,
  GitBranch,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  ScrollText,
  Sparkles,
  Network,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChatPanel } from '@/components/chat/chat-panel'
import { ScientificWorkbench } from '@/components/workbench/scientific-workbench'
import {
  EvolutionTree,
  ScientificOrchestration,
  ScientificRelationMap,
  ScientificTrace,
} from '@/components/visualizers'
import type { RoundUpdateState, RunMessage } from '@/lib/hooks/useRunStream'
import type { UIMessageChunk } from '@/lib/types/sse-events'
import type { AgentRole, AgentState } from '@/lib/types/visualizers'
import { WorkflowRuntimeProvider, type ExecutionMode } from '@/lib/chat/workflow-runtime'
import { emptyScientificWorkbenchState, type ScientificWorkbenchState } from '@/lib/workbench/state'
import {
  DEMO_AGENT_STATES,
  DEMO_PHENOMENON,
  DEMO_SCIENTIFIC_STATE,
} from '@/lib/workbench/demo-data'

type View = 'workbench' | 'orchestration' | 'trace' | 'concept-net' | 'evolution'

export default function ProjectRunPage() {
  const params = useParams<{ project: string }>()
  const project = decodeURIComponent(params.project)
  const demoProject = project === 'coronal-heating-demo'
  const [view, setView] = useState<View>('workbench')
  const [chatCollapsed, setChatCollapsed] = useState(true)
  const [desktopChatCollapsed, setDesktopChatCollapsed] = useState(false)
  const [phenomenon, setPhenomenon] = useState<PhenomenonInput | undefined>(() =>
    demoProject ? DEMO_PHENOMENON : undefined,
  )
  const [maxRounds, setMaxRounds] = useState(2)
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('model-assisted')
  const [scientificState, setScientificState] = useState<ScientificWorkbenchState>(() =>
    demoProject ? DEMO_SCIENTIFIC_STATE : emptyScientificWorkbenchState(),
  )
  const [streamState, setStreamState] = useState('idle')
  const [runId, setRunId] = useState<string | null>(null)
  const [agentStates, setAgentStates] = useState<Partial<Record<AgentRole, AgentState>>>(() =>
    demoProject ? DEMO_AGENT_STATES : {},
  )
  const [roundUpdate, setRoundUpdate] = useState<RoundUpdateState>(null)
  const [messages, setMessages] = useState<RunMessage[]>([])
  const [runChunks, setRunChunks] = useState<UIMessageChunk[]>([])
  const [selectedAgent, setSelectedAgent] = useState<AgentRole | null>(null)
  const [selectedRound, setSelectedRound] = useState<number | null>(null)
  const [selectedHypoId, setSelectedHypoId] = useState<string | null>(null)

  useEffect(() => {
    setView('workbench')
    setChatCollapsed(true)
    setDesktopChatCollapsed(false)
    setPhenomenon(demoProject ? DEMO_PHENOMENON : undefined)
    setScientificState(demoProject ? DEMO_SCIENTIFIC_STATE : emptyScientificWorkbenchState())
    setStreamState('idle')
    setRunId(null)
    setAgentStates(demoProject ? DEMO_AGENT_STATES : {})
    setRoundUpdate(null)
    setMessages([])
    setRunChunks([])
    setSelectedAgent(null)
    setSelectedRound(null)
    setSelectedHypoId(null)
  }, [project, demoProject])

  const available = useMemo(() => {
    const rounds = new Set<number>()
    const hypos = new Map<string, number>()
    for (const message of messages) {
      if (message.round != null) rounds.add(message.round)
      if (message.hypoId && message.round != null) hypos.set(message.hypoId, message.round)
    }
    return {
      rounds: [...rounds].sort((a, b) => a - b),
      hypos: [...hypos].map(([id, round]) => ({ id, round })),
    }
  }, [messages])

  const onRoundUpdate = useCallback((value: RoundUpdateState) => setRoundUpdate(value), [])
  const onMessages = useCallback((value: RunMessage[]) => setMessages(value), [])
  const onChunks = useCallback((value: UIMessageChunk[]) => setRunChunks(value), [])
  const onAgents = useCallback((value: Partial<Record<AgentRole, AgentState>>) => {
    setAgentStates(value)
  }, [])
  const onScientific = useCallback((value: ScientificWorkbenchState) => {
    setScientificState(value)
  }, [])

  const onRunIdChange = useCallback((value: string | null) => {
    setRunId(value)
  }, [])

  const onStreamStateChange = useCallback((value: string) => {
    setStreamState(value)
    if (['connecting', 'running', 'streaming', 'reconnecting'].includes(value))
      setChatCollapsed(false)
  }, [])

  const consoleStatus = ['connecting', 'running', 'streaming', 'reconnecting'].includes(streamState)
    ? '运行中'
    : messages.length > 0 || runId
      ? `第 ${Math.max(roundUpdate?.round ?? scientificState.round ?? 1, 1)} 轮`
      : '待命'

  return (
    <WorkflowRuntimeProvider
      key={project}
      project={project}
      phenomenon={phenomenon}
      initialScientificState={demoProject ? DEMO_SCIENTIFIC_STATE : undefined}
      initialAgentStates={demoProject ? DEMO_AGENT_STATES : undefined}
      skipHistoryLoad={demoProject}
      maxRounds={maxRounds}
      executionMode={executionMode}
      selectedAgent={selectedAgent}
      selectedRound={selectedRound}
      selectedHypoId={selectedHypoId}
      onRunIdChange={onRunIdChange}
      onStateChange={onStreamStateChange}
      onAgentStatesChange={onAgents}
      onRoundUpdateChange={onRoundUpdate}
      onMessagesChange={onMessages}
      onChunksChange={onChunks}
      onScientificStateChange={onScientific}
    >
      <div className="project-page flex h-screen flex-col overflow-hidden bg-[var(--color-bg)] text-white">
        <header className="project-header flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] bg-[#0d1116]/90 px-4 py-2.5 backdrop-blur-xl md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)] transition-colors hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              项目
            </Link>
            <span className="text-white/20">/</span>
            <span className="truncate font-mono text-[12px] uppercase tracking-[0.12em] text-white">
              {project}
            </span>
          </div>
          <nav
            className="project-view-nav flex items-center gap-1 overflow-x-auto rounded-full border border-white/[0.08] bg-black/20 p-1"
            aria-label="科学视图"
          >
            {[
              { id: 'workbench' as const, label: '科学工作台', icon: Sparkles },
              { id: 'orchestration' as const, label: '智能体编排', icon: GitBranch },
              { id: 'trace' as const, label: '\u6267\u884c\u8f68\u8ff9', icon: ScrollText },
              { id: 'concept-net' as const, label: '概念网络', icon: Network },
              { id: 'evolution' as const, label: '假设演化树', icon: GitBranch },
            ].map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={`relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] transition-colors ${view === item.id ? 'text-[#0a0a0a]' : 'text-[var(--color-text-muted)] hover:text-white'}`}
                >
                  {view === item.id && (
                    <motion.span
                      layoutId="project-view-pill"
                      className="absolute inset-0 rounded-full bg-white"
                    />
                  )}
                  <Icon className="relative z-10 h-3.5 w-3.5" />
                  <span className="relative z-10">{item.label}</span>
                </button>
              )
            })}
          </nav>
          <button
            type="button"
            onClick={() => setChatCollapsed((value) => !value)}
            className={`console-toggle md:hidden ${!chatCollapsed ? 'console-toggle-open' : ''}`}
            aria-expanded={!chatCollapsed}
            aria-controls="project-run-console"
          >
            <span
              className={`console-toggle-dot ${consoleStatus === '运行中' ? 'console-toggle-dot-live' : ''}`}
            />
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="console-toggle-label">运行控制台</span>
            <span className="console-toggle-status">{consoleStatus}</span>
            {chatCollapsed ? (
              <PanelRightOpen className="h-3.5 w-3.5" />
            ) : (
              <PanelRightClose className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setDesktopChatCollapsed((value) => !value)}
            className={`console-toggle hidden md:inline-flex ${!desktopChatCollapsed ? 'console-toggle-open' : ''}`}
            aria-expanded={!desktopChatCollapsed}
            aria-controls="project-run-console"
            aria-label={desktopChatCollapsed ? '展开运行控制台' : '收回运行控制台'}
          >
            <span
              className={`console-toggle-dot ${consoleStatus === '运行中' ? 'console-toggle-dot-live' : ''}`}
            />
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="console-toggle-label">运行控制台</span>
            <span className="console-toggle-status">{consoleStatus}</span>
            {desktopChatCollapsed ? (
              <PanelRightOpen className="h-3.5 w-3.5" />
            ) : (
              <PanelRightClose className="h-3.5 w-3.5" />
            )}
          </button>
        </header>

        <div className="relative flex min-h-0 flex-1">
          <main
            className={`h-full min-h-0 min-w-0 flex-1 overflow-hidden ${desktopChatCollapsed ? 'project-main-console-collapsed' : 'project-main-console-open'}`}
          >
            <AnimatePresence initial={false}>
              {view === 'workbench' && (
                <motion.div
                  key="workbench"
                  className="h-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <ScientificWorkbench
                    state={scientificState}
                    streamState={streamState}
                    agentStates={agentStates}
                    runId={runId}
                    maxRounds={maxRounds}
                    onMaxRoundsChange={setMaxRounds}
                    executionMode={executionMode}
                    onExecutionModeChange={setExecutionMode}
                  />
                </motion.div>
              )}
              {view === 'orchestration' && (
                <motion.div
                  key="orchestration"
                  className="h-full overflow-y-auto p-4 md:p-5"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <ScientificOrchestration
                    state={scientificState.orchestration}
                    isDemo={demoProject}
                    selectedAgent={selectedAgent}
                    onSelectAgent={(role) => {
                      setSelectedAgent(role)
                      if (role) setChatCollapsed(false)
                    }}
                  />
                </motion.div>
              )}
              {view === 'trace' && (
                <motion.div
                  key="trace"
                  className="h-full overflow-y-auto p-4 md:p-5"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <ScientificTrace
                    chunks={runChunks}
                    state={scientificState}
                    runId={runId}
                    streamState={streamState}
                  />
                </motion.div>
              )}
              {view === 'evolution' && (
                <motion.div
                  key="evolution"
                  className="h-full overflow-y-auto p-4"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <EvolutionTree state={scientificState} />
                </motion.div>
              )}
              {view === 'concept-net' && (
                <motion.div
                  key="concept-net"
                  className="h-full overflow-y-auto p-4"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <ScientificRelationMap state={scientificState} />
                </motion.div>
              )}
            </AnimatePresence>
          </main>

          <AnimatePresence initial={false}>
            {!chatCollapsed && (
              <motion.button
                type="button"
                aria-label="关闭运行控制台"
                onClick={() => setChatCollapsed(true)}
                className="console-backdrop md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            )}
          </AnimatePresence>

          <aside
            id="project-run-console"
            className={`project-console ${chatCollapsed ? 'project-console-collapsed' : ''} ${desktopChatCollapsed ? 'project-console-desktop-collapsed' : ''}`}
          >
            <ChatPanel
              project={project}
              phenomenon={phenomenon}
              readOnly={demoProject}
              onPhenomenonChange={setPhenomenon}
              maxRounds={maxRounds}
              executionMode={executionMode}
              selectedAgent={selectedAgent}
              onSelectAgent={setSelectedAgent}
              onRunIdChange={onRunIdChange}
              onStateChange={onStreamStateChange}
              onAgentStatesChange={onAgents}
              onRoundUpdateChange={onRoundUpdate}
              onMessagesChange={onMessages}
              onScientificStateChange={onScientific}
              selectedRound={selectedRound}
              selectedHypoId={selectedHypoId}
              onSelectRoundHypo={(round, hypoId) => {
                setSelectedRound(round)
                setSelectedHypoId(hypoId)
              }}
              availableRounds={available.rounds}
              availableHypos={available.hypos}
              runtimeProvided
            />
          </aside>
        </div>
      </div>
    </WorkflowRuntimeProvider>
  )
}
