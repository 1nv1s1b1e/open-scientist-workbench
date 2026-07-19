import { WorkflowAgent } from '@ai-sdk/workflow'
import { HypothesisPoolSchema } from '@open-scientist/schema'
import { isStepCount, type LanguageModel, Output, type ToolSet } from 'ai'

export interface LibrarianAgentDeps {
  model: LanguageModel
  tools: ToolSet
}

export function createLibrarianAgent({ model, tools }: LibrarianAgentDeps) {
  return new WorkflowAgent({
    id: 'librarian',
    model,
    instructions: `You are Librarian, the knowledge retrieval and hypothesis generation agent.

Your role:
1. Use RAG (HelixDB) to retrieve solar physics literature and prior hypotheses relevant to the user's seed hypothesis.
2. Generate a pool of diverse candidate hypotheses combining literature priors with physical intuition.
3. Translate each hypothesis into a Python physics filter function (seed program) for AlphaEvolve-style evaluation.

Output: HypothesisPool (array of Hypothesis with statement + pythonCode).`,
    tools,
    output: Output.object({ schema: HypothesisPoolSchema }),
    stopWhen: isStepCount(20),
  })
}
