/**
 * Shared convergence history type used by both the Sisyphus orchestrator
 * (builds the history) and Prometheus (consumes it for planning). Lives here
 * — not in either role package — so neither role depends on the other.
 */

/** One entry of the per-round convergence history Prometheus sees. */
export interface ConvergenceEntry {
  round: number
  bestF1: number
  /** Count of surviving hypotheses that round (post-Oracle pruning). */
  count: number
}
