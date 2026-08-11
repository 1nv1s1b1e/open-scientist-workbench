import {
  END,
  ReducedValue,
  Send,
  START,
  StateGraph,
  StateSchema,
} from '@langchain/langgraph'
import {
  EvidenceRecordSchema,
  PhenomenonInputSchema,
  ScientificHypothesisSchema,
  ValidationTaskSchema,
} from '@open-scientist/schema'
import { z } from 'zod'
import { buildScientificContext } from './context-builder.ts'
import type {
  EvidenceAgent,
  EvidenceAgentContext,
  EvidenceAgentExecution,
  EvidenceAgentStateEvent,
  EvidenceWorkgroupOptions,
  EvidenceWorkgroupResult,
} from './evidence-workgroup.ts'

interface OrderedExecution {
  order: number
  execution: EvidenceAgentExecution
}

const OrderedExecutionSchema = z.custom<OrderedExecution>()

const EvidenceSubgraphState = new StateSchema({
  phenomenon: PhenomenonInputSchema,
  hypotheses: z.array(ScientificHypothesisSchema).default([]),
  evidence: z.array(EvidenceRecordSchema).default([]),
  validationTasks: z.array(ValidationTaskSchema).default([]),
  round: z.number().int().min(0),
  workerAgentId: z.string().optional(),
  workerIndex: z.number().int().min(0).optional(),
  workerExecutions: new ReducedValue(
    z.array(OrderedExecutionSchema).default([]),
    {
      reducer: (current, next) => current.concat(next),
    },
  ),
  result: z.custom<EvidenceWorkgroupResult>().optional(),
})

type EvidenceSubgraphStateValue = typeof EvidenceSubgraphState.State

export interface EvidenceSubgraphOptions extends EvidenceWorkgroupOptions {
  signal?: AbortSignal
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

function aggregateExecutions(
  ordered: readonly OrderedExecution[],
): EvidenceWorkgroupResult {
  const executions = [...ordered]
    .sort((left, right) => left.order - right.order)
    .map((item) => item.execution)
  const evidence = []
  const validationTasks = []
  const verifiedSourceIds = new Set<string>()
  const limitations: string[] = []
  const notes: string[] = []
  const corrections = []

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
function summarizeWorkerOutput(output: NonNullable<EvidenceAgentExecution['output']>): string {
  const primary = output.notes?.[0]
    ?? output.limitations?.[0]
    ?? output.evidence?.[0]?.observed
    ?? output.evidence?.[0]?.claim
    ?? '已完成本轮核验'
  const evidenceCount = output.evidence?.length ?? 0
  const taskCount = output.validationTasks?.length ?? 0
  const suffix = evidenceCount || taskCount ? `；证据 ${evidenceCount} 条；任务 ${taskCount} 项` : ''
  return `${primary}${suffix}`.replace(/\s+/g, ' ').slice(0, 900)
}


export function createEvidenceSubgraph(
  agents: readonly EvidenceAgent[],
  options: EvidenceSubgraphOptions = {},
) {
  assertUniqueAgentIds(agents)
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const notify = async (event: EvidenceAgentStateEvent): Promise<void> => {
    await options.onAgentState?.(event)
  }

  return new StateGraph(EvidenceSubgraphState)
    .addNode('B.dispatch', async () => {
      throwIfAborted(options.signal)
      await Promise.all(
        agents.map((agent) =>
          notify({
            agentId: agent.id,
            label: agent.label,
            state: 'queued',
          }),
        ),
      )
      return {}
    })
    .addNode('B.worker', async (state: EvidenceSubgraphStateValue) => {
      throwIfAborted(options.signal)
      const agentId = state.workerAgentId
      const order = state.workerIndex
      if (agentId === undefined || order === undefined) {
        throw new Error('LangGraph B worker is missing its dispatch identity')
      }
      const agent = byId.get(agentId)
      if (!agent) throw new Error(`evidence agent is not registered: ${agentId}`)

      const projected = buildScientificContext({
        stage: 'B',
        state,
        capabilities: agent.capabilities,
      })
      const context: EvidenceAgentContext = {
        phenomenon: projected.phenomenon,
        hypotheses: projected.hypotheses,
        evidence: projected.evidence,
        validationTasks: projected.validationTasks,
        round: projected.round,
        ...(options.signal ? { signal: options.signal } : {}),
      }

      try {
        const eligible = agent.canRun ? await agent.canRun(context) : true
        if (!eligible) {
          await notify({
            agentId: agent.id,
            label: agent.label,
            state: 'skipped',
          })
          return {
            workerExecutions: [{
              order,
              execution: {
                agentId: agent.id,
                label: agent.label,
                capabilities: [...agent.capabilities],
                status: 'skipped',
              },
            }],
          }
        }

        throwIfAborted(options.signal)
        await notify({
          agentId: agent.id,
          label: agent.label,
          state: 'running',
        })
        const output = await agent.run(context)
        throwIfAborted(options.signal)
        await notify({
          agentId: agent.id,
          label: agent.label,
          state: 'completed',
          message: summarizeWorkerOutput(output),
        })
        return {
          workerExecutions: [{
            order,
            execution: {
              agentId: agent.id,
              label: agent.label,
              capabilities: [...agent.capabilities],
              status: 'completed',
              output,
            },
          }],
        }
      } catch (error) {
        if (options.signal?.aborted) throw error
        const message = errorMessage(error)
        await notify({
          agentId: agent.id,
          label: agent.label,
          state: 'failed',
          message,
        })
        return {
          workerExecutions: [{
            order,
            execution: {
              agentId: agent.id,
              label: agent.label,
              capabilities: [...agent.capabilities],
              status: 'failed',
              error: message,
            },
          }],
        }
      }
    })
    .addNode('B.aggregate', (state: EvidenceSubgraphStateValue) => ({
      result: aggregateExecutions(state.workerExecutions),
    }))
    .addEdge(START, 'B.dispatch')
    .addConditionalEdges(
      'B.dispatch',
      (state: EvidenceSubgraphStateValue) => {
        if (agents.length === 0) return 'B.aggregate'
        return agents.map((agent, order) =>
          new Send('B.worker', {
            phenomenon: state.phenomenon,
            hypotheses: state.hypotheses,
            evidence: state.evidence,
            validationTasks: state.validationTasks,
            round: state.round,
            workerAgentId: agent.id,
            workerIndex: order,
          }),
        )
      },
    )
    .addEdge('B.worker', 'B.aggregate')
    .addEdge('B.aggregate', END)
    .compile()
}

export async function runLangGraphEvidenceWorkgroup(
  agents: readonly EvidenceAgent[],
  context: EvidenceAgentContext,
  options: EvidenceSubgraphOptions = {},
): Promise<EvidenceWorkgroupResult> {
  const graph = createEvidenceSubgraph(agents, {
    ...options,
    signal: options.signal ?? context.signal,
  })
  const state = await graph.invoke({
    phenomenon: context.phenomenon,
    hypotheses: [...context.hypotheses],
    evidence: [...context.evidence],
    validationTasks: [...context.validationTasks],
    round: context.round,
    workerExecutions: [],
  })
  if (!state.result) throw new Error('LangGraph B aggregate did not produce a result')
  return state.result
}
