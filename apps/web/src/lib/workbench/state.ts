import type { UIMessageChunk } from '@/lib/types/sse-events'

export interface WorkbenchPhenomenon {
  phenomenonId: string
  title: string
  description: string
  activeRegion?: string
  requestedQuestion?: string
  observations: Array<{
    sourceId?: string
    kind?: string
    label?: string
    instrument?: string
    wavelengthOrBand?: string
    observedAt?: string
  }>
}

export interface WorkbenchHypothesis {
  id: string
  statement: string
  mechanismComposition?: Array<Record<string, unknown>>
  predictions?: string[]
  falsificationConditions?: string[]
  sourceIds?: string[]
  status: string
  round?: number
  confidence?: number
}

export interface WorkbenchEvidence {
  evidenceId: string
  hypothesisId?: string | null
  taskId?: string | null
  status: 'support' | 'contradict' | 'unknown' | string
  claim: string
  observed?: string
  method?: string
  agentId?: string
  sourceIds?: string[]
  sampleIds?: string[]
  provenance?: {
    processingRunId: string
    dataSnapshotIds: string[]
    artifactIds: string[]
    generatedBy: string
    deterministic: true
  }
  metrics?: Record<string, unknown>
  uncertainty?: string
  limitations?: string[]
  round?: number
}

export interface WorkbenchValidationTask {
  taskId: string
  executorId?: string
  route: 'A' | 'B' | string
  type?: string
  status: string
  objective: string
  requiredSourceIds?: string[]
  triggeredBy?: string
  discriminatingOutcomes?: string[]
  resultEvidenceIds?: string[]
  fingerprint?: string
  round?: number
}
export interface WorkbenchRetrievalTool {
  id: string
  label: string
  status: string
  resultCount: number
}

export interface WorkbenchRetrieval {
  stage: string
  status: string
  message: string
  sourceCount: number
  paperCount: number
  localCaseCount: number
  tools: WorkbenchRetrievalTool[]
}

export interface WorkbenchCorrection {
  correctionId?: string
  kind?: string
  severity?: string
  round?: number
  stage: string
  status: string
  message?: string
  unavailableSourceIds?: string[]
  action?: string
}
export interface WorkbenchProcessingResult {
  processingRunId: string
  snapshotId: string
  caseId: string
  caseLabel: string
  mode: 'discovery' | 'validation' | string
  round: number
  usedObservationCount: number
  baselineCaseLabel: string | null
  diagnostics: {
    wave?: Record<string, unknown>
    reconnection?: Record<string, unknown>
    coupled?: Record<string, unknown>
  }
  metricsArtifactId: string
  figureArtifactId: string
  figureUrl?: string
  limitations: string[]
}

export interface WorkbenchRoundSummary {
  round: number
  conclusion: string
  evidenceSummary?: { support: number; contradict: number; unknown: number }
}

export type ScientificOrchestrationNodeState = 'idle' | 'running' | 'completed' | 'failed'
export type ScientificOrchestrationAgentState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'skipped'
  | 'failed'

export interface ScientificOrchestrationNode {
  node: string
  state: ScientificOrchestrationNodeState
  round: number
}

export interface ScientificOrchestrationAgent {
  agentId: string
  label: string
  executionKind?: 'deterministic' | 'model'
  state: ScientificOrchestrationAgentState
  round: number
  message?: string
}

export interface ScientificOrchestrationRoute {
  round: number
  continue: boolean
  reason: string
  nextRoute: 'A' | 'B' | 'END'
}

export interface ScientificOrchestrationState {
  nodes: ScientificOrchestrationNode[]
  agents: ScientificOrchestrationAgent[]
  latestRoute: ScientificOrchestrationRoute | null
}

export interface ScientificWorkbenchState {
  phenomenon: WorkbenchPhenomenon | null
  inputDigest: string | null
  round: number
  hypotheses: WorkbenchHypothesis[]
  retrieval: WorkbenchRetrieval | null
  evidence: WorkbenchEvidence[]
  validationTasks: WorkbenchValidationTask[]
  corrections: WorkbenchCorrection[]
  roundSummaries: WorkbenchRoundSummary[]
  orchestration: ScientificOrchestrationState
  conclusion: string | null
  terminationReason: string | null
  processingResults: WorkbenchProcessingResult[]
  status: 'idle' | 'running' | 'completed' | 'blocked' | 'failed'
}

export function emptyScientificWorkbenchState(): ScientificWorkbenchState {
  return {
    phenomenon: null,
    inputDigest: null,
    round: 0,
    hypotheses: [],
    retrieval: null,
    evidence: [],
    validationTasks: [],
    corrections: [],
    roundSummaries: [],
    orchestration: {
      nodes: [],
      agents: [],
      latestRoute: null,
    },
    conclusion: null,
    terminationReason: null,
    status: 'idle',
    processingResults: [],
  }
}

function replaceById<T>(items: T[], item: T, getId: (value: T) => string): T[] {
  const id = getId(item)
  const index = items.findIndex((candidate) => getId(candidate) === id)
  if (index < 0) return [...items, item]
  const next = [...items]
  next[index] = item
  return next
}

/** Replay persisted/live scientific custom chunks into one UI state. */
export function reduceScientificChunk(
  state: ScientificWorkbenchState,
  chunk: UIMessageChunk,
): ScientificWorkbenchState {
  if (chunk.type !== 'custom') return state
  const payload = chunk as unknown as Record<string, unknown>
  const kind = payload.kind
  if (typeof kind !== 'string' || !kind.startsWith('scientific.')) return state

  if (kind === 'scientific.node-state') {
    const node = typeof payload.node === 'string' ? payload.node : null
    const nodeState = payload.state
    if (!node || !['running', 'completed', 'failed'].includes(String(nodeState))) return state
    const item: ScientificOrchestrationNode = {
      node,
      state: nodeState as ScientificOrchestrationNodeState,
      round: typeof payload.round === 'number' ? payload.round : state.round,
    }
    return {
      ...state,
      orchestration: {
        ...state.orchestration,
        nodes: replaceById(state.orchestration.nodes, item, (value) => value.node),
      },
    }
  }

  if (kind === 'scientific.agent-state') {
    const agentId = typeof payload.agentId === 'string' ? payload.agentId : null
    const label = typeof payload.label === 'string' ? payload.label : agentId
    const agentState = payload.state
    if (
      !agentId ||
      !label ||
      !['queued', 'running', 'completed', 'skipped', 'failed'].includes(String(agentState))
    )
      return state
    const item: ScientificOrchestrationAgent = {
      agentId,
      label,
      state: agentState as ScientificOrchestrationAgentState,
      round: typeof payload.round === 'number' ? payload.round : state.round,
      ...(payload.executionKind === 'deterministic' || payload.executionKind === 'model'
        ? { executionKind: payload.executionKind }
        : {}),
      ...(typeof payload.message === 'string' ? { message: payload.message } : {}),
    }
    return {
      ...state,
      orchestration: {
        ...state.orchestration,
        agents: replaceById(state.orchestration.agents, item, (value) => value.agentId),
      },
    }
  }

  if (kind === 'scientific.route') {
    const nextRoute = payload.nextRoute
    const item: ScientificOrchestrationRoute = {
      round: typeof payload.round === 'number' ? payload.round : state.round,
      continue: payload.continue === true,
      reason: typeof payload.reason === 'string' ? payload.reason : '未提供路由原因',
      nextRoute: nextRoute === 'A' || nextRoute === 'B' || nextRoute === 'END' ? nextRoute : 'END',
    }
    return {
      ...state,
      orchestration: {
        ...state.orchestration,
        latestRoute: item,
      },
    }
  }

  if (kind === 'scientific.phenomenon') {
    return {
      ...state,
      phenomenon: payload.phenomenon as WorkbenchPhenomenon,
      inputDigest: typeof payload.inputDigest === 'string' ? payload.inputDigest : null,
      retrieval: null,
      status: 'running',
    }
  }
  if (kind === 'scientific.retrieval') {
    const tools = Array.isArray(payload.tools)
      ? payload.tools.flatMap((value) => {
          if (!value || typeof value !== 'object') return []
          const tool = value as Record<string, unknown>
          if (typeof tool.id !== 'string' || typeof tool.label !== 'string') return []
          return [
            {
              id: tool.id,
              label: tool.label,
              status: typeof tool.status === 'string' ? tool.status : 'unknown',
              resultCount: typeof tool.resultCount === 'number' ? tool.resultCount : 0,
            },
          ]
        })
      : []
    return {
      ...state,
      retrieval: {
        stage: typeof payload.stage === 'string' ? payload.stage : 'A',
        status: typeof payload.status === 'string' ? payload.status : 'unknown',
        message: typeof payload.message === 'string' ? payload.message : '资料检索未返回说明。',
        sourceCount: typeof payload.sourceCount === 'number' ? payload.sourceCount : 0,
        paperCount: typeof payload.paperCount === 'number' ? payload.paperCount : 0,
        localCaseCount: typeof payload.localCaseCount === 'number' ? payload.localCaseCount : 0,
        tools,
      },
    }
  }
  if (kind === 'scientific.hypothesis') {
    const hypothesis = payload.hypothesis as WorkbenchHypothesis
    return {
      ...state,
      round: typeof payload.round === 'number' ? Math.max(state.round, payload.round) : state.round,
      hypotheses: replaceById(state.hypotheses, hypothesis, (item) => item.id),
    }
  }
  if (kind === 'scientific.evidence') {
    const evidence = payload.evidence as WorkbenchEvidence
    return {
      ...state,
      round: typeof payload.round === 'number' ? Math.max(state.round, payload.round) : state.round,
      evidence: replaceById(state.evidence, evidence, (item) => item.evidenceId),
    }
  }
  if (kind === 'scientific.processing-result') {
    if (
      typeof payload.processingRunId !== 'string' ||
      typeof payload.snapshotId !== 'string' ||
      typeof payload.caseId !== 'string' ||
      typeof payload.caseLabel !== 'string'
    )
      return state
    const item: WorkbenchProcessingResult = {
      processingRunId: payload.processingRunId,
      snapshotId: payload.snapshotId,
      caseId: payload.caseId,
      caseLabel: payload.caseLabel,
      mode: typeof payload.mode === 'string' ? payload.mode : 'discovery',
      round: typeof payload.round === 'number' ? payload.round : state.round,
      usedObservationCount:
        typeof payload.usedObservationCount === 'number' ? payload.usedObservationCount : 0,
      baselineCaseLabel:
        typeof payload.baselineCaseLabel === 'string' ? payload.baselineCaseLabel : null,
      diagnostics:
        payload.diagnostics && typeof payload.diagnostics === 'object'
          ? (payload.diagnostics as WorkbenchProcessingResult['diagnostics'])
          : {},
      metricsArtifactId:
        typeof payload.metricsArtifactId === 'string' ? payload.metricsArtifactId : '',
      figureArtifactId:
        typeof payload.figureArtifactId === 'string' ? payload.figureArtifactId : '',
      ...(typeof payload.figureUrl === 'string' ? { figureUrl: payload.figureUrl } : {}),
      limitations: Array.isArray(payload.limitations) ? (payload.limitations as string[]) : [],
    }
    return {
      ...state,
      round: Math.max(state.round, item.round),
      processingResults: replaceById(
        state.processingResults,
        item,
        (value) => value.processingRunId,
      ),
    }
  }
  if (kind === 'scientific.validation-task') {
    const task = payload.task as WorkbenchValidationTask
    return {
      ...state,
      round: typeof payload.round === 'number' ? Math.max(state.round, payload.round) : state.round,
      validationTasks: replaceById(state.validationTasks, task, (item) => item.taskId),
    }
  }
  if (kind === 'scientific.self-correction' || kind === 'scientific.correction') {
    const candidate =
      payload.correction && typeof payload.correction === 'object'
        ? (payload.correction as Record<string, unknown>)
        : payload
    const correction: WorkbenchCorrection = {
      correctionId: typeof candidate.correctionId === 'string' ? candidate.correctionId : undefined,
      round: typeof candidate.round === 'number' ? candidate.round : undefined,
      stage: typeof candidate.stage === 'string' ? candidate.stage : 'unknown',
      status:
        typeof candidate.status === 'string'
          ? candidate.status
          : typeof candidate.severity === 'string'
            ? candidate.severity
            : 'unknown',
      action: typeof candidate.action === 'string' ? candidate.action : undefined,
      kind: typeof candidate.kind === 'string' ? candidate.kind : undefined,
      severity: typeof candidate.severity === 'string' ? candidate.severity : undefined,
      message: typeof candidate.message === 'string' ? candidate.message : undefined,
      unavailableSourceIds: Array.isArray(candidate.unavailableSourceIds)
        ? (candidate.unavailableSourceIds as string[])
        : undefined,
    }
    const corrections = correction.correctionId
      ? replaceById(state.corrections, correction, (item) => item.correctionId ?? '')
      : [...state.corrections, correction]
    return {
      ...state,
      corrections,
    }
  }
  if (kind === 'scientific.round-summary') {
    const summary: WorkbenchRoundSummary = {
      round: typeof payload.round === 'number' ? payload.round : state.round,
      conclusion: typeof payload.conclusion === 'string' ? payload.conclusion : '',
      evidenceSummary: payload.evidenceSummary as WorkbenchRoundSummary['evidenceSummary'],
    }
    return {
      ...state,
      round: Math.max(state.round, summary.round),
      conclusion: summary.conclusion,
      roundSummaries: replaceById(state.roundSummaries, summary, (item) => String(item.round)),
    }
  }
  if (kind === 'scientific.loop-complete') {
    const result = payload.result as Record<string, unknown> | undefined
    const status = result?.status
    const hypotheses = Array.isArray(result?.hypotheses)
      ? (result.hypotheses as WorkbenchHypothesis[])
      : state.hypotheses
    const evidence = Array.isArray(result?.evidence)
      ? (result.evidence as WorkbenchEvidence[])
      : state.evidence
    const validationTasks = Array.isArray(result?.validationTasks)
      ? (result.validationTasks as WorkbenchValidationTask[])
      : state.validationTasks
    const corrections = Array.isArray(result?.corrections)
      ? (result.corrections as WorkbenchCorrection[])
      : state.corrections
    return {
      ...state,
      round:
        typeof result?.totalRounds === 'number'
          ? Math.max(state.round, result.totalRounds)
          : state.round,
      hypotheses,
      evidence,
      validationTasks,
      corrections,
      status: status === 'blocked' ? 'blocked' : status === 'failed' ? 'failed' : 'completed',
      conclusion: typeof result?.conclusion === 'string' ? result.conclusion : state.conclusion,
      terminationReason:
        typeof result?.terminationReason === 'string'
          ? result.terminationReason
          : state.terminationReason,
    }
  }
  return state
}
