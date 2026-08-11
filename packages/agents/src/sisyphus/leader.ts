import type { Hypothesis } from '@open-scientist/schema'

export interface LeadingHypothesis {
  hypoId: string | null
  bestF1: number
}

/** Select a leader only from surviving hypotheses with a computed score. */
export function selectLeadingHypothesis(hypotheses: Hypothesis[]): LeadingHypothesis {
  const evaluated = hypotheses.filter(
    (hypothesis): hypothesis is Hypothesis & { f1: number } =>
      hypothesis.status !== 'eliminated' &&
      hypothesis.f1 !== null &&
      Number.isFinite(hypothesis.f1),
  )
  if (evaluated.length === 0) return { hypoId: null, bestF1: 0 }

  const leader = evaluated.reduce((best, candidate) => {
    if (candidate.f1 > best.f1) return candidate
    if (candidate.f1 === best.f1 && candidate.id.localeCompare(best.id) < 0) return candidate
    return best
  })
  return { hypoId: leader.id, bestF1: leader.f1 }
}
