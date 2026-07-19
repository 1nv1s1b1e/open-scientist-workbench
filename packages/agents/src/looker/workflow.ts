'use workflow'

import type { EvidenceAlignment } from '@open-scientist/schema'
import { type RunLookerStepInput, runLookerStep } from './steps/index.ts'

export interface LookerWorkflowInput extends RunLookerStepInput {}

/**
 * Looker workflow: cross-modal spatiotemporal alignment for one hypothesis'
 * top candidate case.
 *
 * Round 2 of Tournament Evolution (after Librarian generates hypotheses +
 * Explore scores them). Spawns a fresh LookerAgent bound to a per-hypothesis
 * bash workspace, aligns the candidate case to raw FITS images + MP4 video
 * clips, and returns the EvidenceAlignment (paths + metadata) for human review.
 * The alignment is also persisted to HelixDB via the agent's addEvidence tool.
 *
 * The workflow body is a thin VM-safe wrapper — all agent construction +
 * `agent.stream()` happens inside `runLookerStep` (a `'use step'` function
 * that executes on the host Node runtime, not the VM sandbox). This is
 * required because:
 *   - The VM (`@workflow/core`) provides no `importModuleDynamically` callback,
 *     so any `await import()` inside the workflow body throws
 *     `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
 *   - `createLookerAgent` statically imports tools/skills/config →
 *     node:fs/node:path, which cannot live in the esbuild workflow bundle.
 *   - `'use step'` functions run on the host runtime, where dynamic imports
 *     and Node modules work normally. The step variant of `getWritable()`
 *     (from `workflow`) writes agent stream events to the workflow run server
 *     stream, readable via the API SSE endpoint exactly as before.
 *
 * runtimeContext carries only serializable identifiers (projectId / runId /
 * hypoId); the bash workspace is reconstructed inside createLookerAgent from
 * (projectId, hypoId). No HelixDB clients or DB handles cross the boundary.
 */
export async function lookerWorkflow(input: LookerWorkflowInput): Promise<EvidenceAlignment> {
  return await runLookerStep(input)
}
