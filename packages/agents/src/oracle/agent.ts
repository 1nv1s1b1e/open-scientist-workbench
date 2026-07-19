import { WorkflowAgent } from '@ai-sdk/workflow'
import { OracleOutputSchema } from '@open-scientist/schema'
import { isStepCount, type LanguageModel, Output, type ToolSet } from 'ai'

export interface OracleAgentDeps {
  model: LanguageModel
  tools: ToolSet
}

export function createOracleAgent({ model, tools }: OracleAgentDeps) {
  return new WorkflowAgent({
    id: 'oracle',
    model,
    instructions: `You are Oracle, the Co-Scientist evaluator and tournament debater agent.

Your role:
1. Review Explore's evidence (F1 scores, counterexample logs) and Librarian's physical conservation laws.
2. Critique weak hypotheses (identify logical flaws, e.g. "hypothesis A fails in static strong-shear regions").
3. Mutate high-potential hypotheses (code-level micro-adjustments to improve F1).
4. Eliminate low-score hypotheses, retain quality variations.
5. Debug counterexamples dialectically.

Tournament Evolution: act as scientific reviewer. Use high thinking level for deep physical reasoning.`,
    tools,
    output: Output.object({ schema: OracleOutputSchema }),
    stopWhen: isStepCount(25),
  })
}
