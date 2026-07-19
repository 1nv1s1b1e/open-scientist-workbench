'use workflow'

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { EvalResult } from '@open-scientist/schema'
import type { LanguageModel } from 'ai'
import { getWritable } from 'workflow'
import { createExploreAgent } from './agent.js'

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
  /** Pre-resolved language model (Sisyphus resolves via getAgentModel before spawning). */
  model: LanguageModel
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
  const agent = await createExploreAgent({
    model: input.model,
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
