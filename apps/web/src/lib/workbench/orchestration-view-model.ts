import { SCIENTIFIC_AGENT_DISPLAY_NAMES } from '@open-scientist/schema'
import type { AgentRole } from '@/lib/types/visualizers'
import type {
  ScientificOrchestrationAgentState,
  ScientificOrchestrationNodeState,
  ScientificOrchestrationRoute,
  ScientificOrchestrationState,
} from './state'

export type OrchestrationStageId =
  | 'librarian'
  | 'self-correction-i'
  | 'surveyor'
  | 'explorer'
  | 'self-correction-ii'
  | 'oracle'
  | 'prometheus'
export type OrchestrationSelection = { kind: 'node'; id: string } | { kind: 'worker'; id: string }

interface NodeDefinition {
  id: string
  stage: OrchestrationStageId
  title: string
  description: string
  reads: string
  writes: string
}

interface WorkerDefinition {
  id: string
  role: AgentRole
  title: string
  description: string
  executionKind?: 'deterministic' | 'model'
}

export interface OrchestrationNodeView extends NodeDefinition {
  state: ScientificOrchestrationNodeState
  stateLabel: string
  round: number | null
}

export interface OrchestrationStageView {
  id: OrchestrationStageId
  title: string
  description: string
  nodes: OrchestrationNodeView[]
}

export interface OrchestrationWorkerView extends WorkerDefinition {
  state: ScientificOrchestrationAgentState
  stateLabel: string
  round: number | null
  message: string | null
}

function roleFromWorkerId(workerId: string): AgentRole {
  if (workerId.startsWith('looker-')) return 'looker'
  if (workerId.startsWith('explorer-')) return 'explore'
  if (workerId.startsWith('oracle-')) return 'oracle'
  return 'sisyphus'
}

export interface OrchestrationRouteView {
  target: 'librarian' | 'explorer' | 'END' | 'WAIT'
  label: string
  reason: string | null
  continuing: boolean
  round: number | null
}

const NODE_DEFINITIONS: NodeDefinition[] = [
  {
    id: 'librarian.generate',
    stage: 'librarian',
    title: '生成候选假设',
    description: '从现象与已知资料中提出可比较的解释。',
    reads: '现象描述',
    writes: '候选机制与预测',
  },
  {
    id: 'self-correction-i.verify',
    stage: 'self-correction-i',
    title: '自校正 I：检查假设边界',
    description: '校验结构约束、文献依据与本地可检验性。',
    reads: '候选机制与预测',
    writes: '可检验假设',
  },
  {
    id: 'surveyor.analyze',
    stage: 'surveyor',
    title: '全局粗粒度分析',
    description: '汇总观测覆盖并对候选任务做优先级排序。',
    reads: '可检验假设',
    writes: '带优先级的任务队列',
  },
  {
    id: 'explorer.analyze',
    stage: 'explorer',
    title: '启动证据工作组',
    description: '先运行确定性处理，再让模型依次审阅前序证据。',
    reads: '可检验假设',
    writes: '证据任务',
  },
  {
    id: 'explorer.dispatch',
    stage: 'explorer',
    title: '分发确定性任务',
    description: '并行执行数据计算、目录核验、背景对照和溯源检查。',
    reads: '证据任务',
    writes: '确定性工作项',
  },
  {
    id: 'explorer.aggregate',
    stage: 'explorer',
    title: '汇总工作组证据',
    description: '合并确定性结果、模型审阅、限制和冲突。',
    reads: '全部工作项结果',
    writes: '证据记录',
  },
  {
    id: 'self-correction-ii.verify',
    stage: 'self-correction-ii',
    title: '自校正 II：核验事实与处理',
    description: '检查来源、数据处理和结论是否越过证据边界。',
    reads: '证据记录',
    writes: '校正后的证据',
  },
  {
    id: 'oracle.verify',
    stage: 'oracle',
    title: '检查结论强度',
    description: '按证据门禁逐条裁决，不足以支持的内容保留为未知。',
    reads: '校正后的证据',
    writes: '结论边界',
  },
  {
    id: 'oracle.synthesize',
    stage: 'oracle',
    title: '形成阶段结论',
    description: '只根据本轮已登记的证据归纳结果。',
    reads: '结论边界',
    writes: '本轮结论',
  },
  {
    id: 'prometheus.plan',
    stage: 'prometheus',
    title: '生成验证任务',
    description: '把未解决的问题转成下一步可执行任务。',
    reads: '结论边界',
    writes: '验证计划',
  },
  {
    id: 'prometheus.route',
    stage: 'prometheus',
    title: '选择下一条路径',
    description: '决定补充证据、重写假设或结束本轮。',
    reads: '验证计划',
    writes: '下一轮路由',
  },
]

const STAGE_DEFINITIONS: Array<Pick<OrchestrationStageView, 'id' | 'title' | 'description'>> = [
  { id: 'librarian', title: 'Librarian 假设', description: '文献检索与候选机制生成' },
  { id: 'self-correction-i', title: '自校正 I', description: '假设合理性与可检验性评估' },
  { id: 'surveyor', title: 'Surveyor 粗析', description: '全局粗粒度分析与任务优先级' },
  { id: 'explorer', title: 'Explorer 证据', description: '确定性并行计算后进行模型串行审阅' },
  { id: 'self-correction-ii', title: '自校正 II', description: '事实校正与数据处理检查' },
  { id: 'oracle', title: 'Oracle 结论', description: '证据裁决与综合推理' },
  { id: 'prometheus', title: 'Prometheus 验证', description: '生成任务并决定是否继续' },
]

const WORKER_DEFINITIONS: WorkerDefinition[] = [
  {
    id: 'looker-local-observation-catalog',
    role: 'looker',
    title: `${SCIENTIFIC_AGENT_DISPLAY_NAMES.looker}：本地观测目录审计`,
    description: '核验 manifest、仪器、波段、采样和覆盖。',
    executionKind: 'deterministic',
  },
  {
    id: 'explorer-coronal-diagnostics',
    role: 'explore',
    title: `${SCIENTIFIC_AGENT_DISPLAY_NAMES.explore}：FITS 可观测量分析`,
    description: '计算 ROI 时序、相关、周期、峰值和变异指标。',
    executionKind: 'deterministic',
  },
  {
    id: 'oracle-local-counterexample',
    role: 'oracle',
    title: `${SCIENTIFIC_AGENT_DISPLAY_NAMES.oracle}：同活动区背景对照`,
    description: '用固定背景窗口检查指标的特异性。',
    executionKind: 'deterministic',
  },
  {
    id: 'oracle-processing-fact-check',
    role: 'oracle',
    title: `${SCIENTIFIC_AGENT_DISPLAY_NAMES.oracle}：处理溯源复核`,
    description: '核对快照、处理运行、产物和校验和。',
    executionKind: 'deterministic',
  },
  {
    id: 'looker-model-observation-review',
    role: 'looker',
    title: `${SCIENTIFIC_AGENT_DISPLAY_NAMES.looker}：模型观测语境审阅`,
    description: '读取确定性结果并校验观测语境。',
    executionKind: 'model',
  },
  {
    id: 'explorer-model-diagnostic-review',
    role: 'explore',
    title: `${SCIENTIFIC_AGENT_DISPLAY_NAMES.explore}：模型诊断比较`,
    description: '比较诊断结果、竞争解释和未满足条件。',
    executionKind: 'model',
  },
  {
    id: 'oracle-model-counterexample-review',
    role: 'oracle',
    title: `${SCIENTIFIC_AGENT_DISPLAY_NAMES.oracle}：模型反例审阅`,
    description: '基于前序证据检查冲突、反例和结论边界。',
    executionKind: 'model',
  },
]

function nodeStateLabel(state: ScientificOrchestrationNodeState): string {
  if (state === 'running') return '进行中'
  if (state === 'completed') return '已完成'
  if (state === 'failed') return '需要校正'
  return '等待'
}

function workerStateLabel(state: ScientificOrchestrationAgentState): string {
  if (state === 'running') return '进行中'
  if (state === 'completed') return '已完成'
  if (state === 'failed') return '需要校正'
  if (state === 'skipped') return '已跳过'
  return '排队中'
}

export function toConsoleAgentRole(workerId: string): AgentRole | null {
  return (
    WORKER_DEFINITIONS.find((worker) => worker.id === workerId)?.role ?? roleFromWorkerId(workerId)
  )
}

export function describeScientificRoute(
  route: ScientificOrchestrationRoute | null,
): OrchestrationRouteView {
  if (!route) {
    return { target: 'WAIT', label: '等待本轮路由', reason: null, continuing: false, round: null }
  }
  if (route.nextRoute === 'librarian') {
    return {
      target: 'librarian',
      label: '返回 Librarian 假设阶段',
      reason: route.reason,
      continuing: route.continue,
      round: route.round,
    }
  }
  if (route.nextRoute === 'explorer') {
    return {
      target: 'explorer',
      label: '返回 Explorer 证据工作组',
      reason: route.reason,
      continuing: route.continue,
      round: route.round,
    }
  }
  return {
    target: 'END',
    label: '本轮结束',
    reason: route.reason,
    continuing: false,
    round: route.round,
  }
}

export function buildOrchestrationViewModel(state: ScientificOrchestrationState) {
  const nodeRecords = new Map(state.nodes.map((node) => [node.node, node]))
  const workerRecords = new Map(state.agents.map((agent) => [agent.agentId, agent]))

  const stages: OrchestrationStageView[] = STAGE_DEFINITIONS.map((stage) => ({
    ...stage,
    nodes: NODE_DEFINITIONS.filter((node) => node.stage === stage.id).map((node) => {
      const record = nodeRecords.get(node.id)
      const currentState = record?.state ?? 'idle'
      return {
        ...node,
        state: currentState,
        stateLabel: nodeStateLabel(currentState),
        round: record?.round ?? null,
      }
    }),
  }))

  const workerDefinitions: WorkerDefinition[] =
    state.agents.length > 0
      ? state.agents.map((agent) => ({
          id: agent.agentId,
          role: roleFromWorkerId(agent.agentId),
          title: agent.label,
          description:
            agent.executionKind === 'model'
              ? '读取前序结构化证据并进行模型审阅与冲突检查。'
              : '执行可复现的数据计算、目录核验或溯源检查。',
          executionKind: agent.executionKind,
        }))
      : WORKER_DEFINITIONS

  const workers: OrchestrationWorkerView[] = workerDefinitions.map((worker) => {
    const record = workerRecords.get(worker.id)
    const currentState = record?.state ?? 'queued'
    return {
      ...worker,
      state: currentState,
      stateLabel: workerStateLabel(currentState),
      round: record?.round ?? null,
      message: record?.message ?? null,
    }
  })

  const summary = workers.reduce(
    (counts, worker) => {
      counts[worker.state] += 1
      return counts
    },
    { running: 0, completed: 0, queued: 0, skipped: 0, failed: 0 } as Record<
      ScientificOrchestrationAgentState,
      number
    >,
  )
  const activeNode = stages.flatMap((stage) => stage.nodes).find((node) => node.state === 'running')
  const activeWorker = workers.find((worker) => worker.state === 'running')

  return {
    stages,
    workers: { items: workers, summary },
    route: describeScientificRoute(state.latestRoute),
    suggestedSelection: activeNode
      ? ({ kind: 'node', id: activeNode.id } as const)
      : activeWorker
        ? ({ kind: 'worker', id: activeWorker.id } as const)
        : null,
  }
}
