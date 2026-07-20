import { create } from 'zustand'
import type { RunStatus } from '@/lib/api/client'

/**
 * Run 主界面状态（见 docs/web/02-architecture.md §状态管理）。
 * 只放 UI 状态，业务数据走 TanStack Query。
 */
export type RunView = 'concept-net' | 'debate-theater' | 'evolution-tree' | 'orchestrator'

interface RunState {
  // 当前 run 标识
  runId: string | null
  status: RunStatus | null
  currentRound: number
  bestF1: number
  selectedHypothesisId: string | null

  // UI 状态
  activeView: RunView
  chatCollapsed: boolean

  // Actions
  setRunId: (id: string | null) => void
  setStatus: (status: RunStatus | null) => void
  setRound: (round: number) => void
  setBestF1: (f1: number) => void
  selectHypothesis: (id: string | null) => void
  setActiveView: (view: RunView) => void
  toggleChat: () => void
  reset: () => void
}

export const useRunStore = create<RunState>((set) => ({
  runId: null,
  status: null,
  currentRound: 0,
  bestF1: 0,
  selectedHypothesisId: null,
  activeView: 'orchestrator',
  chatCollapsed: false,

  setRunId: (id) => set({ runId: id }),
  setStatus: (status) => set({ status }),
  setRound: (round) => set({ currentRound: round }),
  setBestF1: (f1) => set({ bestF1: f1 }),
  selectHypothesis: (id) => set({ selectedHypothesisId: id }),
  setActiveView: (view) => set({ activeView: view }),
  toggleChat: () => set((s) => ({ chatCollapsed: !s.chatCollapsed })),
  reset: () =>
    set({
      runId: null,
      status: null,
      currentRound: 0,
      bestF1: 0,
      selectedHypothesisId: null,
      activeView: 'orchestrator',
      chatCollapsed: false,
    }),
}))
