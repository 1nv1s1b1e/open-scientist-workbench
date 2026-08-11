import { getProjectDir, type AgentRuntimeConfig, type ModelArg } from '@open-scientist/config'
import {
  createValidationTask,
  persistScientificRecords,
} from '@open-scientist/storage'
import {
  type PhenomenonInput,
  type ScientificLoopResult,
} from '@open-scientist/schema'
import type { EmitChunk } from '../shared/stream.ts'
import {
  createProjectScientificRuntime,
  type ScientificGraphRuntime,
} from '../orchestration/langgraph-runtime.ts'
import {
  createDefaultScientificDependencies,
  parsePhenomenon,
} from './default-services.ts'
import {
  runScientificLoopGraph,
} from './scientific-graph.ts'
import type { ScientificGraphDependencies } from './services.ts'

const DEFAULT_MAX_ROUNDS = 3

export interface ScientificLoopWorkflowInput {
  /** @deprecated The scientific loop is driven by phenomenon, not a seed. */
  seed?: string
  projectId: string
  runId: string
  modelConfig: ModelArg
  phenomenon?: PhenomenonInput
  maxRounds?: number
  localGrounded?: boolean
  agentConfigs?: Record<string, AgentRuntimeConfig>
  emitChunk?: EmitChunk
  abortSignal?: AbortSignal
  /** Injectable services for tests and registered application adapters. */
  graphDependencies?: ScientificGraphDependencies
  /** Injectable checkpoint runtime for API resume and deterministic tests. */
  runtime?: ScientificGraphRuntime
  /** Continue this run from the latest LangGraph checkpoint. */
  resume?: boolean
}

/**
 * The only production entrypoint for the scientific loop.
 *
 * The old hand-written round loop has been removed. LangGraph owns the
 * run-scoped State and checkpoint; default agents receive a projected Context
 * and do not own cross-task or cross-session memory.
 */
export async function scientificLoopWorkflow(
  input: ScientificLoopWorkflowInput,
): Promise<ScientificLoopResult> {
  const phenomenon = input.phenomenon ? parsePhenomenon(input.phenomenon) : undefined
  const runtime = input.runtime ?? createProjectScientificRuntime(input.projectId)
  const dependencies = input.graphDependencies ?? createDefaultScientificDependencies({
    projectId: input.projectId,
    runId: input.runId,
    modelConfig: input.modelConfig,
    agentConfigs: input.agentConfigs,
    emitChunk: input.emitChunk,
    abortSignal: input.abortSignal,
    localGrounded: input.localGrounded,
  })

  try {
    const result = await runScientificLoopGraph(
      {
        projectId: input.projectId,
        runId: input.runId,
        ...(phenomenon ? { phenomenon } : {}),
        maxRounds: input.maxRounds ?? DEFAULT_MAX_ROUNDS,
        emitChunk: input.emitChunk,
        abortSignal: input.abortSignal,
        runtime,
        resume: input.resume,
      },
      dependencies,
    )
    await persistScientificRecords(input.projectId, {
      projectId: input.projectId,
      runId: input.runId,
      hypotheses: result.hypotheses,
      evidence: result.evidence,
      corrections: result.corrections,
    })
    for (const task of result.validationTasks) {
      await createValidationTask(input.projectId, {
        ...task,
        projectId: input.projectId,
        runId: input.runId,
      })
    }
    return result
  } finally {
    if (!input.runtime) runtime.close()
  }
}

/** Keeps the project directory importable for integrations that use this module. */
export function scientificProjectDir(projectId: string): string {
  return getProjectDir(projectId)
}
