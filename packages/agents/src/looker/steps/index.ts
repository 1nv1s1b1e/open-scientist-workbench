// 'use step' retryable steps for the Looker workflow.
//
// The workflow VM (`@workflow/core`) runs workflow bodies in a `vm.Script`
// context with NO `importModuleDynamically` callback — any `await import()`
// inside a workflow body throws `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
// `'use step'` functions execute on the host Node runtime instead, so dynamic
// imports (and Node module usage) work normally here.
//
// Therefore the agent factory (`createLookerAgent`, which statically imports
// tools/skills/config → node:fs/node:path) MUST be imported dynamically inside
// the step body, never statically at module top-level — otherwise the esbuild
// workflow bundle would drag the whole Node module chain in and the VM would
// reject it. Top-level imports here are restricted to type-only imports (which
// esbuild erases) plus `workflow`'s `getWritable` (the VM-safe step variant
// that writes to the workflow run server stream via `contextStorage`).

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { ModelArg } from '@open-scientist/config'
import type { EvidenceAlignment } from '@open-scientist/schema'
import { getWritable } from 'workflow'

/** Input to `runLookerStep` — matches `LookerWorkflowInput` 1:1. */
export interface RunLookerStepInput {
  /** Hypothesis id — drives per-hypothesis workspace isolation + HelixDB scoping. */
  hypoId: string
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /** High-score candidate case from Explore (active region + timestamp + wavelength). */
  candidateCase: {
    activeRegion: string
    timestamp: string
    wavelength: string
  }
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * `createLookerAgent` via `createModelFromConfig`. The step only forwards
   * the plain object; it never touches a `LanguageModel` instance.
   */
  modelConfig: ModelArg
}

/**
 * Run the Looker agent end-to-end inside a `'use step'` boundary.
 *
 * This wraps the entire `createLookerAgent` + `agent.stream` loop so that:
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
 * Returns the structured `EvidenceAlignment` output (serializable across the
 * step → workflow boundary).
 */
export async function runLookerStep(input: RunLookerStepInput): Promise<EvidenceAlignment> {
  'use step'
  const { createLookerAgent } = await import('../agent.ts')
  const agent = await createLookerAgent({
    modelConfig: input.modelConfig,
    project: input.projectId,
    hypoId: input.hypoId,
  })

  const result = await agent.stream({
    messages: [
      {
        role: 'user',
        content: `Align the high-score candidate case for hypothesis ${input.hypoId} to raw FITS images + MP4 video clips.

Run id: ${input.runId}
Hypothesis id: ${input.hypoId}
Project: ${input.projectId}

Candidate case (from Explore):
- Active region: ${input.candidateCase.activeRegion}
- Timestamp: ${input.candidateCase.timestamp}
- Wavelength: ${input.candidateCase.wavelength}

Steps:
1. Call getEvidenceByHypothesis first to check whether alignment evidence already exists for this hypothesis (skip redundant work).
2. Call the fitsAlign tool with (hypoId=${input.hypoId}, activeRegion=${input.candidateCase.activeRegion}, timestamp=${input.candidateCase.timestamp}, wavelength=${input.candidateCase.wavelength}). If it throws the astropy/sunpy install hint, fall back to running alignment directly via bash (write align.py using sunpy Fido to query JSOC/VSO, run python3 align.py, read stdout).
3. Verify the returned FITS paths exist (readFile or ls via bash) and that the MP4 video clip path covers the same (AR, timestamp window, wavelength, spatial bbox) as the FITS images. If no MP4 is available, set videoClipPath to null.
4. Derive a concrete spatialIndex string from the FITS header (e.g. "HPC (-420..-280, -180..-40) arcsec") — not a vague label.
5. Persist the evidence via addEvidence with hypoId=${input.hypoId}, type='support' or 'contradict' based on what the imagery shows vs the hypothesis prediction, content (physical summary), f1Score (carry through), fitsPaths, videoPath, createdAt=now ISO 8601.
6. Return EvidenceAlignment with hypoId=${input.hypoId}, fitsPaths[], videoClipPath (nullable), metadata {activeRegion, timestamp, wavelength, spatialIndex}.`,
      },
    ],
    writable: getWritable<ModelCallStreamPart>(),
    runtimeContext: {
      projectId: input.projectId,
      runId: input.runId,
      hypoId: input.hypoId,
    },
  })

  return result.output
}
