import type { AgentRuntimeConfig, ModelArg } from '@open-scientist/config'
import type { EvalResult, Hypothesis, OracleOutput } from '@open-scientist/schema'
import { type EmitChunk, streamAgentOutput } from '../shared/stream.ts'
import { createOracleAgent } from './agent.ts'
import { buildEvalSummaryBlock, buildHypothesesBlock } from './logic.ts'

export interface OracleWorkflowInput {
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /** Tournament round (1-based). Oracle consumes Explore's EvalResults from this round. */
  round: number
  /** Hypotheses under critique this round (each carries its latest f1 + status). */
  hypotheses: Hypothesis[]
  /** Explore evaluation results aligned 1:1 with hypotheses by hypoId. */
  evalResults: EvalResult[]
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * `createOracleAgent` via `createModelFromConfig`.
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
   * the agent's `fullStream` is forwarded to this callback.
   */
  emitChunk?: EmitChunk
  /**
   * Optional abort signal threaded into `agent.stream({abortSignal})`.
   */
  abortSignal?: AbortSignal
}

/**
 * Oracle workflow: Co-Scientist critique + mutation + elimination for one
 * tournament round.
 *
 * When `emitChunk` is supplied, every `UIMessageChunk` produced by the agent's
 * `fullStream` is forwarded to it.
 */
export async function oracleWorkflow(input: OracleWorkflowInput): Promise<OracleOutput> {
  const agent = await createOracleAgent({
    modelConfig: input.agentConfig?.modelConfig ?? input.modelConfig,
    projectId: input.projectId,
    runtimeContext: {
      projectId: input.projectId,
      runId: input.runId,
      round: input.round,
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

  const hypothesesBlock = buildHypothesesBlock(input.hypotheses, input.evalResults)
  const evalSummaryBlock = buildEvalSummaryBlock(input.evalResults)

  const result = await agent.stream({
    messages: [
      {
        role: 'user',
        content: `Oracle round ${input.round} (runId=${input.runId}, projectId=${input.projectId}).

Below are the ${input.hypotheses.length} hypotheses evaluated this round, each with its F1 score and Explore counterexamples. Your job: critique every hypothesis, mutate the high-potential ones, eliminate the fatal / low-F1 ones, and name a winner ONLY if the tournament has clearly converged this round.

Eval summary:
${evalSummaryBlock || '  (no eval results yet)'}

Hypotheses + counterexamples:
${hypothesesBlock}

Steps:
1. Load the 'critique-protocol' and 'hypothesis-mutation' skills first for the 5-dimension scoring rubric, severity mapping, mutation operators, and counterexample-debug flow.
2. For EACH hypothesis: issue one Critique with severity (fatal/major/minor) grounded in a specific Explore counterexample or a physical conservation law. Use getCritiquesByHypothesis to avoid repeating prior-round points.
3. Persist each critique to HelixDB via addCritique (createdAt = now ISO 8601).
4. For high-potential parents (major critiques that look fixable): generate Mutations following the 4 AlphaEvolve operators. Each mutatedHypothesis must be a full Hypothesis with a fresh id, parentId = parentHypoId, round = ${input.round}, status = 'mutated', and a pythonCode consistent with its statement. Optionally use bash/writeFile to sanity-check the mutated filter on representative snapshot inputs.
5. Record MUTATED_FROM edges via addMutationLink(parentHypoId, childHypoId, mutationType). Use getEvolutionChain (via HelixDB) to avoid cyclic mutations back to eliminated forms.
6. Fill eliminatedIds with the ids of hypotheses you eliminate this round (fatal critiques or persistently low F1).
7. Set winningHypoId to the winning hypothesis id ONLY if convergence is reached this round; otherwise leave it null.

Return OracleOutput (critiques[], mutations[], eliminatedIds[], winningHypoId). Each major/fatal critique must pair with either a mutation or an elimination.`,
      },
    ],
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })

  await streamAgentOutput(result.fullStream, agent.tools, input.emitChunk)
  return result.output
}
