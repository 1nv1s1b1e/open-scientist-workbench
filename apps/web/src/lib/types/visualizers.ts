/**
 * 可视化数据类型 — 三个 WOW 效果 + 协作大厅的输入数据形状。
 *
 * 这些类型由 lib/visualizers/*-data.ts 从后端数据转换得到，供 components/visualizers/* 消费。
 */

import type { Hypothesis } from '@open-scientist/schema'

// ---------------------------------------------------------------------------
// WOW #1: 3D 知识图谱
// ---------------------------------------------------------------------------

export interface ConceptNode {
  id: string
  label: string
  /** 物理概念分类，决定节点配色 */
  category: ConceptCategory
  /** 关联的假设 id（如果有） */
  hypothesisId?: string
  /** 节点状态：active 高亮 / faded 淡出（假设被淘汰时） */
  state: 'active' | 'faded'
  /** 可选描述，点击节点 popover 展示 */
  description?: string
}

export type ConceptCategory = 'magnetic' | 'thermodynamics' | 'waves' | 'reconnection' | 'other'

export interface ConceptLink {
  source: string
  target: string
  /** 边类型，决定颜色 */
  kind: 'supports' | 'contradicts' | 'extends' | 'references'
}

export interface ConceptNetData {
  nodes: ConceptNode[]
  links: ConceptLink[]
}

// ---------------------------------------------------------------------------
// WOW #2 + 协作大厅: 6 agent 协作拓扑
// ---------------------------------------------------------------------------

export type AgentRole = 'sisyphus' | 'librarian' | 'looker' | 'explore' | 'oracle' | 'prometheus'

export type AgentState = 'idle' | 'thinking' | 'executing-tool' | 'waiting-approval' | 'error'

export interface AgentNodeData {
  role: AgentRole
  label: string
  state: AgentState
  /** 当前 token 使用量（用于环形进度） */
  tokenUsage?: number
  tokenLimit?: number
  /** 最新输出摘要（hover 展开详情） */
  latestOutputSummary?: string
  /** 正在执行的 tool 名 */
  currentTool?: string
  /** React Flow v12 要求 data 满足 Record<string, unknown> 索引签名 */
  [key: string]: unknown
}

export type MessageEdgeKind = 'collab' | 'critique' | 'new-hypothesis' | 'approval' | 'steering'

export interface MessageEdgeData {
  source: AgentRole
  target: AgentRole
  kind: MessageEdgeKind
  /** 脉冲粒子动画是否激活 */
  active: boolean
  /** 最近一条消息摘要 */
  label?: string
}

export interface OrchestratorData {
  agents: AgentNodeData[]
  edges: MessageEdgeData[]
}

// ---------------------------------------------------------------------------
// WOW #3: 假说演化树
// ---------------------------------------------------------------------------

export type HypothesisTreeNodeStatus = 'alive' | 'withered' | 'winner'

export interface HypothesisTreeNode {
  hypothesis: Hypothesis
  status: HypothesisTreeNodeStatus
  /** 突变来源（parent → child 的 rationale） */
  mutationRationale?: string
  /** 批判摘要 */
  critiqueSummary?: string
  children: HypothesisTreeNode[]
}

export interface EvolutionTreeData {
  root: HypothesisTreeNode | null
  /** 当前轮次（用于触发新分支生长动画） */
  currentRound: number
}
