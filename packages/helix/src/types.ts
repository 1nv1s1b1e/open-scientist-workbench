// HelixDB 节点类型定义（与 queries.ts 投影一致）
// id 由 Projection.expr('id', Expr.id()) 投影，HelixDB 返回 i64 → JS number。

export interface PaperNode {
  id: number
  title: string
  abstract?: string
  authors: string[]
  year: number
  doi?: string
  embedding?: number[]
}

export interface HypothesisNode {
  id: number
  statement: string
  roundId: number
  runId: string
  f1Score: number
  embedding?: number[]
  createdAt: string
}

export interface EvidenceNode {
  id: number
  hypothesisId: number
  type: 'support' | 'contradict'
  content: string
  f1Score: number
  fitsPaths: string[]
  videoPath?: string
  createdAt: string
}

export interface CritiqueNode {
  id: number
  hypothesisId: number
  content: string
  severity: 'low' | 'medium' | 'high'
  mutationType?: string
  createdAt: string
}

export interface ConceptNode {
  id: number
  name: string
  description?: string
}

export interface SnapshotNode {
  id: number
  roundId: number
  runId: string
  hypothesisIds: number[]
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
