'use workflow'

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { HypothesisPool } from '@open-scientist/schema'
import type { LanguageModel } from 'ai'
import { getWritable } from 'workflow'
import { createLibrarianAgent } from './agent.js'

export interface LibrarianWorkflowInput {
  /** Seed hypothesis text from the user / Sisyphus. */
  seed: string
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /** Pre-resolved language model (Sisyphus resolves via getAgentModel before spawning). */
  model: LanguageModel
}

/**
 * Librarian workflow: RAG retrieval → hypothesis pool generation.
 *
 * Round 1 of Tournament Evolution. Outputs a HypothesisPool (3-6 candidate hypotheses,
 * each with statement + pythonCode) and persists each hypothesis to HelixDB + the local
 * workspace via the agent's tools.
 *
 * The agent.stream() call runs inside a workflow context — `getWritable()` only resolves
 * here. runtimeContext carries only serializable identifiers (projectId / runId / round);
 * no HelixDB clients or DB handles cross the boundary.
 */
export async function librarianWorkflow(input: LibrarianWorkflowInput): Promise<HypothesisPool> {
  const agent = await createLibrarianAgent({
    model: input.model,
    projectId: input.projectId,
  })

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
