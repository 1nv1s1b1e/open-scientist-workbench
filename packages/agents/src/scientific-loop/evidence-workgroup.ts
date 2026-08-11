import type {
  EvidenceRecord,
  MemoryEntry,
  PhenomenonInput,
  ScientificHypothesis,
  ValidationTask,
} from '@open-scientist/schema'

export type EvidenceAgentCapability =
  | 'source-audit'
  | 'literature-retrieval'
  | 'history-search'
  | 'observation-analysis'
  | 'timeseries-analysis'
  | 'image-analysis'
  | 'spectrum-analysis'
  | 'simulation'
  | 'counterexample-search'
  | 'cross-validation'
  | 'fact-check'

export interface EvidenceAgentContext {
  phenomenon: PhenomenonInput
  hypotheses: readonly ScientificHypothesis[]
  evidence: readonly EvidenceRecord[]
  validationTasks: readonly ValidationTask[]
  memory?: readonly MemoryEntry[]
  round: number
  signal?: AbortSignal
}

export interface EvidenceAgentCorrection {
  stage: string
  severity: 'info' | 'warning' | 'error'
  message: string
  action: string
  affectedIds?: string[]
}

export interface EvidenceAgentOutput {
  evidence?: EvidenceRecord[]
  validationTasks?: ValidationTask[]
  verifiedSourceIds?: string[]
  limitations?: string[]
  notes?: string[]
  corrections?: EvidenceAgentCorrection[]
}

export interface EvidenceAgent {
  id: string
  label: string
  /**
   * Deterministic workers compute/audit data. Model workers interpret the
   * structured results and are scheduled after the deterministic phase so
   * they can critique real upstream outputs rather than parallel placeholders.
   */
  executionKind?: 'deterministic' | 'model'
  capabilities: EvidenceAgentCapability[]
  canRun?: (
    context: Readonly<EvidenceAgentContext>,
  ) => boolean | Promise<boolean>
  run: (
    context: Readonly<EvidenceAgentContext>,
  ) => EvidenceAgentOutput | Promise<EvidenceAgentOutput>
}

export type EvidenceAgentExecutionStatus =
  | 'completed'
  | 'skipped'
  | 'failed'

export interface EvidenceAgentExecution {
  agentId: string
  label: string
  capabilities: EvidenceAgentCapability[]
  status: EvidenceAgentExecutionStatus
  output?: EvidenceAgentOutput
  error?: string
}

export interface EvidenceAgentStateEvent {
  agentId: string
  label: string
  executionKind?: 'deterministic' | 'model'
  state: 'queued' | 'running' | EvidenceAgentExecutionStatus
  message?: string
}

export interface EvidenceWorkgroupOptions {
  onAgentState?: (
    event: EvidenceAgentStateEvent,
  ) => void | Promise<void>
}

export interface EvidenceWorkgroupResult {
  executions: EvidenceAgentExecution[]
  evidence: EvidenceRecord[]
  validationTasks: ValidationTask[]
  verifiedSourceIds: string[]
  limitations: string[]
  notes: string[]
  corrections: EvidenceAgentCorrection[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('evidence workgroup aborted')
}

function assertUniqueAgentIds(agents: readonly EvidenceAgent[]): void {
  const seen = new Set<string>()
  for (const agent of agents) {
    if (!agent.id) throw new Error('evidence agent id must be non-empty')
    if (seen.has(agent.id)) {
      throw new Error(`duplicate evidence agent id: ${agent.id}`)
    }
    seen.add(agent.id)
  }
}

export async function runEvidenceWorkgroup(
  agents: readonly EvidenceAgent[],
  context: EvidenceAgentContext,
  options: EvidenceWorkgroupOptions = {},
): Promise<EvidenceWorkgroupResult> {
  assertUniqueAgentIds(agents)
  throwIfAborted(context.signal)

  const notify = async (event: EvidenceAgentStateEvent): Promise<void> => {
    await options.onAgentState?.(event)
  }

  const executions = await Promise.all(
    agents.map(async (agent): Promise<EvidenceAgentExecution> => {
      await notify({
        agentId: agent.id,
        label: agent.label,
        state: 'queued',
      })
      try {
        const eligible = agent.canRun ? await agent.canRun(context) : true
        if (!eligible) {
          await notify({
            agentId: agent.id,
            label: agent.label,
            state: 'skipped',
          })
          return {
            agentId: agent.id,
            label: agent.label,
            capabilities: [...agent.capabilities],
            status: 'skipped',
          }
        }
        throwIfAborted(context.signal)
        await notify({
          agentId: agent.id,
          label: agent.label,
          state: 'running',
        })
        const output = await agent.run(context)
        throwIfAborted(context.signal)
        await notify({
          agentId: agent.id,
          label: agent.label,
          state: 'completed',
        })
        return {
          agentId: agent.id,
          label: agent.label,
          capabilities: [...agent.capabilities],
          status: 'completed',
          output,
        }
      } catch (error) {
        if (context.signal?.aborted) throw error
        const message = errorMessage(error)
        await notify({
          agentId: agent.id,
          label: agent.label,
          state: 'failed',
          message,
        })
        return {
          agentId: agent.id,
          label: agent.label,
          capabilities: [...agent.capabilities],
          status: 'failed',
          error: message,
        }
      }
    }),
  )

  const evidence: EvidenceRecord[] = []
  const validationTasks: ValidationTask[] = []
  const verifiedSourceIds = new Set<string>()
  const limitations: string[] = []
  const notes: string[] = []
  const corrections: EvidenceAgentCorrection[] = []

  for (const execution of executions) {
    if (execution.status === 'failed') {
      limitations.push(
        `智能体 ${execution.label} 执行失败：${execution.error ?? '未知错误'}`,
      )
      continue
    }
    if (execution.status !== 'completed' || !execution.output) continue
    evidence.push(...(execution.output.evidence ?? []))
    validationTasks.push(...(execution.output.validationTasks ?? []))
    for (const sourceId of execution.output.verifiedSourceIds ?? []) {
      verifiedSourceIds.add(sourceId)
    }
    limitations.push(...(execution.output.limitations ?? []))
    notes.push(...(execution.output.notes ?? []))
    corrections.push(...(execution.output.corrections ?? []))
  }

  return {
    executions,
    evidence,
    validationTasks,
    verifiedSourceIds: [...verifiedSourceIds],
    limitations,
    notes,
    corrections,
  }
}
