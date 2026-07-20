/**
 * HelixDB 图谱 / 假设池 → react-force-graph-3d 数据转换。
 *
 * 当前后端未暴露 HelixDB 图谱 REST 端点（见 05-api-contracts.md §11 TODO #3），
 * 数据来源暂从 SSE 流中的 Librarian/Oracle tool-output 提取，后续补 REST 后切换。
 */

import type { Hypothesis } from '@open-scientist/schema'
import type {
  ConceptCategory,
  ConceptLink,
  ConceptNetData,
  ConceptNode,
} from '@/lib/types/visualizers'

/** 关键词 → ConceptCategory 简易分类（POC，后续可换 LLM 分类） */
function classifyConcept(text: string): ConceptCategory {
  const lower = text.toLowerCase()
  if (/(magnet|field|flux)/.test(lower)) return 'magnetic'
  if (/(heat|thermal|temperature)/.test(lower)) return 'thermodynamics'
  if (/(wave|alfven|mhd)/.test(lower)) return 'waves'
  if (/(reconnect|nanoflare)/.test(lower)) return 'reconnection'
  return 'other'
}

/**
 * 从假设列表构建概念图。
 * POC：每个假设作为一个节点，按 statement 关键词分类。
 * 连线：同轮次假设互连（后续可替换为 HelixDB 真实关系边）。
 */
export function buildConceptNetFromHypotheses(hypotheses: Hypothesis[]): ConceptNetData {
  const nodes: ConceptNode[] = hypotheses.map((h) => ({
    id: h.id,
    label: h.statement.slice(0, 40) + (h.statement.length > 40 ? '…' : ''),
    category: classifyConcept(h.statement),
    hypothesisId: h.id,
    state: h.status === 'eliminated' ? 'faded' : 'active',
    description: h.statement,
  }))

  // POC 连线：同轮次 + 同 category 的假设互连
  const links: ConceptLink[] = []
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!
      const b = nodes[j]!
      const sameRound = hypotheses[i]?.round === hypotheses[j]?.round
      const sameCategory = a.category === b.category
      if (sameRound || sameCategory) {
        links.push({
          source: a.id,
          target: b.id,
          kind: sameCategory ? 'supports' : 'references',
        })
      }
    }
  }

  return { nodes, links }
}

/** 空图谱（初始状态） */
export const EMPTY_CONCEPT_NET: ConceptNetData = { nodes: [], links: [] }
