import type { AgentRole, ConceptCategory } from '@/lib/types/visualizers'

/** Agent 配色常量（见 docs/web/03-visualizers.md §视觉风格） */
export const AGENT_COLORS: Record<AgentRole, string> = {
  sisyphus: '#3b82f6',
  librarian: '#10b981',
  looker: '#06b6d4',
  explore: '#8b5cf6',
  oracle: '#ef4444',
  prometheus: '#f59e0b',
}

export const AGENT_LABELS: Record<AgentRole, string> = {
  sisyphus: 'Sisyphus',
  librarian: 'Librarian',
  looker: 'Looker',
  explore: 'Explore',
  oracle: 'Oracle',
  prometheus: 'Prometheus',
}

export const AGENT_ROLES: AgentRole[] = [
  'sisyphus',
  'librarian',
  'looker',
  'explore',
  'oracle',
  'prometheus',
]

export const CONCEPT_COLORS: Record<ConceptCategory, string> = {
  magnetic: '#3b82f6',
  thermodynamics: '#ef4444',
  waves: '#10b981',
  reconnection: '#f59e0b',
  other: '#8b5cf6',
}
