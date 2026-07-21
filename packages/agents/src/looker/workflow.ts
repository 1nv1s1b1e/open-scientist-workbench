import type { AgentRuntimeConfig, ModelArg } from '@open-scientist/config'
import type { EvidenceAlignment } from '@open-scientist/schema'
import { type EmitChunk, streamAgentOutput } from '../shared/stream.ts'
import { createLookerAgent } from './agent.ts'

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
   * `createLookerAgent` via `createModelFromConfig`.
   */
  modelConfig: ModelArg
  /**
   * Per-agent runtime config override (instructions / skillDirectories /
   * mcpServers). When present, its `modelConfig` takes priority over the
   * `modelConfig` field above and its non-model fields override the factory
   * defaults. Undefined → fully default behaviour (backward compat).
   */
  agentConfig?: AgentRuntimeConfig
  /**
   * Optional SSE chunk sink. When provided, each `UIMessageChunk` produced by
   * the agent's `fullStream` is forwarded to this callback.
   */
  emitChunk?: EmitChunk
  /**
   * Optional abort signal threaded into `agent.stream({abortSignal})`.
   */
  abortSignal?: AbortSignal
}

/**
 * Multimodal Looker workflow: cross-modal spatiotemporal alignment of a
 * high-score Explore candidate to raw FITS images + MP4 video clips.
 *
 * When `emitChunk` is supplied, every `UIMessageChunk` produced by the agent's
 * `fullStream` is forwarded to it.
 */
export async function lookerWorkflow(input: LookerWorkflowInput): Promise<EvidenceAlignment> {
  const agent = await createLookerAgent({
    modelConfig: input.agentConfig?.modelConfig ?? input.modelConfig,
    project: input.projectId,
    hypoId: input.hypoId,
    runtimeContext: {
      projectId: input.projectId,
      runId: input.runId,
      hypoId: input.hypoId,
    },
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
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })

  await streamAgentOutput(result.fullStream, agent.tools, input.emitChunk)
  return result.output
}
