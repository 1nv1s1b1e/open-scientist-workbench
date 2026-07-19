// 'use step' retryable steps for the Prometheus workflow.
//
// Status: intentionally not yet split into steps. The Prometheus agent drives its
// own planning + MHD cfg generation loop via its tools (loadSkill → mhdConfig →
// optional bash for derived params), and each tool call inside the agent loop
// already gets per-step retry semantics from WorkflowAgent. The agent's
// isStepCount(20) cap bounds total iterations.
//
// When to extract steps here (Phase 3 后期优化):
//   - generateMhdConfigStep: wrap the `mhdConfig` tool call as a 'use step'
//     function so transient fs failures (disk full, mhd dir not creatable) get
//     automatic durable retry (default 3x) separate from the agent loop. Pattern:
//
//       'use step'
//       export async function generateMhdConfigStep(input: {
//         projectId: string
//         runId: string
//         winningHypoId: string
//         hypothesisStatement: string
//         physicalParams: Record<string, number>
//       }): Promise<MhdConfig> {
//         const { mhdConfigTool } = await import('@open-scientist/tools')
//         return mhdConfigTool.execute(input)
//       }
//
//   - planSearchParamsStep: pure planning (history → next-round Plan), trivially
//     retryable but low value to extract since the LLM produces it.
//
// For now, the agent's self-driven loadSkill → mhdConfig loop is sufficient for
// Phase 3.
export {}
