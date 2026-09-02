import type { CandidateSnapshot, EvalResult } from '@open-scientist/schema'

export interface EvidenceAlignmentJob {
  hypoId: string
  snapshotId: string
  candidateCase: Omit<CandidateSnapshot, 'snapshotId'>
}

/** Convert deterministic evaluator output into bounded, provenance-carrying Looker jobs. */
export function buildEvidenceAlignmentJobs(
  evalResults: readonly EvalResult[],
  maxPerHypothesis = 1,
): EvidenceAlignmentJob[] {
  if (!Number.isInteger(maxPerHypothesis) || maxPerHypothesis < 1) {
    throw new Error(`maxPerHypothesis must be a positive integer: ${maxPerHypothesis}`)
  }

  return evalResults.flatMap((result) =>
    result.candidateSnapshots.slice(0, maxPerHypothesis).map((candidate) => ({
      hypoId: result.hypoId,
      snapshotId: candidate.snapshotId,
      candidateCase: {
        activeRegion: candidate.activeRegion,
        timestamp: candidate.timestamp,
        wavelength: candidate.wavelength,
      },
    })),
  )
}
