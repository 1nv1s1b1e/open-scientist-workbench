// 'use step' retryable steps for the Oracle workflow.
//
// Status: intentionally not yet split into steps. The Oracle agent drives its own
// critique/mutation loop via its tools (getCritiquesByHypothesis / addCritique /
// addMutationLink / bash / loadSkill), and each tool call inside the agent loop
// already gets per-step retry semantics from WorkflowAgent. The agent's
// isStepCount(25) cap bounds total iterations.
//
// When to extract steps here (Phase 3 后期优化):
//   - persistCritiquesStep: batch-write the OracleOutput.critiques[] → HelixDB +
//     local data/projects/<projectId>/hypotheses/<hypoId>/critique-<round>.json,
//     as a single atomic, externally-retriable persistence boundary separate from
//     the agent loop. Useful when we want to survive agent-loop crashes with the
//     structured output already in hand. Pattern:
//
//       'use step'
//       export async function persistCritiquesStep(input: {
//         projectId: string
//         runId: string
//         round: number
//         critiques: Critique[]
//       }): Promise<{ written: number }> {
//         const helix = await import('@open-scientist/helix')
//         const { getHypothesisDir } = await import('@open-scientist/config')
//         const { mkdir, writeFile } = await import('node:fs/promises')
//         let written = 0
//         for (const c of input.critiques) {
//           await helix.addCritique({
//             hypoId: c.hypoId,
//             content: c.critiqueText,
//             severity: mapSeverity(c.severity),
//             mutationType: c.rationale,
//             createdAt: new Date().toISOString(),
//           })
//           const dir = getHypothesisDir(input.projectId, c.hypoId)
//           await mkdir(dir, { recursive: true })
//           await writeFile(`${dir}/critique-${input.round}.json`, JSON.stringify(c), 'utf-8')
//           written++
//         }
//         return { written }
//       }
//
//   - persistMutationsStep: analogous to persistCritiquesStep, but writes each
//     Mutation.mutatedHypothesis to HelixDB (addHypothesis) + the workspace, and
//     records the MUTATED_FROM edge (addMutationLink). Same atomic-boundary motive.
//
//   - debugCounterexamplesStep: wrap a single bash-driven test of a proposed
//     mutated filter against a curated set of counterexample snapshots, so
//     transient python/venv failures get durable retry separate from the agent.
//
//   - The steps would be invoked from workflow.ts via `await persistCritiquesStep(...)`
//     after `result.output` is available. Step functions get automatic retry
//     (default 3x) + durable persistence from the Workflow DevKit.
//
// For now, the agent itself calls addCritique + addMutationLink + writeFile inside
// its tool loop, which is sufficient for Phase 3.
export {}
