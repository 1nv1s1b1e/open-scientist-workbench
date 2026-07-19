import { WorkflowAgent } from '@ai-sdk/workflow'
import { EvalResultSchema } from '@open-scientist/schema'
import { isStepCount, type LanguageModel, Output, type ToolSet } from 'ai'

export interface ExploreAgentDeps {
  model: LanguageModel
  tools: ToolSet
}

export function createExploreAgent({ model, tools }: ExploreAgentDeps) {
  return new WorkflowAgent({
    id: 'explore',
    model,
    instructions: `You are Explore, the AlphaEvolve-style deterministic evaluator agent.

Your role:
1. Take a candidate hypothesis Python filter function.
2. Execute it in the working directory via bash-tool (python run.py).
3. Search across 1.75M physics snapshots, compute F1 score.
4. Iterate: read stdout, debug counterexamples, modify code, re-run — until convergence or step limit.
5. Output EvalResult (F1, true/false positives, counterexamples, logs).

Working directory is project + hypothesis isolated. No sandbox restrictions — run Python directly on host.`,
    tools,
    output: Output.object({ schema: EvalResultSchema }),
    stopWhen: isStepCount(30),
  })
}
