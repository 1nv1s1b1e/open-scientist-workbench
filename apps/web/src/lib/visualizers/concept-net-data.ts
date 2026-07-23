/**
 * HelixDB 图谱 / 假设池 → react-force-graph-3d 数据转换。
 */

import type { Hypothesis } from '@open-scientist/schema'
import type {
  ConceptCategory,
  ConceptLink,
  ConceptNetData,
  ConceptNode,
} from '@/lib/types/visualizers'

/** 关键词 → ConceptCategory 简易分类 */
export function classifyConcept(text: string): ConceptCategory {
  const lower = text.toLowerCase()
  if (/(magnet|field|flux|光球|磁场|剪切)/.test(lower)) return 'magnetic'
  if (/(heat|thermal|temperature|热|等离子体)/.test(lower)) return 'thermodynamics'
  if (/(wave|alfvén|alfven|mhd|波|回旋)/.test(lower)) return 'waves'
  if (/(reconnect|nanoflare|耀斑|重联)/.test(lower)) return 'reconnection'
  return 'other'
}

/** 预置的太阳物理日冕加热知识图谱示例数据 */
export const DEFAULT_CONCEPT_NET: ConceptNetData = {
  nodes: [
    {
      id: 'c1',
      label: 'Alfvén 波高频耗散',
      category: 'waves',
      description: 'Alfvén 波在日冕等离子体中的高频阻尼耗散，通过离子回旋共振将波能量转化为热能',
      state: 'active',
    },
    {
      id: 'c2',
      label: '纳耀斑磁重联',
      category: 'reconnection',
      description: '小尺度磁重联事件（Nanoflares）频繁释放磁能，维持日冕百万开氏度高温',
      state: 'active',
    },
    {
      id: 'c3',
      label: 'MHD 湍流级联',
      category: 'waves',
      description: '大尺度磁场剪切运动驱动 MHD 湍流，能量从大尺度向小动力学尺度级联',
      state: 'active',
    },
    {
      id: 'c4',
      label: '光球层点足剪切',
      category: 'magnetic',
      description: '光球对流运动扭曲日冕磁绳脚点，存储大量自由磁能',
      state: 'active',
    },
    {
      id: 'c5',
      label: '离子回旋共振耗散',
      category: 'waves',
      description: '离子回旋波频率与质子/重离子回旋频率匹配，发生选择性加热',
      state: 'active',
    },
    {
      id: 'c6',
      label: '等离子体非平衡热传导',
      category: 'thermodynamics',
      description: '沿磁力线的非局域电子热传导与辐射冷却平衡',
      state: 'active',
    },
    {
      id: 'c7',
      label: '霍尔磁重联加速',
      category: 'reconnection',
      description: '霍尔效应破坏理想 MHD 条件，形成快磁重联耗散区',
      state: 'faded',
    },
    {
      id: 'c8',
      label: '无碰撞冲击波加热',
      category: 'waves',
      description: '慢/快 MHD 冲击波在日冕环顶部形成非热粒子加速与热化区',
      state: 'faded',
    },
  ],
  links: [
    { source: 'c4', target: 'c2', kind: 'supports' },
    { source: 'c4', target: 'c3', kind: 'supports' },
    { source: 'c3', target: 'c1', kind: 'extends' },
    { source: 'c1', target: 'c5', kind: 'extends' },
    { source: 'c2', target: 'c7', kind: 'extends' },
    { source: 'c1', target: 'c2', kind: 'contradicts' },
    { source: 'c5', target: 'c6', kind: 'references' },
    { source: 'c7', target: 'c8', kind: 'references' },
  ],
}

/**
 * 从假设列表构建概念图。
 */
export function buildConceptNetFromHypotheses(hypotheses: Hypothesis[]): ConceptNetData {
  if (!hypotheses || hypotheses.length === 0) {
    return DEFAULT_CONCEPT_NET
  }

  const nodes: ConceptNode[] = hypotheses.map((h) => ({
    id: h.id,
    label: h.statement.slice(0, 40) + (h.statement.length > 40 ? '…' : ''),
    category: classifyConcept(h.statement),
    hypothesisId: h.id,
    state: h.status === 'eliminated' ? 'faded' : 'active',
    description: h.statement,
  }))

  const links: ConceptLink[] = []
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!
      const b = nodes[j]!
      const sameCategory = a.category === b.category
      if (sameCategory || i % 2 === j % 2) {
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

export const EMPTY_CONCEPT_NET = DEFAULT_CONCEPT_NET
