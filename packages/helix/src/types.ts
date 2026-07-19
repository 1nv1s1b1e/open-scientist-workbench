// HelixDB 节点类型定义（与 queries.ts 投影一致）

export interface PaperNode {
  id: string
  title: string
  abstract?: string
  authors: string[]
  year: number
  doi?: string
  embedding?: number[]
}

export interface HypothesisNode {
  id: string
  statement: string
  roundId: number
  runId: string
  f1Score: number
  embedding?: number[]
  createdAt: string
}

export interface EvidenceNode {
  id: string
  hypothesisId: string
  type: 'support' | 'contradict'
  content: string
  f1Score: number
  fitsPaths: string[]
  videoPath?: string
  createdAt: string
}

export interface CritiqueNode {
  id: string
  hypothesisId: string
  content: string
  severity: 'low' | 'medium' | 'high'
  mutationType?: string
  createdAt: string
}

export interface ConceptNode {
  id: string
  name: string
  description?: string
}

export interface SnapshotNode {
  id: string
  roundId: number
  runId: string
  hypothesisIds: string[]
  createdAt: string
}

// 边类型
export type EdgeLabel =
  | 'CITES'
  | 'SUPPORTED_BY'
  | 'CONTRADICTED_BY'
  | 'CRITIQUED_BY'
  | 'INVOLVES'
  | 'MUTATED_FROM'
  | 'CAPTURED_IN'

// 节点 label
export type NodeLabel = 'Paper' | 'Hypothesis' | 'Evidence' | 'Critique' | 'Concept' | 'Snapshot'
