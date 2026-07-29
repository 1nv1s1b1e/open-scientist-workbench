/**
 * HelixDB 图谱 / 假设池 → 概念网络数据转换。
 */

import type { RoundUpdatePayload } from '@/lib/types/sse-events'
import type { ConceptCategory, ConceptNetData } from '@/lib/types/visualizers'

/** 关键词 → ConceptCategory 简易分类 */
export function classifyConcept(text: string): ConceptCategory {
  const lower = text.toLowerCase()
  if (/(magnet|field|flux|光球|磁场|剪切)/.test(lower)) return 'magnetic'
  if (/(heat|thermal|temperature|热|等离子体)/.test(lower)) return 'thermodynamics'
  if (/(wave|alfvén|alfven|mhd|波|回旋)/.test(lower)) return 'waves'
  if (/(reconnect|nanoflare|耀斑|重联)/.test(lower)) return 'reconnection'
  return 'other'
}

/** 空状态（无 run 数据时显示） */
export const EMPTY_CONCEPT_NET: ConceptNetData = {
  nodes: [],
  links: [],
}

/**
 * Build a ConceptNetData from a round-update payload.
 *
 * Each hypothesis becomes a node (label = truncated statement).
 * Parent-child relationships (mutations) become 'extends' links.
 * Hypotheses in the same round with different parentage form 'contradicts' links.
 * Eliminated hypotheses are 'faded', alive/winner are 'active'.
 */
export function buildConceptNet(update: RoundUpdatePayload): ConceptNetData {
  const { hypotheses } = update

  if (hypotheses.length === 0) {
    return { nodes: [], links: [] }
  }

  // Build nodes — one per hypothesis
  const nodes = hypotheses.map((h) => {
    const label = h.statement.length > 40 ? h.statement.slice(0, 37) + '...' : h.statement
    return {
      id: h.id,
      label,
      category: classifyConcept(h.statement),
      hypothesisId: h.id,
      state: h.status === 'eliminated' ? ('faded' as const) : ('active' as const),
      description: h.statement,
    }
  })

  // Build links
  const links: ConceptNetData['links'] = []

  // Mutation links: parent → child (extends)
  for (const h of hypotheses) {
    if (h.parentId !== null) {
      const parentExists = hypotheses.some((p) => p.id === h.parentId)
      if (parentExists) {
        links.push({
          source: h.parentId,
          target: h.id,
          kind: 'extends' as const,
        })
      }
    }
  }

  // Sibling links: hypotheses in the same round with different parents
  // form 'contradicts' links (competing approaches)
  const byRound = new Map<number, typeof hypotheses>()
  for (const h of hypotheses) {
    const arr = byRound.get(h.round) ?? []
    arr.push(h)
    byRound.set(h.round, arr)
  }
  for (const [, roundHypos] of byRound) {
    if (roundHypos.length <= 1) continue
    for (let i = 0; i < roundHypos.length; i++) {
      for (let j = i + 1; j < roundHypos.length; j++) {
        const a = roundHypos[i]!
        const b = roundHypos[j]!
        // Only link if they have different parents (competing branches)
        if (a.parentId !== b.parentId) {
          links.push({
            source: a.id,
            target: b.id,
            kind: 'contradicts' as const,
          })
        }
      }
    }
  }

  return { nodes, links }
}
