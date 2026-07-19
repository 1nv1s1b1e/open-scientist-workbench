'use workflow'

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { ModelArg } from '@open-scientist/config'
import type { HypothesisPool } from '@open-scientist/schema'
import { getWritable } from 'workflow'
import type { LibrarianAgent, LibrarianAgentDeps } from './agent.js'

/** Local typed shape of `./agent.js` — avoids `typeof import()` (which bundles). */
interface AgentModule {
  createLibrarianAgent: (deps: LibrarianAgentDeps) => Promise<LibrarianAgent>
}

export interface LibrarianWorkflowInput {
  /** Seed hypothesis text from the user / Sisyphus. */
  seed: string
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * `createLibrarianAgent` via `createModelFromConfig`. The workflow body only
   * forwards the plain object; it never touches a `LanguageModel` instance.
   */
  modelConfig: ModelArg
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
  // Dynamic import keeps `./agent.js` (and its tools/skills/config import chain
  // that pulls node:fs/node:path) out of the esbuild workflow bundle — only
  // `'use step'` functions may touch Node modules. The workflow VM executes
  // this dynamic import at runtime, resolving the module via the host runtime.
  //
  // The import specifier is stored in a variable so esbuild cannot statically
  // resolve it and therefore leaves it as a runtime import() instead of
  // bundling ./agent.js (and its node:* transitive deps) into the workflow
  // bundle. The typed shape is re-declared locally as `AgentModule` so no
  // `typeof import('./agent.js')` type query (which would pull the module
  // into the bundle) is needed.
  const agentSpecifier = './agent.js'
  const agentModule = (await import(agentSpecifier)) as AgentModule
  const agent = await agentModule.createLibrarianAgent({
    modelConfig: input.modelConfig,
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
