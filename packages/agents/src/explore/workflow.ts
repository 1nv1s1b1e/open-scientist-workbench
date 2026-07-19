'use workflow'

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { ModelArg } from '@open-scientist/config'
import type { EvalResult } from '@open-scientist/schema'
import { getWritable } from 'workflow'
import type { ExploreAgent, ExploreAgentDeps } from './agent.js'

/** Local typed shape of `./agent.js` — avoids `typeof import()` (which bundles). */
interface AgentModule {
  createExploreAgent: (deps: ExploreAgentDeps) => Promise<ExploreAgent>
}

export interface ExploreWorkflowInput {
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
   * `createExploreAgent` via `createModelFromConfig`. The workflow body only
   * forwards the plain object; it never touches a `LanguageModel` instance.
   */
  modelConfig: ModelArg
}

/**
 * Explore workflow: AlphaEvolve deterministic evaluation of one hypothesis.
 *
 * Spawns a fresh ExploreAgent bound to a per-hypothesis bash workspace, runs the
 * hypothesis' Python filter against the 1.75M snapshot dataset, and returns the
 * EvalResult (F1 + counterexamples). Sisyphus parallelizes this across the hypothesis
 * pool by spawning N explore workflows (each gets its own run ID + retry boundary).
 *
 * The agent.stream() call runs inside a workflow context — `getWritable()` only
 * resolves here. runtimeContext carries only serializable identifiers; the bash
 * workspace is reconstructed inside createExploreAgent from (projectId, hypoId).
 */
export async function exploreWorkflow(input: ExploreWorkflowInput): Promise<EvalResult> {
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
  const agent = await agentModule.createExploreAgent({
    modelConfig: input.modelConfig,
    project: input.projectId,
    hypoId: input.hypoId,
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
