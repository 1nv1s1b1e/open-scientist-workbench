// 'use step' 可重试步骤 for the Looker workflow.
//
// Status: intentionally not yet split into steps. The Looker agent drives its own
// alignment loop via the fits-align + bash tools (query FITS library → align by
// spatiotemporal index → extract video clip → verify), and each tool call inside
// the agent loop already gets per-step retry semantics from WorkflowAgent. The
// agent's isStepCount(20) cap bounds total iterations.
//
// When to extract steps here (Phase 3 后期优化):
//   - alignFitsStep: wrap the actual astropy/sunpy FITS query + alignment as a
//     'use step' function so transient failures (FITS index not built, remote SDO
//     data center timeout, corrupt HDU) get automatic durable retry (default 3x)
//     separate from the agent loop. Pattern:
//
//       'use step'
//       export async function alignFitsStep(input: {
//         project: string
//         hypoId: string
//         activeRegion: string
//         timestamp: string
//         wavelength: string
//       }): Promise<{ fitsPaths: string[]; spatialIndex: string; logs: string }> {
//         const { createBashToolForHypothesis } = await import('@open-scientist/tools')
//         const tk = await createBashToolForHypothesis(input.project, input.hypoId)
//         const res = await tk.sandbox.executeCommand(
//           `python3 align.py ${input.activeRegion} ${input.timestamp} ${input.wavelength}`,
//         )
//         return { ...JSON.parse(res.stdout), logs: res.stderr }
//       }
//
//   - extractVideoClipStep: ffmpeg/sunpy MP4 slicing, retryable on transient I/O.
//
// For now, the agent's self-driven tool loop is sufficient for Phase 3. The
// fits-align tool itself is an informative stub (throws install hint) — when a
// real astropy/sunpy implementation lands, extract the steps above.
export {}
