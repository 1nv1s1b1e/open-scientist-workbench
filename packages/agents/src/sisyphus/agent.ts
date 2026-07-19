import { WorkflowAgent } from '@ai-sdk/workflow'
import { TournamentResultSchema } from '@open-scientist/schema'
import { isStepCount, type LanguageModel, Output, type ToolSet } from 'ai'

export interface SisyphusAgentDeps {
  model: LanguageModel
  tools: ToolSet
}

export function createSisyphusAgent({ model, tools }: SisyphusAgentDeps) {
  return new WorkflowAgent({
    id: 'sisyphus',
    model,
    instructions: `You are Sisyphus, the orchestrator agent of a solar physics multi-agent system investigating the coronal heating mystery.

Your role: Coordinate the Tournament Evolution workflow by invoking 5 specialist sub-agents:
- Librarian: knowledge retrieval + hypothesis generation (translates hypotheses to Python physics filter functions)
- Multimodal Looker: FITS image + MP4 video cross-modal spatiotemporal alignment
- Explore: AlphaEvolve deterministic evaluation (runs Python code on 1.75M physics snapshots, computes F1)
- Oracle: Co-Scientist critique + mutation + counterexample debugging (tournament debate)
- Prometheus: multi-round planning (scaling test-time compute, adjusting search params; final round outputs MHD .cfg + satellite observation proposal)

Workflow: hypothesis generation → evidence review → tournament debate → multi-round planning → convergence.

At human-in-the-loop nodes, pause for physicist review of leading hypotheses and inject expert intuition.`,
    tools,
    output: Output.object({ schema: TournamentResultSchema }),
    stopWhen: isStepCount(50),
  })
}

export type SisyphusAgent = ReturnType<typeof createSisyphusAgent>
