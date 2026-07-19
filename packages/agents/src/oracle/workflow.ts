'use workflow'

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { EvalResult, Hypothesis, OracleOutput } from '@open-scientist/schema'
import type { LanguageModel } from 'ai'
import { getWritable } from 'workflow'
import { createOracleAgent } from './agent.js'
import { buildEvalSummaryBlock, buildHypothesesBlock } from './logic.js'

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
  /** Pre-resolved language model (Sisyphus resolves via getAgentModel before spawning). */
  model: LanguageModel
}

/**
 * Oracle workflow: Co-Scientist critique + AlphaEvolve mutation over a round's
 * evaluated hypotheses.
 *
 * Consumes the round's hypotheses (with their F1 scores) and Explore's EvalResults
 * (with counterexamples), then runs the Oracle agent to produce critiques, mutations,
 * eliminations, and (optionally) a winner if the tournament has converged this round.
 *
 * The agent.stream() call runs inside a workflow context — `getWritable()` only
 * resolves here. runtimeContext carries only serializable identifiers
 * (projectId / runId / round); no HelixDB clients or DB handles cross the boundary.
 */
export async function oracleWorkflow(input: OracleWorkflowInput): Promise<OracleOutput> {
  const agent = await createOracleAgent({
    model: input.model,
    projectId: input.projectId,
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
    writable: getWritable<ModelCallStreamPart>(),
    runtimeContext: {
      projectId: input.projectId,
      runId: input.runId,
      round: input.round,
    },
  })

  return result.output
}
