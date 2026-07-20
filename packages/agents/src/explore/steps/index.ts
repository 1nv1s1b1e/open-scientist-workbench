// 'use step' retryable steps for the Explore workflow.
//
// The workflow VM (`@workflow/core`) runs workflow bodies in a `vm.Script`
// context with NO `importModuleDynamically` callback — any `await import()`
// inside a workflow body throws `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
// `'use step'` functions execute on the host Node runtime instead, so dynamic
// imports (and Node module usage) work normally here.
//
// Therefore the agent factory (`createExploreAgent`, which statically imports
// tools/skills/config → node:fs/node:path) MUST be imported dynamically inside
// the step body, never statically at module top-level — otherwise the esbuild
// workflow bundle would drag the whole Node module chain in and the VM would
// reject it. Top-level imports here are restricted to type-only imports (which
// esbuild erases) plus `workflow`'s `getWritable` (the VM-safe step variant
// that writes to the workflow run server stream via `contextStorage`).

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { AgentRuntimeConfig, ModelArg } from '@open-scientist/config'
import type { EvalResult } from '@open-scientist/schema'
import { getWritable } from 'workflow'

/** Input to `runExploreStep` — matches `ExploreWorkflowInput` 1:1. */
export interface RunExploreStepInput {
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
   * `createExploreAgent` via `createModelFromConfig`. The step only forwards
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
 * Run the Explore agent end-to-end inside a `'use step'` boundary.
 *
 * This wraps the entire `createExploreAgent` + `agent.stream` loop so that:
 *   1. The dynamic `import('../agent.ts')` runs on the host Node runtime
 *      (steps execute outside the VM sandbox), avoiding
 *      `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
 *   2. `getWritable<ModelCallStreamPart>()` resolves via `contextStorage`
 *      (the step-context variant of `getWritable`) and streams agent output
 *      events to the workflow run server stream — readable via the API SSE
 *      endpoint exactly as before.
 *   3. The agent's internal `stopWhen: isStepCount(30)` tool loop is
 *      unaffected — retry granularity here is coarser (one step per agent
 *      run), but agent-internal retries are unchanged.
 *
 * Returns the structured `EvalResult` output (serializable across the
 * step → workflow boundary).
 */
export async function runExploreStep(input: RunExploreStepInput): Promise<EvalResult> {
  'use step'
  const { createExploreAgent } = await import('../agent.ts')
  const agent = await createExploreAgent({
    modelConfig: input.agentConfig?.modelConfig ?? input.modelConfig,
    project: input.projectId,
    hypoId: input.hypoId,
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
    writable: getWritable<ModelCallStreamPart>(),
    runtimeContext: {
      projectId: input.projectId,
      runId: input.runId,
      round: input.round,
      hypoId: input.hypoId,
    },
  })

  return result.output
}
