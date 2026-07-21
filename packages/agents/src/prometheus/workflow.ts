import type { AgentRuntimeConfig, ModelArg } from '@open-scientist/config'
import type { PrometheusOutput } from '@open-scientist/schema'
import type { ConvergenceEntry } from '../shared/convergence.ts'
import { type EmitChunk, streamAgentOutput } from '../shared/stream.ts'
import { createPrometheusAgent } from './agent.ts'

/** Re-exported for backward compatibility — sisyphus/logic.ts consumes this. */
export type { ConvergenceEntry } from '../shared/convergence.ts'

export interface PrometheusWorkflowInput {
  /** Project name — drives shared prometheus workspace dir + MHD output dir. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /** Tournament round (1-based). Drives plan.round + the final-round gate. */
  round: number
  /** Per-round best F1 + surviving hypothesis counts, oldest → newest. */
  convergenceHistory: ConvergenceEntry[]
  /** Best F1 across the pool at the end of this round's Explore+Oracle pass. */
  currentBestF1: number
  /** true = final round (converged or MAX_ROUNDS); Prometheus MUST emit MHD cfg. */
  isFinalRound: boolean
  /** Winning hypothesis — only meaningful when isFinalRound is true. */
  winningHypothesis?: {
    hypoId: string
    statement: string
  }
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * `createPrometheusAgent` via `createModelFromConfig`.
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
   * Optional human-in-the-loop feedback forwarded from the
   * `onReviewLeadingHypothesis` callback in `tournamentWorkflow`. When
   * non-null, Prometheus incorporates this steering input into its plan
   * (e.g. "force another round", "consider alternative mechanism",
   * "the user suspects nanoflares are over-represented"). Forwarded only
   * on non-final rounds; ignored on the final round.
   */
  userFeedback?: string | null
  /**
   * Optional abort signal threaded into `agent.stream({abortSignal})`.
   */
  abortSignal?: AbortSignal
}

/**
 * Prometheus workflow: multi-round planning + (final round) MHD cfg generation.
 *
 * Two modes driven by `isFinalRound`:
 *
 * 1. Non-final round — Prometheus reviews the convergence history (best F1 per
 *    round + surviving counts) and the current leader, then outputs an adjusted
 *    Plan for the next round. mhdConfig = null, shouldContinue = true (unless
 *    F1 >= 0.9 or round >= 10).
 *
 * 2. Final round — Prometheus loads the 'mhd-config-gen' skill, derives
 *    physical parameters from the winning hypothesis, calls the mhdConfig tool
 *    to write `data/projects/<projectId>/mhd/<runId>.cfg`, and embeds the
 *    returned MhdConfig. shouldContinue = false.
 *
 * When `emitChunk` is supplied, every `UIMessageChunk` produced by the agent's
 * `fullStream` is forwarded to it.
 */
export async function prometheusWorkflow(
  input: PrometheusWorkflowInput,
): Promise<PrometheusOutput> {
  const agent = await createPrometheusAgent({
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

  const historyBlock =
    input.convergenceHistory.length > 0
      ? input.convergenceHistory
          .map(
            (e) =>
              `  - Round ${e.round}: bestF1=${e.bestF1.toFixed(4)}, survivingHypotheses=${e.count}`,
          )
          .join('\n')
      : '  (no prior rounds — this is the first planning call)'

  const messageContent = input.isFinalRound
    ? `Final round reached for run ${input.runId} (round ${input.round}). Convergence history:
${historyBlock}
Current best F1: ${input.currentBestF1.toFixed(4)}

Winning hypothesis:
  id: ${input.winningHypothesis?.hypoId ?? '<none>'}
  statement: ${input.winningHypothesis?.statement ?? '<none>'}

Steps:
1. Load the 'mhd-config-gen' skill FIRST for MHD .cfg field layout, parameter derivation from the winning filter thresholds (heating rate vs quiet-Sun ~300 W/m², Lundquist number >> 1 for fast reconnection, plasma_beta ~ 0.01), and the observation proposal format + recommended satellite/instrument table.
2. Derive a physicalParams record from the winning hypothesis statement (plasma_beta, alfven_speed, reynolds_number, lundquist_number, heating_rate, magnetic_topology, ...). Use bash if you need to compute derived dimensionless numbers.
3. Call the mhdConfig tool with runId=${input.runId}, winningHypoId, hypothesisStatement, and physicalParams. It writes data/projects/${input.projectId}/mhd/${input.runId}.cfg and returns the MhdConfig object (cfgPath + observationProposal + summary).
4. Output PrometheusOutput with: plan (round=${input.round}, final-round searchParams + computeBudget + rationale summarising the tournament outcome), mhdConfig = the tool's return value (non-null), shouldContinue = false.`
    : `Tournament round ${input.round} planning for run ${input.runId}.

Convergence history (best F1 per round + surviving hypothesis count):
${historyBlock}
Current best F1: ${input.currentBestF1.toFixed(4)}
${input.userFeedback ? `\nHuman reviewer feedback (from the review_leading_hypothesis node):\n  ${input.userFeedback}\n` : ''}
Convergence rule: set shouldContinue = false when currentBestF1 >= 0.9 OR round >= 10. Otherwise shouldContinue = true.

Steps:
1. Review the score trajectory above. If F1 is plateauing, narrow paramRange and lower mutationRate (exploit). If F1 is still climbing or variance is high, widen paramRange and raise mutationRate (explore). If surviving count is collapsing, raise populationSize.${input.userFeedback ? ' Incorporate the human reviewer feedback into your plan — it may override the default explore/exploit heuristic.' : ''}
2. Allocate computeBudget: raise maxEvals / parallelWorkers when the round is high-value (near convergence); throttle when the search is clearly stuck.
3. Output PrometheusOutput with: plan (round=${input.round}, adjusted searchParams.paramRange as a record of name -> [min, max], populationSize, mutationRate, computeBudget { maxEvals, parallelWorkers }, rationale explaining the explore/exploit tradeoff${input.userFeedback ? ' + how the reviewer feedback was incorporated' : ''}), mhdConfig = null, shouldContinue per the rule above.`

  const result = await agent.stream({
    messages: [
      {
        role: 'user',
        content: messageContent,
      },
    ],
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })

  await streamAgentOutput(result.fullStream, agent.tools, input.emitChunk)
  return result.output
}
