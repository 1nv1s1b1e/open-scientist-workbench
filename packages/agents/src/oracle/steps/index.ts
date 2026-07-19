// 'use step' retryable steps for the Oracle workflow.
//
// The workflow VM (`@workflow/core`) runs workflow bodies in a `vm.Script`
// context with NO `importModuleDynamically` callback — any `await import()`
// inside a workflow body throws `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
// `'use step'` functions execute on the host Node runtime instead, so dynamic
// imports (and Node module usage) work normally here.
//
// Therefore the agent factory (`createOracleAgent`, which statically imports
// tools/skills/config → node:fs/node:path) MUST be imported dynamically inside
// the step body, never statically at module top-level — otherwise the esbuild
// workflow bundle would drag the whole Node module chain in and the VM would
// reject it. Top-level imports here are restricted to type-only imports (which
// esbuild erases) plus `workflow`'s `getWritable` (the VM-safe step variant
// that writes to the workflow run server stream via `contextStorage`).
//
// `./logic.js` is safe to statically import here because it only has type-only
// imports from `@open-scientist/schema` (erased by esbuild), so it does not
// drag any Node modules into the bundle.

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { ModelArg } from '@open-scientist/config'
import type { EvalResult, Hypothesis, OracleOutput } from '@open-scientist/schema'
import { getWritable } from 'workflow'
import { buildEvalSummaryBlock, buildHypothesesBlock } from '../logic.ts'

/** Input to `runOracleStep` — matches `OracleWorkflowInput` 1:1. */
export interface RunOracleStepInput {
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
   * `createOracleAgent` via `createModelFromConfig`. The step only forwards
   * the plain object; it never touches a `LanguageModel` instance.
   */
  modelConfig: ModelArg
}

/**
 * Run the Oracle agent end-to-end inside a `'use step'` boundary.
 *
 * This wraps the entire `createOracleAgent` + `agent.stream` loop so that:
 *   1. The dynamic `import('../agent.ts')` runs on the host Node runtime
 *      (steps execute outside the VM sandbox), avoiding
 *      `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
 *   2. `getWritable<ModelCallStreamPart>()` resolves via `contextStorage`
 *      (the step-context variant of `getWritable`) and streams agent output
 *      events to the workflow run server stream — readable via the API SSE
 *      endpoint exactly as before.
 *   3. The agent's internal `stopWhen: isStepCount(25)` tool loop is
 *      unaffected — retry granularity here is coarser (one step per agent
 *      run), but agent-internal retries are unchanged.
 *
 * Returns the structured `OracleOutput` (serializable across the step →
 * workflow boundary).
 */
export async function runOracleStep(input: RunOracleStepInput): Promise<OracleOutput> {
  'use step'
  const { createOracleAgent } = await import('../agent.ts')
  const agent = await createOracleAgent({
    modelConfig: input.modelConfig,
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
