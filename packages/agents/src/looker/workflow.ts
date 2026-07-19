'use workflow'

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { EvidenceAlignment } from '@open-scientist/schema'
import type { LanguageModel } from 'ai'
import { getWritable } from 'workflow'
import { createLookerAgent } from './agent.js'

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
  /** Pre-resolved language model (Sisyphus resolves via getAgentModel before spawning). */
  model: LanguageModel
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
  const agent = await createLookerAgent({
    model: input.model,
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
