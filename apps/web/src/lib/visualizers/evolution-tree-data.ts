/**
 * hypotheses + mutations + critiques → d3-hierarchy 树数据转换。
 *
 * 数据来源：当前后端未暴露 hypotheses/mutations/critiques REST 端点
 * （见 05-api-contracts.md §11 TODO #3），暂从 SSE 流的 tool-output 提取。
 */

import type { Critique, Hypothesis, Mutation } from '@open-scientist/schema'
import type {
  EvolutionTreeData,
  HypothesisTreeNode,
  HypothesisTreeNodeStatus,
} from '@/lib/types/visualizers'

function resolveStatus(
  hypo: Hypothesis,
  eliminatedIds: string[],
  winningHypoId: string | null,
): HypothesisTreeNodeStatus {
  if (winningHypoId === hypo.id) return 'winner'
  if (eliminatedIds.includes(hypo.id) || hypo.status === 'eliminated') return 'withered'
  return 'alive'
}

interface BuildInput {
  hypotheses: Hypothesis[]
  mutations: Mutation[]
  critiques: Critique[]
  eliminatedIds: string[]
  winningHypoId: string | null
  currentRound: number
}

/**
 * 从平铺的 hypotheses + mutations 构建 evolution tree。
 * root = round 1 的 seed（parentId === null）；其余按 parentId 链接。
 * mutations 提供突变 rationale，critiques 提供批判摘要。
 */
export function buildEvolutionTree(input: BuildInput): EvolutionTreeData {
  const { hypotheses, mutations, critiques, eliminatedIds, winningHypoId, currentRound } = input

  const nodeMap = new Map<string, HypothesisTreeNode>()
  for (const h of hypotheses) {
    const status = resolveStatus(h, eliminatedIds, winningHypoId)
    const critique = critiques.find((c) => c.hypoId === h.id)
    const mutation = mutations.find((m) => m.mutatedHypothesis.id === h.id)
    nodeMap.set(h.id, {
      hypothesis: h,
      status,
      mutationRationale: mutation?.mutationRationale,
      critiqueSummary: critique?.critiqueText,
      children: [],
    })
  }

  let root: HypothesisTreeNode | null = null
  for (const h of hypotheses) {
    const node = nodeMap.get(h.id)
    if (!node) continue
    if (h.parentId == null) {
      root = node
    } else {
      const parent = nodeMap.get(h.parentId)
      if (parent) parent.children.push(node)
      else {
        // parent 不在集合内（可能是已淘汰的），挂到 root
        if (root) root.children.push(node)
      }
    }
  }

  return { root, currentRound }
}

export const EMPTY_EVOLUTION_TREE: EvolutionTreeData = { root: null, currentRound: 0 }
