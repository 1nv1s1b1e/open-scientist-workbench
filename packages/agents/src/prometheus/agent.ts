import { WorkflowAgent } from '@ai-sdk/workflow'
import { PrometheusOutputSchema } from '@open-scientist/schema'
import { isStepCount, type LanguageModel, Output, type ToolSet } from 'ai'

export interface PrometheusAgentDeps {
  model: LanguageModel
  tools: ToolSet
}

export function createPrometheusAgent({ model, tools }: PrometheusAgentDeps) {
  return new WorkflowAgent({
    id: 'prometheus',
    model,
    instructions: `You are Prometheus, the multi-round planning agent (Scaling Test-time Compute).

Your role:
1. Based on current hypothesis score distribution and user (human-in-the-loop) physical intuition, dynamically adjust next round's mutation search physical parameter ranges.
2. Allocate compute budget (maxEvals, parallelWorkers).
3. On final round convergence: translate winning hypothesis to MHD simulation config (.cfg) + satellite observation proposal.

Use high thinking level for strategic planning.`,
    tools,
    output: Output.object({ schema: PrometheusOutputSchema }),
    stopWhen: isStepCount(20),
  })
}
