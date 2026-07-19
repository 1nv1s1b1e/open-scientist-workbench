'use workflow'

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { ModelArg } from '@open-scientist/config'
import type { EvidenceAlignment } from '@open-scientist/schema'
import { getWritable } from 'workflow'
import type { LookerAgent, LookerAgentDeps } from './agent.js'

/** Local typed shape of `./agent.js` — avoids `typeof import()` (which bundles). */
interface AgentModule {
  createLookerAgent: (deps: LookerAgentDeps) => Promise<LookerAgent>
}

export interface LookerWorkflowInput {
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
   * `createLookerAgent` via `createModelFromConfig`. The workflow body only
   * forwards the plain object; it never touches a `LanguageModel` instance.
   */
  modelConfig: ModelArg
}

/**
 * Looker workflow: cross-modal spatiotemporal alignment for one hypothesis' top
 * candidate case.
 *
 * Round 2 of Tournament Evolution (after Librarian generates hypotheses + Explore
 * scores them). Spawns a fresh LookerAgent bound to a per-hypothesis bash workspace,
 * aligns the candidate case to raw FITS images + MP4 video clips, and returns the
 * EvidenceAlignment (paths + metadata) for human review. The alignment is also
 * persisted to HelixDB via the agent's addEvidence tool.
 *
 * The agent.stream() call runs inside a workflow context — `getWritable()` only
 * resolves here. runtimeContext carries only serializable identifiers (projectId /
 * runId / hypoId); the bash workspace is reconstructed inside createLookerAgent
 * from (projectId, hypoId). No HelixDB clients or DB handles cross the boundary.
 */
export async function lookerWorkflow(input: LookerWorkflowInput): Promise<EvidenceAlignment> {
  // Dynamic import keeps `./agent.js` (and its tools/skills/config import chain
  // that pulls node:fs/node:path) out of the esbuild workflow bundle — only
  // `'use step'` functions may touch Node modules. The workflow VM executes
  // this dynamic import at runtime, resolving the module via the host runtime.
  //
  // The import specifier is stored in a variable so esbuild cannot statically
  // resolve it and therefore leaves it as a runtime import() instead of
  // bundling ./agent.js (and its node:* transitive deps) into the workflow
  // bundle.
  const agentSpecifier = './agent.js'
  const agentModule = (await import(agentSpecifier)) as AgentModule
  const agent = await agentModule.createLookerAgent({
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
