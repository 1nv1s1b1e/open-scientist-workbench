// 'use step' retryable steps for the Explore workflow.
//
// Status: intentionally not yet split into steps. The Explore agent drives its own
// debug loop via the bash tool (write run.py → python3 run.py → read stdout → modify
// → re-run), and each tool call inside the agent loop already gets per-step retry
// semantics from WorkflowAgent. The agent's isStepCount(30) cap bounds total iterations.
//
// When to extract steps here (Phase 3 后期优化):
//   - runPythonEvalStep: wrap the actual `python3 run.py` execution as a 'use step'
//     function so transient failures (OOM, venv not ready, snapshot load timeout) get
//     automatic durable retry (default 3x) separate from the agent loop. Pattern:
//
//       'use step'
//       export async function runPythonEvalStep(input: {
//         project: string
//         hypoId: string
//         scriptPath: string
//       }): Promise<{ stdout: string; stderr: string; exitCode: number; executionMs: number }> {
//         const { createBashToolForHypothesis } = await import('@open-scientist/tools')
//         const tk = await createBashToolForHypothesis(input.project, input.hypoId)
//         const start = Date.now()
//         const res = await tk.sandbox.executeCommand(`python3 ${input.scriptPath}`)
//         return { ...res, executionMs: Date.now() - start }
//       }
//
//   - computeF1Step: pure function (TP/FP/FN → F1), trivially retryable, low value
//     to extract since the agent computes it inline.
//
// For now, the agent's self-driven bash loop is sufficient for Phase 3.
export {}
