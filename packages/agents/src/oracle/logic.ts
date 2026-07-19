// Pure prompt-construction logic for the Oracle workflow, extracted from
// workflow.ts so it can be unit-tested without spinning up the Workflow DevKit
// runtime. These functions are deterministic and side-effect free — they
// operate on plain Hypothesis / EvalResult data structures.

import type { EvalResult, Hypothesis } from '@open-scientist/schema'

/**
 * Build the "Hypotheses + counterexamples" prompt block for the Oracle user
 * message. Each hypothesis is rendered with its id, round, status, F1 (pulled
 * from the matching EvalResult when available, else the hypothesis' own f1),
 * parentId, statement, pythonCode, and Explore counterexamples.
 *
 * Empty hypotheses list → empty string (the workflow substitutes a placeholder
 * in the surrounding message body).
 */
export function buildHypothesesBlock(hypotheses: Hypothesis[], evalResults: EvalResult[]): string {
  return hypotheses
    .map((h) => {
      const evalMatch = evalResults.find((e) => e.hypoId === h.id)
      const f1 = evalMatch?.f1 ?? h.f1 ?? null
      const counterexamples = evalMatch?.counterexamples ?? []
      const counterexamplesBlock =
        counterexamples.length === 0
          ? '  (no counterexamples reported)'
          : counterexamples
              .map(
                (c) =>
                  `    - snapshotId=${c.snapshotId} | expected=${c.expected} | actual=${c.actual} | reason=${c.reason}`,
              )
              .join('\n')
      return `Hypothesis ${h.id} (round ${h.round}, status=${h.status}, f1=${f1 ?? 'n/a'}, parentId=${h.parentId ?? 'null'}):
  statement: ${h.statement}
  pythonCode:
\`\`\`python
${h.pythonCode}
\`\`\`
  counterexamples (${counterexamples.length}):
${counterexamplesBlock}`
    })
    .join('\n\n')
}

/**
 * Build the "Eval summary" prompt block: one line per EvalResult with its
 * hypoId, F1, TP/FP/FN counts, and execution time in ms.
 *
 * Empty evalResults → empty string (the workflow substitutes a placeholder).
 */
export function buildEvalSummaryBlock(evalResults: EvalResult[]): string {
  return evalResults
    .map(
      (e) =>
        `  - ${e.hypoId}: F1=${e.f1} TP=${e.truePositives} FP=${e.falsePositives} FN=${e.falseNegatives} (${e.executionMs}ms)`,
    )
    .join('\n')
}
