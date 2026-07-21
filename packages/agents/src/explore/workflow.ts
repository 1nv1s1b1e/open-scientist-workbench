import type { AgentRuntimeConfig, ModelArg } from '@open-scientist/config'
import type { EvalResult } from '@open-scientist/schema'
import { type EmitChunk, streamAgentOutput } from '../shared/stream.ts'
import { createExploreAgent } from './agent.ts'

export interface ExploreWorkflowInput {
  /** Hypothesis id — drives per-hypothesis workspace isolation. */
  hypoId: string
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /** Tournament round (1-based). Round 1 = initial Librarian pool evaluation. */
  round: number
  /** The hypothesis to evaluate. */
  hypothesis: {
    statement: string
    pythonCode: string
  }
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * `createExploreAgent` via `createModelFromConfig`.
   */
  modelConfig: ModelArg
  /**
   * Per-agent runtime config override (instructions / skillDirectories /
   * mcpServers). When present, its `modelConfig` takes priority over the
   * `modelConfig` field above and its non-model fields override the factory
   * defaults. Undefined → fully default behaviour (backward compat).
   */
  agentConfig?: AgentRuntimeConfig
  /**
   * Optional SSE chunk sink. When provided, each `UIMessageChunk` produced by
   * the agent's `fullStream` is forwarded to this callback. The orchestrator
   * uses it to buffer chunks for SSE replay / reconnect.
   */
  emitChunk?: EmitChunk
  /**
   * Optional abort signal threaded into `agent.stream({abortSignal})`.
   */
  abortSignal?: AbortSignal
}

/**
 * Explore workflow: AlphaEvolve deterministic evaluation of one hypothesis.
 *
 * Spawns a fresh ExploreAgent bound to a per-hypothesis bash workspace, runs
 * the hypothesis' Python filter against the 1.75M snapshot dataset, and
 * returns the EvalResult (F1 + counterexamples). The orchestrator
 * parallelizes this across the hypothesis pool via `Promise.all`.
 *
 * When `emitChunk` is supplied, every `UIMessageChunk` produced by the agent's
 * `fullStream` is forwarded to it (after conversion via `toUIMessageStream`).
 */
export async function exploreWorkflow(input: ExploreWorkflowInput): Promise<EvalResult> {
  const agent = await createExploreAgent({
    modelConfig: input.agentConfig?.modelConfig ?? input.modelConfig,
    project: input.projectId,
    hypoId: input.hypoId,
    runtimeContext: {
      projectId: input.projectId,
      runId: input.runId,
      round: input.round,
      hypoId: input.hypoId,
    },
    ...(input.agentConfig?.instructions !== undefined
      ? { instructions: input.agentConfig.instructions }
      : {}),
    ...(input.agentConfig?.skillDirectories !== undefined
      ? { skillDirectories: input.agentConfig.skillDirectories }
      : {}),
    ...(input.agentConfig?.mcpServers !== undefined
      ? { mcpServers: input.agentConfig.mcpServers }
      : {}),
  })

  const result = await agent.stream({
    messages: [
      {
        role: 'user',
        content: `Evaluate this hypothesis against the 1.75M solar physics snapshot dataset.

Hypothesis id: ${input.hypoId}
Run id: ${input.runId}
Round: ${input.round}

Statement:
${input.hypothesis.statement}

Python filter code:
\`\`\`python
${input.hypothesis.pythonCode}
\`\`\`

Steps:
1. Load the 'fits-snapshot-search' skill first for snapshot dataset structure + F1 contract + Python env setup.
2. Write the filter to filter.py in the working directory.
3. Write run.py that loads snapshots, imports filter, evaluates all 1.75M, prints TP/FP/FN/F1 + first 5-10 counterexamples.
4. Set up Python env if needed (python3 -m venv .venv && source .venv/bin/activate && uv pip install astropy sunpy scipy numpy).
5. Run python3 run.py, read stdout, debug counterexamples, modify code, re-run until F1 converges or you hit the step limit.
6. Return EvalResult with hypoId=${input.hypoId}, f1, truePositives, falsePositives, falseNegatives, counterexamples[] (physically specific), logs (commands + key stdout), executionMs.`,
      },
    ],
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })

  await streamAgentOutput(result.fullStream, agent.tools, input.emitChunk)
  return result.output
}
