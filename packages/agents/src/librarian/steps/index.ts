// 'use step' retryable steps for the Librarian workflow.
//
// Status: intentionally not yet split into steps. The current workflow.ts lets the
// WorkflowAgent loop self-execute its tools (searchPapers / searchHypotheses /
// addHypothesis / writeFile / loadSkill) directly — tool calls inside the agent loop
// already get the agent's per-step retry semantics, and HelixDB writes are idempotent
// enough at this stage (addHypothesis just appends a node).
//
// When to extract steps here (Phase 3 后期优化):
//   - persistHypothesesStep: batch-write HypothesisPool → HelixDB + local
//     data/projects/<projectId>/hypotheses/<hypoId>.json. Useful when we want a
//     single atomic, externally-retriable persistence boundary separate from the
//     agent loop (e.g. to survive agent-loop crashes with the structured output
//     already in hand). Pattern:
//
//       'use step'
//       export async function persistHypothesesStep(input: {
//         projectId: string
//         runId: string
//         pool: HypothesisPool
//       }): Promise<{ written: number }> {
//         const helix = await import('@open-scientist/helix')
//         const { getHypothesisDir } = await import('@open-scientist/config')
//         const { mkdir, writeFile } = await import('node:fs/promises')
//         let written = 0
//         for (const h of input.pool.hypotheses) {
//           await helix.addHypothesis({
//             statement: h.statement,
//             roundId: h.round,
//             runId: input.runId,
//             f1Score: h.f1 ?? 0,
//             createdAt: h.createdAt,
//           })
//           const dir = getHypothesisDir(input.projectId, h.id)
//           await mkdir(dir, { recursive: true })
//           await writeFile(`${dir}/filter.py`, h.pythonCode, 'utf-8')
//           written++
//         }
//         return { written }
//       }
//
//   - The step would be invoked from workflow.ts via `await persistHypothesesStep(...)`
//     after `result.output` is available. Step functions get automatic retry (default 3x)
//     + durable persistence from the Workflow DevKit.
//
// For now, the agent itself calls addHypothesis + writeFile inside its tool loop, which
// is sufficient for Phase 3.
export {}
