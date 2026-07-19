// HelixDB 节点/边类型定义
export interface PaperNode {
  id: string
  title: string
  abstract?: string
  embedding?: number[]
}

export interface HypothesisNode {
  id: string
  statement: string
  pythonCode: string
  embedding?: number[]
}

export interface EvidenceNode {
  id: string
  hypoId: string
  f1: number
  fitsPaths: string[]
}

export interface CritiqueNode {
  id: string
  hypoId: string
  text: string
  severity: string
}

export interface ConceptNode {
  id: string
  name: string
  description?: string
}

export interface SnapshotNode {
  id: string
  activeRegion: string
  timestamp: string
  wavelength: string
}
