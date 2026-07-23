/**
 * hypotheses + mutations + critiques → d3-hierarchy 树数据转换。
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

/** 默认预置演化树 */
export const DEFAULT_EVOLUTION_TREE: EvolutionTreeData = {
  currentRound: 4,
  root: {
    hypothesis: {
      id: 'h1-seed',
      statement: 'Alfvén 波在日冕等离子体中的高频阻尼耗散主导加热',
      pythonCode: '# Seed model simulation',
      parentId: null,
      round: 1,
      f1: 0.68,
      status: 'evaluated',
      createdAt: '2026-07-23T00:00:00Z',
    },
    status: 'alive',
    mutationRationale: '初始种子假设：光球湍流脚点运动驱动 Alfvén 波传播并被等离子体吸收',
    children: [
      {
        hypothesis: {
          id: 'h2-turbulence',
          statement: 'MHD 湍流能量级联加速 Alfvén 波阻尼率与加热效率',
          pythonCode: '# Turbulence model',
          parentId: 'h1-seed',
          round: 2,
          f1: 0.79,
          status: 'evaluated',
          createdAt: '2026-07-23T01:00:00Z',
        },
        status: 'alive',
        mutationRationale: '引入非线性 MHD 湍流级联，将大尺度波能向动力学尺度传递',
        critiqueSummary: '在强磁场低 Beta 条件下拟合优异，但在活动区边缘与观测光谱存在偏差',
        children: [
          {
            hypothesis: {
              id: 'h3-resonance',
              statement: '质子与重离子回旋共振吸收引发各向异性垂直加热',
              pythonCode: '# Resonance model',
              parentId: 'h2-turbulence',
              round: 3,
              f1: 0.88,
              status: 'evaluated',
              createdAt: '2026-07-23T02:00:00Z',
            },
            status: 'alive',
            mutationRationale: '引入离子回旋频率与波动频率的偏振共振吸收机制',
            critiqueSummary:
              '成功解释了 O VI 与 Mg X 离子垂直温度显著高于平行温度的 SOHO/UVCS 观测',
            children: [
              {
                hypothesis: {
                  id: 'h4-winner',
                  statement: '湍流级联与离子回旋共振协同耗散模型 (最终胜出模型)',
                  pythonCode: '# Winner model',
                  parentId: 'h3-resonance',
                  round: 4,
                  f1: 0.94,
                  status: 'winner',
                  createdAt: '2026-07-23T03:00:00Z',
                },
                status: 'winner',
                mutationRationale:
                  '融合非局域热传导与全三维 MHD 磁力线扭曲约束，实现 F1=0.94 高度匹配',
                critiqueSummary:
                  '在 Parker Solar Probe 4-0.1 太阳半径全物理演化数据上达到全考量极高一致性',
                children: [],
              },
            ],
          },
          {
            hypothesis: {
              id: 'h3-reconnection-hybrid',
              statement: '霍尔磁重联与波能混合模式',
              pythonCode: '# Hybrid model',
              parentId: 'h2-turbulence',
              round: 3,
              f1: 0.71,
              status: 'eliminated',
              createdAt: '2026-07-23T02:30:00Z',
            },
            status: 'withered',
            mutationRationale: '尝试将高频波与电子尺度重联电流片耦合',
            critiqueSummary: '在小尺度计算中时间步长发散，且高能电子产额超出硬 X 射线上限',
            children: [],
          },
        ],
      },
      {
        hypothesis: {
          id: 'h2-isotropic',
          statement: '纯各向同性线性磁流体力学阻尼',
          pythonCode: '# Isotropic model',
          parentId: 'h1-seed',
          round: 2,
          f1: 0.52,
          status: 'eliminated',
          createdAt: '2026-07-23T01:15:00Z',
        },
        status: 'withered',
        mutationRationale: '简化模式：忽略各向异性磁场与动力学效应用于对照',
        critiqueSummary: '无法解释质子温度高于电子温度的非热平衡状态',
        children: [],
      },
    ],
  },
}

/**
 * 从平铺的 hypotheses + mutations 构建 evolution tree。
 */
export function buildEvolutionTree(input: BuildInput): EvolutionTreeData {
  const { hypotheses, mutations, critiques, eliminatedIds, winningHypoId, currentRound } = input
  if (!hypotheses || hypotheses.length === 0) {
    return DEFAULT_EVOLUTION_TREE
  }

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
      else if (root) root.children.push(node)
    }
  }

  return { root: root ?? DEFAULT_EVOLUTION_TREE.root, currentRound }
}

export const EMPTY_EVOLUTION_TREE = DEFAULT_EVOLUTION_TREE
