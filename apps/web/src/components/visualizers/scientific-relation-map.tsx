'use client'

import '@xyflow/react/dist/style.css'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import {
  Atom,
  BookOpenCheck,
  ClipboardList,
  Database,
  FileInput,
  Focus,
  Network,
  RotateCcw,
  Sparkles,
  Target,
  X,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScientificWorkbenchState } from '@/lib/workbench/state'
import { scientificRounds } from '@/lib/workbench/scientific-rounds'

type ConceptNodeKind =
  | 'phenomenon'
  | 'source'
  | 'mechanism'
  | 'hypothesis'
  | 'prediction'
  | 'processing'
  | 'evidence'
  | 'task'
  | 'conclusion'

type ConceptEdgeKind =
  | 'input'
  | 'source'
  | 'composition'
  | 'prediction'
  | 'support'
  | 'contradict'
  | 'unknown'
  | 'processing'
  | 'task'
  | 'synthesis'

type LayerId = 'sources' | 'mechanisms' | 'predictions' | 'evidence' | 'processing' | 'tasks' | 'conclusions'

interface ConceptGraphNode {
  id: string
  kind: ConceptNodeKind
  code: string
  label: string
  summary: string
  meta: string[]
  round?: number
  status?: string
  position: { x: number; y: number }
}

interface ConceptGraphEdge {
  id: string
  source: string
  target: string
  relation: string
  kind: ConceptEdgeKind
  round?: number
}

interface ConceptFlowNodeData extends Record<string, unknown> {
  model: ConceptGraphNode
  focused: boolean
  selected: boolean
  dimmed: boolean
  historical: boolean
  onHover: (id: string | null) => void
}

interface ConceptFlowEdgeData extends Record<string, unknown> {
  relation: string
  kind: ConceptEdgeKind
}

type ConceptFlowNode = Node<ConceptFlowNodeData, 'scientific-concept'>
type ConceptFlowEdge = Edge<ConceptFlowEdgeData>

const LAYERS: Array<{ id: LayerId; label: string; kinds: ConceptNodeKind[] }> = [
  { id: 'sources', label: '观测来源', kinds: ['source'] },
  { id: 'mechanisms', label: '全部机制', kinds: ['mechanism'] },
  { id: 'predictions', label: '可检验预测', kinds: ['prediction'] },
  { id: 'evidence', label: '本轮证据', kinds: ['evidence'] },
  { id: 'processing', label: '本轮处理', kinds: ['processing'] },
  { id: 'tasks', label: '本轮任务', kinds: ['task'] },
  { id: 'conclusions', label: '历史结论', kinds: ['conclusion'] },
]

// The graph is laid out as a compact execution timeline. Every visible update
// is reflowed by step, so adding a layer cannot push a later step in front of
// an earlier one.
const EXECUTION_STEPS: ConceptNodeKind[][] = [
  ['phenomenon'],
  ['source'],
  ['mechanism'],
  ['hypothesis'],
  ['prediction'],
  ['processing'],
  ['evidence'],
  ['task'],
  ['conclusion'],
]

function compact(text: string | undefined, maximum = 34): string {
  if (!text) return '未登记'
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function token(value: string): string {
  return stableHash(value).toString(36)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function edgeColor(kind: ConceptEdgeKind): string {
  if (kind === 'support') return '#6dba96ff'
  if (kind === 'contradict') return '#ff9d9d'
  if (kind === 'unknown') return '#b7c9f4'
  if (kind === 'prediction') return '#5792a9ff'
  if (kind === 'composition' || kind === 'task') return '#9b75b1ff'
  if (kind === 'input' ) return '#dccc6fff'
  if ( kind === 'synthesis') return '#f3c97cff'

  return '#82dcef'
}

function nodeColor(node: ConceptGraphNode): string {
  if (node.kind === 'phenomenon' ) return '#d6bc6fff'
   if ( node.kind === 'conclusion') return '#f1ac7aff'
  if (node.kind === 'mechanism' || node.kind === 'task') return 'rgba(187, 154, 240, 1)'
  if (node.kind === 'hypothesis') return '#a9edcc'
   if (node.kind === 'prediction') return '#abd0e7ff'
  if (node.kind === 'evidence' && node.status === 'support') return '#c9ed8d'
  if (node.kind === 'evidence' && node.status === 'contradict') return '#ffb7c7'
  if (node.kind === 'evidence') return '#b7c9f4'
  return '#82dcef'
}

function kindLabel(kind: ConceptNodeKind): string {
  const labels: Record<ConceptNodeKind, string> = {
    phenomenon: '科学现象',
    source: '观测来源',
    mechanism: '候选机制',
    hypothesis: '竞争假说',
    prediction: '可检验预测',
    processing: '确定性处理',
    evidence: '证据记录',
    task: '验证任务',
    conclusion: '综合结论',
  }
  return labels[kind]
}

function nodeIcon(kind: ConceptNodeKind) {
  if (kind === 'phenomenon') return Sparkles
  if (kind === 'source') return FileInput
  if (kind === 'mechanism') return Atom
  if (kind === 'prediction') return Target
  if (kind === 'processing') return Database
  if (kind === 'evidence') return BookOpenCheck
  if (kind === 'task') return ClipboardList
  if (kind === 'conclusion') return Focus
  return Network
}

const TERMINAL_NODE_STATUSES = new Set([
  'eliminated',
  'completed',
  'complete',
  'failed',
  'blocked',
  'rejected',
  'resolved',
  'closed',
  'done',
  'support',
  'contradict',
  'winner',
  'accepted',
  'superseded',
  'invalid',
  'verified',
  'unsupported',
  'cancelled',
  'skipped',
  'terminated',
])

function isEndedNode(node: ConceptGraphNode): boolean {
  if (node.kind === 'conclusion') return true
  return TERMINAL_NODE_STATUSES.has((node.status ?? '').toLowerCase())
}

  function compareConceptNodes(left: Omit<ConceptGraphNode, 'position'>, right: Omit<ConceptGraphNode, 'position'>): number {
   const leftFinal = left.code.endsWith('*')
  const rightFinal = right.code.endsWith('*')
  if (leftFinal !== rightFinal) return leftFinal ? 1 : -1
    return left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: 'base' }) || left.id.localeCompare(right.id)
}
function executionStepLayout(nodes: Omit<ConceptGraphNode, 'position'>[]): ConceptGraphNode[] {
  const stepByKind = new Map<ConceptNodeKind, number>()
  EXECUTION_STEPS.forEach((kinds, step) => kinds.forEach((kind) => stepByKind.set(kind, step)))

 const nodesByStep = EXECUTION_STEPS.map(() => [] as Omit<ConceptGraphNode, 'position'>[])
  nodes.forEach((node) => nodesByStep[stepByKind.get(node.kind) ?? 0]!.push(node))

    const nodesPerLane = 6
  const nodeWidth = 116
  const laneGap = 28
  const stepGap = 48
  const top = 62
  const height = 700
  let nextStepX = 72

  return nodesByStep.flatMap((stepNodes) => {
    if (stepNodes.length === 0) return []
   const orderedStepNodes = [...stepNodes].sort(compareConceptNodes)
    const laneCount = Math.ceil(orderedStepNodes.length / nodesPerLane)
    const rowCount = Math.min(orderedStepNodes.length, nodesPerLane)
    const stepWidth = laneCount * nodeWidth + (laneCount - 1) * laneGap
    const positioned = orderedStepNodes.map((node, index) => {
      const lane = Math.floor(index / nodesPerLane)
      const row = index % nodesPerLane
      const y = rowCount === 1 ? height / 2 : top + (row * (height - top * 2)) / (rowCount - 1)
      return { ...node, position: { x: nextStepX + lane * (nodeWidth + laneGap), y } }
    })

 nextStepX += stepWidth + stepGap
    return positioned
  })
}

function buildScientificGraph(state: ScientificWorkbenchState, round: number) {
  const nodes: Array<Omit<ConceptGraphNode, 'position'>> = []
  const edges: ConceptGraphEdge[] = []
  const nodeIds = new Set<string>()
  const addNode = (node: Omit<ConceptGraphNode, 'position'>) => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push(node)
  }
  const addEdge = (
    source: string,
    target: string,
    relation: string,
    kind: ConceptEdgeKind,
    edgeRound?: number,
  ) => {
    edges.push({ id: `${source}->${target}:${kind}:${edges.length}`, source, target, relation, kind, round: edgeRound })
  }

  const phenomenonId = 'phenomenon'
  addNode({
    id: phenomenonId,
    kind: 'phenomenon',
    code: 'Φ',
    label: state.phenomenon?.title ?? '待登记现象',
    summary: state.phenomenon?.requestedQuestion ?? state.phenomenon?.description ?? '尚未登记研究问题',
    meta: [state.phenomenon?.activeRegion ?? '未登记活动区', `累计查看至第 ${round} 轮`],
  })

  const sourceIds = new Set<string>()
  state.phenomenon?.observations.forEach((item, index) => sourceIds.add(item.sourceId ?? `observation-${index + 1}`))
  state.hypotheses.forEach((item) => item.sourceIds?.forEach((id) => sourceIds.add(id)))
  state.evidence.filter((item) => (item.round ?? 1) <= round).forEach((item) => item.sourceIds?.forEach((id) => sourceIds.add(id)))
  const sourceNodeById = new Map<string, string>()
  Array.from(sourceIds).forEach((sourceId, index) => {
    const observation = state.phenomenon?.observations.find((item, observationIndex) => (item.sourceId ?? `observation-${observationIndex + 1}`) === sourceId)
    const id = `source:${token(sourceId)}`
    sourceNodeById.set(sourceId, id)
    addNode({
      id,
      kind: 'source',
      code: `O${index + 1}`,
      label: observation?.label ?? sourceId,
      summary: observation
        ? [observation.instrument, observation.wavelengthOrBand].filter(Boolean).join(' · ') || observation.label || sourceId
        : `来源标识：${sourceId}`,
      meta: observation
        ? [observation.kind ?? '未登记类型', observation.observedAt ?? '未登记观测时间']
        : ['状态中仅登记来源标识，未登记完整观测元数据'],
    })
    addEdge(phenomenonId, id, '包含观测', 'input')
  })

  const hypothesisIds = new Map<string, string>()
  const mechanismIds = new Map<string, string>()
  state.hypotheses.filter((item) => (item.round ?? 1) <= round).forEach((hypothesis, index) => {
    const hypothesisId = `hypothesis:${hypothesis.id}`
    hypothesisIds.set(hypothesis.id, hypothesisId)
    addNode({
      id: hypothesisId,
      kind: 'hypothesis',
      code: `H${index + 1}`,
      label: compact(hypothesis.statement, 22),
      summary: hypothesis.statement,
      meta: [
        `第 ${hypothesis.round ?? 1} 轮提出 · 状态 ${hypothesis.status}`,
        `${hypothesis.predictions?.length ?? 0} 条预测 · ${hypothesis.falsificationConditions?.length ?? 0} 条证伪条件`,
        `证据等级 ${hypothesis.evidenceStrengthGrade ?? 'not_assessed'} · 非概率`,
      ],
      round: hypothesis.round ?? 1,
      status: hypothesis.status,
    })
    addEdge(phenomenonId, hypothesisId, '提出竞争解释', 'input', hypothesis.round ?? 1)
    hypothesis.sourceIds?.forEach((sourceId) => {
      const sourceNodeId = sourceNodeById.get(sourceId)
      if (sourceNodeId) addEdge(sourceNodeId, hypothesisId, '用于提出', 'source', hypothesis.round ?? 1)
    })

    hypothesis.mechanismComposition?.forEach((entry) => {
      const mechanism = stringValue(entry.mechanism)
      if (!mechanism) return
      let mechanismId = mechanismIds.get(mechanism)
      if (!mechanismId) {
        mechanismId = `mechanism:${token(mechanism)}`
        mechanismIds.set(mechanism, mechanismId)
        addNode({
          id: mechanismId,
          kind: 'mechanism',
          code: `M${mechanismIds.size}`,
          label: mechanism,
          summary: `${mechanism}在多个候选假说中的作用构成`,
          meta: ['相同机制名称会合并为同一节点'],
          round: hypothesis.round ?? 1,
        })
      }
      const role = stringValue(entry.role)
      const contribution = numberValue(entry.contribution)
      const relation = [role || '组成机制', contribution == null ? '' : `${Math.round(contribution * 100)}%`].filter(Boolean).join(' · ')
      addEdge(mechanismId, hypothesisId, relation, 'composition', hypothesis.round ?? 1)
    })

    hypothesis.predictions?.forEach((prediction, predictionIndex) => {
      const predictionId = `prediction:${hypothesis.id}:${predictionIndex}`
      addNode({
        id: predictionId,
        kind: 'prediction',
        code: `P${index + 1}.${predictionIndex + 1}`,
        label: compact(prediction, 20),
        summary: prediction,
        meta: [`来自 H${index + 1} 的显式可检验预测`, '当前状态未登记“证据—预测”直接映射时，不自动猜测连线'],
        round: hypothesis.round ?? 1,
      })
      addEdge(hypothesisId, predictionId, '推出预测', 'prediction', hypothesis.round ?? 1)
    })
  })

  const processingIds = new Map<string, string>()
  state.processingResults.filter((item) => item.round <= round).forEach((item, index) => {
    const id = `processing:${item.processingRunId}`
    processingIds.set(item.processingRunId, id)
    addNode({
      id,
      kind: 'processing',
      code: `D${index + 1}`,
      label: compact(item.caseLabel, 20),
      summary: `${item.caseLabel} · 读取 ${item.usedObservationCount} 条观测`,
      meta: [
        `第 ${item.round} 轮 · ${item.mode}`,
        `快照：${item.snapshotId}`,
        `产物：${item.metricsArtifactId} / ${item.figureArtifactId}`,
        ...item.limitations.slice(0, 2),
      ],
      round: item.round,
    })
  })

  const evidenceIds = new Map<string, string>()
  const visibleEvidence = state.evidence.filter((item) => (item.round ?? 1) <= round)
  visibleEvidence.forEach((evidence, index) => {
    const id = `evidence:${evidence.evidenceId}`
    evidenceIds.set(evidence.evidenceId, id)
    const status = evidence.status === 'support' || evidence.status === 'contradict' ? evidence.status : 'unknown'
    addNode({
      id,
      kind: 'evidence',
      code: `E${index + 1}`,
      label: compact(evidence.claim, 20),
      summary: evidence.claim,
      meta: [
        `第 ${evidence.round ?? 1} 轮 · ${status === 'support' ? '支持' : status === 'contradict' ? '反例' : '证据不足'}`,
        evidence.observed ?? '未登记观测摘要',
        `方法：${evidence.method ?? '未登记'}`,
        evidence.provenance?.deterministic ? '具有确定性处理溯源' : '未登记确定性处理溯源',
        ...(evidence.limitations ?? []).slice(0, 2),
      ],
      round: evidence.round ?? 1,
      status,
    })
    const hypothesisId = evidence.hypothesisId ? hypothesisIds.get(evidence.hypothesisId) : null
    if (hypothesisId) {
      addEdge(
        hypothesisId,
        id,
        status === 'support' ? '获得支持' : status === 'contradict' ? '出现反例' : '仍待验证',
        status,
        evidence.round ?? 1,
      )
    }
    evidence.sourceIds?.forEach((sourceId) => {
      const sourceNodeId = sourceNodeById.get(sourceId)
      if (sourceNodeId) addEdge(sourceNodeId, id, '证据来源', 'source', evidence.round ?? 1)
    })
    const processingId = evidence.provenance?.processingRunId ? processingIds.get(evidence.provenance.processingRunId) : null
    if (processingId) addEdge(processingId, id, '确定性处理产出', 'processing', evidence.round ?? 1)
  })

  const taskIds = new Map<string, string>()
  state.validationTasks.filter((item) => (item.round ?? 1) <= round).forEach((task, index) => {
    const id = `task:${task.taskId}`
    taskIds.set(task.taskId, id)
    addNode({
      id,
      kind: 'task',
      code: `T${index + 1}`,
      label: compact(task.objective, 20),
      summary: task.objective,
      meta: [
        `第 ${task.round ?? 1} 轮 · ${task.status} · 路由 ${task.route}`,
        `执行器：${task.executorId ?? '未绑定'}`,
        `触发来源：${task.triggeredBy ?? '未登记'}`,
        `${task.resultEvidenceIds?.length ?? 0} 条结果证据`,
        ...(task.discriminatingOutcomes ?? []).slice(0, 2),
      ],
      round: task.round ?? 1,
      status: task.status,
    })
    const triggerEvidenceId = task.triggeredBy ? evidenceIds.get(task.triggeredBy) : null
    if (triggerEvidenceId) addEdge(triggerEvidenceId, id, '触发验证', 'task', task.round ?? 1)
    task.resultEvidenceIds?.forEach((evidenceId) => {
      const targetId = evidenceIds.get(evidenceId)
      if (targetId) addEdge(id, targetId, '产出证据', 'task', task.round ?? 1)
    })
  })
  visibleEvidence.forEach((evidence) => {
    if (!evidence.taskId) return
    const taskId = taskIds.get(evidence.taskId)
    const evidenceId = evidenceIds.get(evidence.evidenceId)
    if (taskId && evidenceId && !edges.some((edge) => edge.source === taskId && edge.target === evidenceId)) {
      addEdge(taskId, evidenceId, '产出证据', 'task', evidence.round ?? 1)
    }
  })

  let previousConclusionId: string | null = null
  state.roundSummaries.filter((item) => item.round <= round).forEach((summary) => {
    const id = `conclusion:round:${summary.round}`
    addNode({
      id,
      kind: 'conclusion',
      code: `C${summary.round}`,
      label: compact(summary.conclusion, 22),
      summary: summary.conclusion,
      meta: [
        `第 ${summary.round} 轮综合`,
        summary.evidenceSummary
          ? `${summary.evidenceSummary.support} 支持 · ${summary.evidenceSummary.contradict} 反例 · ${summary.evidenceSummary.unknown} 不足`
          : '未登记证据计数',
      ],
      round: summary.round,
    })
    visibleEvidence.filter((item) => (item.round ?? 1) === summary.round).forEach((evidence) => {
      const evidenceId = evidenceIds.get(evidence.evidenceId)
      if (evidenceId) addEdge(evidenceId, id, '纳入本轮综合', 'synthesis', summary.round)
    })
    const summarizedHypotheses = new Set(
      visibleEvidence
        .filter((item) => (item.round ?? 1) === summary.round && item.hypothesisId)
        .map((item) => item.hypothesisId as string),
    )
    summarizedHypotheses.forEach((hypothesisId) => {
      const sourceId = hypothesisIds.get(hypothesisId)
      if (sourceId) addEdge(sourceId, id, '有本轮证据进入综合', 'synthesis', summary.round)
    })
    if (previousConclusionId) addEdge(previousConclusionId, id, '下一轮修订', 'synthesis', summary.round)
    previousConclusionId = id
  })

  const latestRound = Math.max(...scientificRounds(state), state.round, 1)
  if (state.conclusion && round >= latestRound) {
    const finalId = 'conclusion:final'
    addNode({
      id: finalId,
      kind: 'conclusion',
      code: 'C*',
      label: compact(state.conclusion, 22),
      summary: state.conclusion,
      meta: [state.terminationReason ? `终止原因：${state.terminationReason}` : '未登记终止原因', `运行状态：${state.status}`],
      round: latestRound,
    })
    if (previousConclusionId) addEdge(previousConclusionId, finalId, '收束为最终边界', 'synthesis', latestRound)
  }

  const validEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    return { nodes: executionStepLayout(nodes), edges: validEdges }
}

function layerForKind(kind: ConceptNodeKind): LayerId | null {
  return LAYERS.find((layer) => layer.kinds.includes(kind))?.id ?? null
}

function ConceptNodeView({ data }: NodeProps<ConceptFlowNode>) {
  const Icon = nodeIcon(data.model.kind)
  return (
    <div
      className={`concept-flow-node is-${data.model.kind} ${data.model.status ? `status-${data.model.status}` : ''} ${data.focused ? 'is-focused' : ''} ${data.selected ? 'is-selected' : ''} ${data.dimmed ? 'is-dimmed' : ''} ${data.historical ? 'is-historical' : ''}`}
      data-kind={data.model.kind}
      data-node-id={data.model.id}
      onPointerEnter={() => data.onHover(data.model.id)}
      onPointerLeave={() => data.onHover(null)}
    >
      <Handle type="target" position={Position.Left} className="concept-flow-handle" isConnectable={false} />
      <span className="concept-flow-node-core" style={{ '--concept-color': nodeColor(data.model) } as React.CSSProperties}>
        <Icon />
        <strong>{data.model.code}</strong>
      </span>
      <span className="concept-flow-tooltip" aria-hidden={!data.focused || data.selected}>
        <b>{data.model.summary}</b>
        <small>{data.model.meta[0]}</small>
        <em>点击查看全部关系</em>
      </span>
      <Handle type="source" position={Position.Right} className="concept-flow-handle" isConnectable={false} />
    </div>
  )
}

const NODE_TYPES = { 'scientific-concept': ConceptNodeView }

export function ScientificRelationMap({ state }: { state: ScientificWorkbenchState }) {
  const rounds = useMemo(() => scientificRounds(state), [state])
  const latestRound = rounds.at(-1) ?? Math.max(state.round, 1)
  const [viewMode, setViewMode] = useState<'cumulative' | 'single'>('cumulative')
  const [cumulativeRound, setCumulativeRound] = useState(latestRound)
  const [singleRound, setSingleRound] = useState(latestRound)
  const [enabledLayers, setEnabledLayers] = useState<Set<LayerId>>(() => new Set<LayerId>())
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedHypothesisId, setExpandedHypothesisId] = useState<string | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<ConceptFlowNode>([])
  const instanceRef = useRef<ReactFlowInstance<ConceptFlowNode, ConceptFlowEdge> | null>(null)
  const appliedStructureKeyRef = useRef<string | null>(null)
   const hoverClearTimerRef = useRef<number | null>(null)
  const reduceMotion = useReducedMotion()

  const round = viewMode === 'cumulative' ? cumulativeRound : singleRound

  useEffect(() => {
    setCumulativeRound((current) => (rounds.includes(current) ? current : latestRound))
    setSingleRound((current) => (rounds.includes(current) ? current : latestRound))
  }, [latestRound, rounds])

  useEffect(() => {
    if (viewMode === 'single') {
      setEnabledLayers(new Set(LAYERS.map((layer) => layer.id)))
    } else {
      setEnabledLayers(new Set())
    }
  }, [viewMode])

const handleHover = useCallback((id: string | null) => {
    if (hoverClearTimerRef.current != null) {
      window.clearTimeout(hoverClearTimerRef.current)
      hoverClearTimerRef.current = null
    }
    if (id) {
      setHoveredId(id)
      return
    }
    hoverClearTimerRef.current = window.setTimeout(() => {
      hoverClearTimerRef.current = null
      setHoveredId(null)
    }, 140)
  }, [])

  useEffect(() => () => {
    if (hoverClearTimerRef.current != null) window.clearTimeout(hoverClearTimerRef.current)
  }, [])

  const graph = useMemo(() => buildScientificGraph(state, round), [round, state])
  const branchIds = useMemo(() => {
    const ids = new Set<string>()
    if (!expandedHypothesisId) return ids
    ids.add(expandedHypothesisId)
    const firstHop = graph.edges.filter((edge) => edge.source === expandedHypothesisId || edge.target === expandedHypothesisId)
    firstHop.forEach((edge) => {
      const otherId = edge.source === expandedHypothesisId ? edge.target : edge.source
      const other = graph.nodes.find((node) => node.id === otherId)
      if (!other) return
      if (other.kind !== 'evidence' || other.round === round) ids.add(otherId)
    })
    const currentEvidenceIds = Array.from(ids).filter((id) => graph.nodes.find((node) => node.id === id)?.kind === 'evidence')
    graph.edges.forEach((edge) => {
      if (currentEvidenceIds.includes(edge.source) || currentEvidenceIds.includes(edge.target)) {
        ids.add(edge.source)
        ids.add(edge.target)
      }
    })
    return ids
  }, [expandedHypothesisId, graph.edges, graph.nodes, round])
  const expandedIds = useMemo(() => new Set(Array.from(branchIds).filter((id) => {
    const kind = graph.nodes.find((node) => node.id === id)?.kind
    return id === expandedHypothesisId || kind === 'mechanism' || kind === 'prediction'
  })), [branchIds, expandedHypothesisId, graph.nodes])
  const roundRelatedIds = useMemo(() => {
    const ids = new Set(
      graph.nodes
        .filter((node) => node.round === round || node.kind === 'phenomenon')
        .map((node) => node.id),
    )
    let changed = true
    while (changed) {
      changed = false
      graph.edges.forEach((edge) => {
        // Follow only upstream edges. This keeps a single-round view focused
        // on the selected round and the preceding steps that explain it.
        if (!ids.has(edge.target) || ids.has(edge.source)) return
        if (!ids.has(edge.source)) {
          ids.add(edge.source)
          changed = true
        }
      })
    }
    return ids
  }, [graph.edges, graph.nodes, round])
  const singleVisibleIds = useMemo(() => {
    const ids = new Set(roundRelatedIds)
    graph.nodes.forEach((node) => {
      if (node.round != null && node.round < round && isEndedNode(node)) ids.add(node.id)
    })
    return ids
  }, [graph.nodes, round, roundRelatedIds])
  const singleHistoricalIds = useMemo(
    () => new Set(
      graph.nodes
        .filter((node) => viewMode === 'single' && node.round != null && node.round < round && isEndedNode(node))
        .map((node) => node.id),
    ),
    [graph.nodes, round, viewMode],
  )
 const candidateModels = useMemo(
    () => graph.nodes.filter((node) => {
       if (viewMode === 'single' && !singleVisibleIds.has(node.id)) return false
      if (expandedIds.has(node.id)) return true
      if (node.kind === 'conclusion' && (node.id === 'conclusion:final' || node.round === round)) return true
      const layer = layerForKind(node.kind)
      if (layer == null) return true
      if (!enabledLayers.has(layer)) return false
            if (viewMode !== 'single' && expandedHypothesisId && ['source', 'mechanism', 'prediction', 'processing', 'evidence', 'task'].includes(node.kind) && !branchIds.has(node.id)) return false
      if (viewMode !== 'single' && (node.kind === 'evidence' || node.kind === 'processing' || node.kind === 'task')) return node.round === round
      return true
    }),
    [branchIds, enabledLayers, expandedHypothesisId, expandedIds, graph.nodes, round, singleVisibleIds, viewMode],
  )
  const visibleModels = useMemo(() => executionStepLayout(candidateModels.map((node) => {
    const { position: _position, ...model } = node
    return model
  })), [candidateModels])
  const visibleIds = useMemo(() => new Set(visibleModels.map((node) => node.id)), [visibleModels])
  const visibleEdges = useMemo(
    () => graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [graph.edges, visibleIds],
  )
  const activeId = hoveredId ?? selectedId
  const relatedIds = useMemo(() => {
    const ids = new Set<string>()
    if (!activeId) return ids
    ids.add(activeId)
    visibleEdges.forEach((edge) => {
      if (edge.source === activeId || edge.target === activeId) {
        ids.add(edge.source)
        ids.add(edge.target)
      }
    })
    return ids
  }, [activeId, visibleEdges])

  useEffect(() => {
  const nextStructureKey = visibleModels.map((node) => `${node.id}:${node.position.x}:${node.position.y}`).join('|')
    const resetPositions = appliedStructureKeyRef.current !== nextStructureKey
    appliedStructureKeyRef.current = nextStructureKey
    setNodes((current) => {
      const positions = new Map(current.map((node) => [node.id, node.position]))
      return visibleModels.map((model) => ({
        id: model.id,
        type: 'scientific-concept',
        position: resetPositions ? model.position : positions.get(model.id) ?? model.position,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: true,
        selectable: false,
        focusable: true,
        ariaLabel: `${kindLabel(model.kind)} ${model.code}：${model.summary}`,
        data: {
          model,
          focused: activeId === model.id,
          selected: selectedId === model.id,
            dimmed: Boolean((activeId && !relatedIds.has(model.id)) || singleHistoricalIds.has(model.id)),
          historical: singleHistoricalIds.has(model.id),
           onHover: handleHover,
        },
      }))
    })
 }, [activeId, handleHover, relatedIds, selectedId, setNodes, singleHistoricalIds, visibleModels])

  const structureKey = useMemo(() => visibleModels.map((node) => `${node.id}:${node.position.x}:${node.position.y}`).join('|'), [visibleModels])
  useEffect(() => {
    const timer = window.setTimeout(() => instanceRef.current?.fitView({ padding: 0.14, duration: reduceMotion ? 0 : 320 }), 60)
    return () => window.clearTimeout(timer)
  }, [reduceMotion, structureKey])

  useEffect(() => {
    if (selectedId && !visibleIds.has(selectedId)) setSelectedId(null)
    if (hoveredId && !visibleIds.has(hoveredId)) setHoveredId(null)
    if (expandedHypothesisId && !graph.nodes.some((node) => node.id === expandedHypothesisId)) setExpandedHypothesisId(null)
  }, [expandedHypothesisId, graph.nodes, hoveredId, selectedId, visibleIds])

  const flowEdges = useMemo<ConceptFlowEdge[]>(() => visibleEdges.map((edge) => {
    const related = !activeId || edge.source === activeId || edge.target === activeId
     const historical = singleHistoricalIds.has(edge.source) || singleHistoricalIds.has(edge.target)
    const color = edgeColor(edge.kind)
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'bezier',
      label: activeId && related ? edge.relation : undefined,
      data: { relation: edge.relation, kind: edge.kind },
       animated: Boolean(activeId && related && !historical && !reduceMotion),
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 13, height: 13 },
     style: { stroke: color, strokeWidth: historical ? 0.7 : related ? 1.35 : 0.8, opacity: historical ? 0.24 : related ? 0.68 : 0.06 },
      labelStyle: { fill: 'rgba(238,244,246,.76)', fontSize: 10, fontFamily: 'var(--font-mono)' },
      labelBgStyle: { fill: '#071015', fillOpacity: 0.92, stroke: color, strokeOpacity: 0.18 },
      labelBgPadding: [5, 3],
      labelBgBorderRadius: 8,
    }
 }), [activeId, reduceMotion, singleHistoricalIds, visibleEdges])


  const selectedNode = graph.nodes.find((node) => node.id === selectedId) ?? null
  const expandedHypothesis = graph.nodes.find((node) => node.id === expandedHypothesisId) ?? null
  const allSelectedRelations = selectedNode
    ? graph.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
    : []
  const selectedRelations = allSelectedRelations.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
  const hiddenRelationCount = allSelectedRelations.length - selectedRelations.length
  const graphNodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes])
  const connectedIds = useMemo(() => new Set(visibleEdges.flatMap((edge) => [edge.source, edge.target])), [visibleEdges])
  const orphanCount = visibleModels.filter((node) => node.kind !== 'phenomenon' && !connectedIds.has(node.id)).length

  const toggleLayer = useCallback((layer: LayerId) => {
    setEnabledLayers((current) => {
      const next = new Set(current)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }, [])

  const resetLayout = useCallback(() => {
    const positions = new Map(visibleModels.map((node) => [node.id, node.position]))
    setNodes((current) => current.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })))
    window.setTimeout(() => instanceRef.current?.fitView({ padding: 0.14, duration: reduceMotion ? 0 : 320 }), 30)
  }, [reduceMotion, setNodes, visibleModels])

  return (
    <section className={`relation-map-shell concept-network-shell concept-flow-shell ${activeId ? 'has-focus' : ''}`} aria-label="科学概念网络">
      <header className="relation-map-header concept-flow-header">
        <div>
          <div className="eyebrow-mono text-cyan-200/70">SCIENTIFIC KNOWLEDGE CONSTELLATION</div>
          <h1>科学概念网络</h1>
          <p>可切换累计轮次或单独轮次；单轮视图保留本轮及其上游关联步骤，已结束节点会弱化显示。点击假说可展开来源、预测、证据、处理与任务；节点可拖动，空白处可平移。</p>
        </div>
         <div className="concept-round-controls" aria-label="概念网络轮次选择">
          <label className="concept-round-control">
            <span>展示方式</span>
            <select value={viewMode} onChange={(event) => setViewMode(event.target.value as 'cumulative' | 'single')}>
              <option value="cumulative">累计轮次</option>
              <option value="single">单独轮次</option>
            </select>
          </label>
          <label className={`concept-round-control ${viewMode === 'cumulative' ? 'is-active' : ''}`}>
            <span>累计至</span>
            <select value={cumulativeRound} onChange={(event) => setCumulativeRound(Number(event.target.value))} disabled={viewMode !== 'cumulative'}>
              {rounds.map((item) => <option key={`cumulative-${item}`} value={item}>第 {item} 轮</option>)}
            </select>
          </label>
          <label className={`concept-round-control ${viewMode === 'single' ? 'is-active' : ''}`}>
            <span>查看单轮</span>
            <select value={singleRound} onChange={(event) => setSingleRound(Number(event.target.value))} disabled={viewMode !== 'single'}>
              {rounds.map((item) => <option key={`single-${item}`} value={item}>第 {item} 轮</option>)}
            </select>
          </label>
        </div>
      </header>

      {state.hypotheses.length === 0 ? (
        <div className="relation-map-empty"><Network className="h-5 w-5" />运行后显示真实科学实体与可追溯关系。</div>
      ) : (
        <div className="concept-flow-body">
          <div className="concept-flow-toolbar">
            <div className="concept-flow-stats"><strong>{visibleModels.length}</strong> 节点 <i /> <strong>{visibleEdges.length}</strong> 关系 {orphanCount > 0 && <><i /><strong>{orphanCount}</strong> 个未建立关系</>}</div>
            {expandedHypothesis && <button type="button" className="concept-flow-expansion" onClick={() => { setExpandedHypothesisId(null); setSelectedId(null) }}>{expandedHypothesis.code} 子图已展开 <span>收起</span></button>}
            <div className="concept-flow-layers" aria-label="概念网络图层">
              {LAYERS.map((layer) => {
                const count = graph.nodes.filter((node) => {
                  if (!layer.kinds.includes(node.kind)) return false
                  if (viewMode === 'single' && !singleVisibleIds.has(node.id)) return false
                  if (viewMode !== 'single' && expandedHypothesisId && ['source', 'mechanism', 'prediction', 'processing', 'evidence', 'task'].includes(node.kind) && !branchIds.has(node.id)) return false
                 if (viewMode !== 'single' && (node.kind === 'evidence' || node.kind === 'processing' || node.kind === 'task')) return node.round === round
                  return true
                }).length
                return <button key={layer.id} type="button" aria-pressed={enabledLayers.has(layer.id)} onClick={() => toggleLayer(layer.id)}>{layer.label}<span>{count}</span></button>
              })}
            </div>
            <button type="button" className="concept-flow-reset" onClick={resetLayout}><RotateCcw />恢复布局</button>
          </div>

          <div className="concept-flow-stage">
            <ReactFlow<ConceptFlowNode, ConceptFlowEdge>
              nodes={nodes}
              edges={flowEdges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onInit={(instance) => { instanceRef.current = instance }}
              onNodeClick={(_, node) => {
                const model = graphNodeById.get(node.id)
                if (model?.kind === 'hypothesis') {
                  setExpandedHypothesisId((current) => current === node.id ? null : node.id)
                  setSelectedId((current) => current === node.id ? null : node.id)
                  return
                }
                setSelectedId((current) => current === node.id ? null : node.id)
              }}
              onPaneClick={() => { setSelectedId(null); setExpandedHypothesisId(null) }}
              fitView
              fitViewOptions={{ padding: 0.14 }}
              minZoom={0.62}
              maxZoom={2.25}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag
              zoomOnScroll
              zoomOnPinch
              proOptions={{ hideAttribution: true }}
            >
              <Background color="rgba(160,195,236,.075)" gap={28} size={1} />
              <MiniMap
                className="concept-flow-minimap"
                nodeColor={(node) => nodeColor((node.data as ConceptFlowNodeData).model)}
                nodeStrokeWidth={0}
                pannable
                zoomable
              />
              <Controls className="concept-flow-controls" showInteractive={false} />
            </ReactFlow>
              <aside className="concept-flow-node-legend" aria-label="节点类别图例">
              <b>节点类别</b>
              <span><strong>Φ</strong>科学现象</span>
              <span><strong>O</strong>观测来源</span>
              <span><strong>M</strong>候选机制</span>
              <span><strong>H</strong>竞争假说</span>
              <span><strong>P</strong>可检验预测</span>
              <span><strong>D</strong>确定性处理</span>
              <span><strong>E</strong>证据记录</span>
              <span><strong>T</strong>验证任务</span>
              <span><strong>C</strong>综合结论</span>
            </aside>

            <div className="concept-flow-legend" aria-label="关系图例">
              <span><i className="is-support" />支持</span>
              <span><i className="is-contradict" />反例</span>
              <span><i className="is-unknown" />待验证</span>
              <span><i className="is-semantic" />机制 / 任务</span>
              <em>箭头表示可追溯方向</em>
            </div>

            <AnimatePresence>
              {selectedNode && (
                <motion.aside className="concept-flow-inspector" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
                  <span>{kindLabel(selectedNode.kind)} · {selectedNode.code}{selectedNode.round ? ` · ROUND ${selectedNode.round}` : ''}</span>
                  <strong>{selectedNode.summary}</strong>
                  <ul className="concept-flow-meta">{selectedNode.meta.map((item, index) => <li key={`${selectedNode.id}:meta:${index}`}>{item}</li>)}</ul>
                  <div className="concept-flow-relations">
                    <b>当前可见关系 · {selectedRelations.length}{hiddenRelationCount > 0 ? ` / 共 ${allSelectedRelations.length}` : ''}</b>
                    {selectedRelations.length === 0 && <p>状态中没有可确认的直接关系，因此保留为孤立节点。</p>}
                    {selectedRelations.map((edge) => {
                      const outgoing = edge.source === selectedNode.id
                      const other = graphNodeById.get(outgoing ? edge.target : edge.source)
                      if (!other) return null
                      return (
                        <div key={edge.id}>
                          <i style={{ backgroundColor: edgeColor(edge.kind) }} />
                          <span>{outgoing ? '→' : '←'} {edge.relation}</span>
                          <strong>{other.code} · {compact(other.summary, 28)}</strong>
                        </div>
                      )
                    })}
                    {hiddenRelationCount > 0 && <p>另有 {hiddenRelationCount} 条关系已收起；可通过上方图层按需显示。</p>}
                  </div>
                  <button type="button" aria-label="关闭节点详情" onClick={() => setSelectedId(null)}><X /></button>
                </motion.aside>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </section>
  )
}
