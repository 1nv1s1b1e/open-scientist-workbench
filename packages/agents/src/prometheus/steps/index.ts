// 'use step' retryable steps for the Prometheus workflow.
//
// The workflow VM (`@workflow/core`) runs workflow bodies in a `vm.Script`
// context with NO `importModuleDynamically` callback — any `await import()`
// inside a workflow body throws `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
// `'use step'` functions execute on the host Node runtime instead, so dynamic
// imports (and Node module usage) work normally here.
//
// Therefore the agent factory (`createPrometheusAgent`, which statically
// imports tools/skills/config → node:fs/node:path) MUST be imported dynamically
// inside the step body, never statically at module top-level — otherwise the
// esbuild workflow bundle would drag the whole Node module chain in and the VM
// would reject it. Top-level imports here are restricted to type-only imports
// (which esbuild erases) plus `workflow`'s `getWritable` (the VM-safe step
// variant that writes to the workflow run server stream via `contextStorage`).

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { AgentRuntimeConfig, ModelArg } from '@open-scientist/config'
import type { PrometheusOutput } from '@open-scientist/schema'
import { getWritable } from 'workflow'
import type { ConvergenceEntry } from '../workflow.ts'

/** Input to `runPrometheusStep` — matches `PrometheusWorkflowInput` 1:1. */
export interface RunPrometheusStepInput {
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
   * `createPrometheusAgent` via `createModelFromConfig`. The step only forwards
   * the plain object; it never touches a `LanguageModel` instance.
   */
  modelConfig: ModelArg
  /**
   * Per-agent runtime config override (instructions / skillDirectories /
   * mcpServers). When present, its `modelConfig` takes priority over the
   * `modelConfig` field above and its non-model fields override the factory
   * defaults. Undefined → fully default behaviour (backward compat).
   */
  agentConfig?: AgentRuntimeConfig
}

/**
 * Run the Prometheus agent end-to-end inside a `'use step'` boundary.
 *
 * This wraps the entire `createPrometheusAgent` + `agent.stream` loop so that:
 *   1. The dynamic `import('../agent.ts')` runs on the host Node runtime
 *      (steps execute outside the VM sandbox), avoiding
 *      `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
 *   2. `getWritable<ModelCallStreamPart>()` resolves via `contextStorage`
 *      (the step-context variant of `getWritable`) and streams agent output
 *      events to the workflow run server stream — readable via the API SSE
 *      endpoint exactly as before.
 *   3. The agent's internal `stopWhen: isStepCount(20)` tool loop is
 *      unaffected — retry granularity here is coarser (one step per agent
 *      run), but agent-internal retries are unchanged.
 *
 * Returns the structured `PrometheusOutput` (serializable across the step →
 * workflow boundary).
 */
export async function runPrometheusStep(input: RunPrometheusStepInput): Promise<PrometheusOutput> {
  'use step'
  const { createPrometheusAgent } = await import('../agent.ts')
  const agent = await createPrometheusAgent({
    modelConfig: input.agentConfig?.modelConfig ?? input.modelConfig,
    projectId: input.projectId,
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
