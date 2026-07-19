'use workflow'

import type { PrometheusOutput } from '@open-scientist/schema'
import { type RunPrometheusStepInput, runPrometheusStep } from './steps/index.ts'

/** One entry of the per-round convergence history Prometheus sees. */
export interface ConvergenceEntry {
  round: number
  bestF1: number
  /** Count of surviving hypotheses that round (post-Oracle pruning). */
  count: number
}

export interface PrometheusWorkflowInput extends RunPrometheusStepInput {}

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
 * 2. Final round — Prometheus loads the 'mhd-config-gen' skill, derives
 *    physical parameters from the winning hypothesis, calls the mhdConfig tool
 *    to write `data/projects/<projectId>/mhd/<runId>.cfg`, and embeds the
 *    returned MhdConfig (cfgPath + observationProposal + summary).
 *    shouldContinue = false.
 *
 * The workflow body is a thin VM-safe wrapper — all agent construction +
 * `agent.stream()` happens inside `runPrometheusStep` (a `'use step'` function
 * that executes on the host Node runtime, not the VM sandbox). This is
 * required because:
 *   - The VM (`@workflow/core`) provides no `importModuleDynamically` callback,
 *     so any `await import()` inside the workflow body throws
 *     `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
 *   - `createPrometheusAgent` statically imports tools/skills/config →
 *     node:fs/node:path, which cannot live in the esbuild workflow bundle.
 *   - `'use step'` functions run on the host runtime, where dynamic imports
 *     and Node modules work normally. The step variant of `getWritable()`
 *     (from `workflow`) writes agent stream events to the workflow run server
 *     stream, readable via the API SSE endpoint exactly as before.
 *
 * runtimeContext carries only serializable identifiers (projectId / runId /
 * round); the bash toolkit + HelixDB clients are reconstructed inside
 * createPrometheusAgent from projectId.
 */
export async function prometheusWorkflow(
  input: PrometheusWorkflowInput,
): Promise<PrometheusOutput> {
  return await runPrometheusStep(input)
}
