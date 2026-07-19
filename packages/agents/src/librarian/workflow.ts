'use workflow'

import type { HypothesisPool } from '@open-scientist/schema'
import { type RunLibrarianStepInput, runLibrarianStep } from './steps/index.ts'

export type { TournamentInput, TournamentResult } from '@open-scientist/schema'

export interface LibrarianWorkflowInput extends RunLibrarianStepInput {}

/**
 * Librarian workflow: RAG retrieval → hypothesis pool generation.
 *
 * Round 1 of Tournament Evolution. Outputs a HypothesisPool (3-6 candidate
 * hypotheses, each with statement + pythonCode) and persists each hypothesis
 * to HelixDB + the local workspace via the agent's tools.
 *
 * The workflow body is a thin VM-safe wrapper — all agent construction +
 * `agent.stream()` happens inside `runLibrarianStep` (a `'use step'` function
 * that executes on the host Node runtime, not the VM sandbox). This is
 * required because:
 *   - The VM (`@workflow/core`) provides no `importModuleDynamically` callback,
 *     so any `await import()` inside the workflow body throws
 *     `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
 *   - `createLibrarianAgent` statically imports tools/skills/config →
 *     node:fs/node:path, which cannot live in the esbuild workflow bundle.
 *   - `'use step'` functions run on the host runtime, where dynamic imports
 *     and Node modules work normally. The step variant of `getWritable()`
 *     (from `workflow`) writes agent stream events to the workflow run server
 *     stream, readable via the API SSE endpoint exactly as before.
 *
 * runtimeContext carries only serializable identifiers (projectId / runId /
 * round); no HelixDB clients or DB handles cross the boundary.
 */
export async function librarianWorkflow(input: LibrarianWorkflowInput): Promise<HypothesisPool> {
  return await runLibrarianStep(input)
}
