/**
 * hypotheses + mutations + critiques → tree data 转换。
 */

import type { Hypothesis } from '@open-scientist/schema'
import type { RoundUpdatePayload } from '@/lib/types/sse-events'
import type {
  EvolutionTreeData,
  HypothesisTreeNode,
  HypothesisTreeNodeStatus,
} from '@/lib/types/visualizers'

/** 空状态（无 run 数据时显示） */
export const EMPTY_EVOLUTION_TREE: EvolutionTreeData = {
  root: null,
  currentRound: 0,
}

/** Map hypothesis status → tree node status */
function hypoStatusToTreeStatus(status: string): HypothesisTreeNodeStatus {
  if (status === 'winner') return 'winner'
  if (status === 'eliminated') return 'withered'
  return 'alive'
}

/**
 * Build an EvolutionTreeData from a round-update payload.
 *
 * The hypotheses array is a flat list with `parentId` forming the tree.
 * We find the root (parentId === null) and recursively build children.
 */
export function buildEvolutionTree(update: RoundUpdatePayload): EvolutionTreeData {
  const { round, hypotheses } = update

  if (hypotheses.length === 0) {
    return { root: null, currentRound: round }
  }

  // Build a map of id → hypothesis for O(1) lookup
  const hypoMap = new Map<string, (typeof hypotheses)[number]>()
  for (const h of hypotheses) {
    hypoMap.set(h.id, h)
  }

  // Find root(s) — parentId === null
  const roots = hypotheses.filter((h) => h.parentId === null)
  if (roots.length === 0) {
    // No root found — treat the first hypothesis as root
    roots.push(hypotheses[0]!)
  }

  // Recursively build tree from a hypothesis
  function buildNode(h: NonNullable<(typeof hypotheses)[number]>): HypothesisTreeNode {
    const children = hypotheses.filter((child) => child.parentId === h.id)
    return {
      hypothesis: {
        id: h.id,
        statement: h.statement,
        pythonCode: '',
        parentId: h.parentId,
        round: h.round,
        f1: h.f1,
        status: h.status as Hypothesis['status'],
        createdAt: h.createdAt,
      },
      status: hypoStatusToTreeStatus(h.status),
      children: children.map((c) => buildNode(c!)),
    }
  }

  // If multiple roots, create a synthetic root wrapping them
  if (roots.length === 1) {
    return {
      root: buildNode(roots[0]!),
      currentRound: round,
    }
  }

  // Multiple roots — synthetic root
  return {
    root: {
      hypothesis: {
        id: '__root__',
        statement: 'Tournament Seed Pool',
        pythonCode: '',
        parentId: null,
        round: 1,
        f1: null,
        status: 'candidate',
        createdAt: roots[0]!.createdAt,
      },
      status: 'alive',
      children: roots.map(buildNode),
    },
    currentRound: round,
  }
}
