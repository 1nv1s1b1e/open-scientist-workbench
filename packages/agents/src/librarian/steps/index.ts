// 'use step' retryable steps for the Librarian workflow.
//
// The workflow VM (`@workflow/core`) runs workflow bodies in a `vm.Script`
// context with NO `importModuleDynamically` callback — any `await import()`
// inside a workflow body throws `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
// `'use step'` functions execute on the host Node runtime instead, so dynamic
// imports (and Node module usage) work normally here.
//
// Therefore the agent factory (`createLibrarianAgent`, which statically imports
// tools/skills/config → node:fs/node:path) MUST be imported dynamically inside
// the step body, never statically at module top-level — otherwise the esbuild
// workflow bundle would drag the whole Node module chain in and the VM would
// reject it. Top-level imports here are restricted to type-only imports (which
// esbuild erases) plus `workflow`'s `getWritable` (the VM-safe step variant
// that writes to the workflow run server stream via `contextStorage`).

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { ModelArg } from '@open-scientist/config'
import { createLogger } from '@open-scientist/logger'
import type { HypothesisPool } from '@open-scientist/schema'
import { getWritable } from 'workflow'

const logger = createLogger('agents')

/** Input to `runLibrarianStep` — matches `LibrarianWorkflowInput` 1:1. */
export interface RunLibrarianStepInput {
  /** Seed hypothesis text from the user / Sisyphus. */
  seed: string
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * `createLibrarianAgent` via `createModelFromConfig`. The step only forwards
   * the plain object; it never touches a `LanguageModel` instance.
   */
  modelConfig: ModelArg
}

/**
 * Run the Librarian agent end-to-end inside a `'use step'` boundary.
 *
 * This wraps the entire `createLibrarianAgent` + `agent.stream` loop so that:
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
 * Returns the structured `HypothesisPool` output (serializable across the
 * step → workflow boundary).
 */
export async function runLibrarianStep(input: RunLibrarianStepInput): Promise<HypothesisPool> {
  'use step'
  logger.info(
    { seed: input.seed, projectId: input.projectId, runId: input.runId },
    'librarian step start',
  )
  const { createLibrarianAgent } = await import('../agent.ts')
  logger.debug('librarian step: agent module imported')
  const agent = await createLibrarianAgent({
    modelConfig: input.modelConfig,
    projectId: input.projectId,
  })
  logger.debug(
    { toolCount: Object.keys(agent.tools ?? {}).length },
    'librarian step: agent created',
  )
  const { ensureIndexes } = await import('@open-scientist/helix')
  await ensureIndexes()
  logger.info('librarian step: starting agent.stream')

  const result = await agent.stream({
    messages: [
      {
        role: 'user',
        content: `Seed hypothesis: ${input.seed}

Generate a diverse pool of 3-6 candidate hypotheses for the coronal heating mystery. For each hypothesis:
1. State the physical mechanism (AC/DC/turbulent/combined), energy transport path, and dissipation location.
2. Give an observable prediction (which SDO/AIA/HMI/IRIS bandpass or magnetic signature should appear).
3. Give a falsifiable condition (a scenario where the prediction fails).
4. Write a pure Python filter(snapshot: dict) -> bool function with physically-derived thresholds.

Load the 'solar-physics-rag' skill first for retrieval guidance and the Python filter template. Use searchPapers and searchHypotheses to ground your hypotheses in prior work and avoid duplication. Persist each hypothesis to HelixDB via addHypothesis (roundId=0, f1Score=0, runId=${input.runId}, createdAt=now ISO 8601) and write its Python filter to the workspace via writeFile.

Return the HypothesisPool with rationale explaining your coverage strategy.`,
      },
    ],
    writable: getWritable<ModelCallStreamPart>(),
    runtimeContext: {
      projectId: input.projectId,
      runId: input.runId,
      round: 1,
    },
  })

  return result.output
}
