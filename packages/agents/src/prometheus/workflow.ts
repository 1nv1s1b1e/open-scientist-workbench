'use workflow'

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { PrometheusOutput } from '@open-scientist/schema'
import type { LanguageModel } from 'ai'
import { getWritable } from 'workflow'
import { createPrometheusAgent } from './agent.js'

/** One entry of the per-round convergence history Prometheus sees. */
export interface ConvergenceEntry {
  round: number
  bestF1: number
  /** Count of surviving hypotheses that round (post-Oracle pruning). */
  count: number
}

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
  /** Pre-resolved language model (Sisyphus resolves via getAgentModel before spawning). */
  model: LanguageModel
}

/**
 * Prometheus workflow: multi-round planning + (final round) MHD cfg generation.
 *
 * Two modes driven by `isFinalRound`:
 *
 * 1. Non-final round — Prometheus reviews the convergence history (best F1 per
 *    round + surviving counts) and the current leader, then outputs an adjusted
 *    Plan for the next round (paramRange / populationSize / mutationRate +
 *    computeBudget maxEvals / parallelWorkers) with rationale. mhdConfig = null,
 *    shouldContinue = true (unless F1 >= 0.9 or round >= 10).
 *
 * 2. Final round — Prometheus loads the 'mhd-config-gen' skill, derives physical
 *    parameters from the winning hypothesis, calls the mhdConfig tool to write
 *    `data/projects/<projectId>/mhd/<runId>.cfg`, and embeds the returned
 *    MhdConfig (cfgPath + observationProposal + summary). shouldContinue = false.
 *
 * The agent.stream() call runs inside a workflow context — `getWritable()` only
 * resolves here. runtimeContext carries only serializable identifiers
 * (projectId / runId / round); the bash toolkit + HelixDB clients are
 * reconstructed inside createPrometheusAgent from projectId.
 */
export async function prometheusWorkflow(
  input: PrometheusWorkflowInput,
): Promise<PrometheusOutput> {
  const agent = await createPrometheusAgent({
    model: input.model,
    projectId: input.projectId,
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

Convergence rule: set shouldContinue = false when currentBestF1 >= 0.9 OR round >= 10. Otherwise shouldContinue = true.

Steps:
1. Review the score trajectory above. If F1 is plateauing, narrow paramRange and lower mutationRate (exploit). If F1 is still climbing or variance is high, widen paramRange and raise mutationRate (explore). If surviving count is collapsing, raise populationSize.
2. Allocate computeBudget: raise maxEvals / parallelWorkers when the round is high-value (near convergence); throttle when the search is clearly stuck.
3. Output PrometheusOutput with: plan (round=${input.round}, adjusted searchParams.paramRange as a record of name -> [min, max], populationSize, mutationRate, computeBudget { maxEvals, parallelWorkers }, rationale explaining the explore/exploit tradeoff), mhdConfig = null, shouldContinue per the rule above.`

  const result = await agent.stream({
    messages: [
      {
        role: 'user',
        content: messageContent,
      },
    ],
    writable: getWritable<ModelCallStreamPart>(),
    runtimeContext: {
      projectId: input.projectId,
      runId: input.runId,
      round: input.round,
    },
  })

  return result.output
}
