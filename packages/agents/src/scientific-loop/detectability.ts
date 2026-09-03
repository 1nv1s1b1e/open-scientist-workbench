import type { EvidenceRecord, ValidationDetectability } from '@open-scientist/schema'

const EPSILON = 1e-12

function normalCdf(value: number): number {
  const x = Math.abs(value) / Math.sqrt(2)
  const t = 1 / (1 + 0.3275911 * x)
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return value >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

/** Peter J. Acklam's inverse-normal approximation. */
function inverseNormalCdf(probability: number): number {
  const p = Math.min(1 - EPSILON, Math.max(EPSILON, probability))
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ]
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ]
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const low = 0.02425
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    )
  }
  if (p > 1 - low) return -inverseNormalCdf(1 - p)
  const q = p - 0.5
  const r = q * q
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  )
}

interface EventEstimate {
  estimate: number
  variance: number
}

function resultEstimate(record: EvidenceRecord, metric: string): EventEstimate | null {
  const result = record.quantitativeResults.find((item) => item.metric === metric)
  if (!result) return null
  const z = inverseNormalCdf(0.5 + result.confidenceLevel / 2)
  const standardError = (result.upperBound - result.lowerBound) / (2 * z)
  if (!Number.isFinite(standardError) || standardError <= 0) return null
  return { estimate: result.estimate, variance: standardError * standardError }
}

function randomEffectsStandardError(rows: readonly EventEstimate[]): number | null {
  if (rows.length === 0) return null
  if (rows.length === 1) return Math.sqrt(rows[0]!.variance)
  const weights = rows.map((row) => 1 / row.variance)
  const weightSum = weights.reduce((sum, value) => sum + value, 0)
  const mean = rows.reduce((sum, row, index) => sum + weights[index]! * row.estimate, 0) / weightSum
  const q = rows.reduce((sum, row, index) => sum + weights[index]! * (row.estimate - mean) ** 2, 0)
  const c = weightSum - weights.reduce((sum, value) => sum + value * value, 0) / weightSum
  const tauSquared = c > 0 ? Math.max(0, (q - (rows.length - 1)) / c) : 0
  const randomWeights = rows.map((row) => 1 / (row.variance + tauSquared))
  return Math.sqrt(1 / randomWeights.reduce((sum, value) => sum + value, 0))
}

/**
 * Evaluate registered sensitivity from deterministic confidence intervals.
 * Independent units are event groups; repeated frames never increase power.
 */
export function evaluateDetectability(
  preregistered: ValidationDetectability,
  records: readonly EvidenceRecord[],
): ValidationDetectability {
  const byEvent = new Map<string, EventEstimate>()
  for (const record of records) {
    const eventGroupId = record.lineage?.eventGroupId
    if (!eventGroupId || record.adjudication?.status === 'revoked') continue
    const candidate = resultEstimate(record, preregistered.effectMetric)
    if (!candidate) continue
    const current = byEvent.get(eventGroupId)
    if (!current || candidate.variance < current.variance) byEvent.set(eventGroupId, candidate)
  }
  const independentEventCount = byEvent.size
  const standardError = randomEffectsStandardError([...byEvent.values()])
  if (standardError === null) {
    return {
      ...preregistered,
      achievedPower: undefined,
      minimumDetectableEffect: undefined,
      independentEventCount,
      adequate: false,
      assumptions: [
        ...new Set([
          ...preregistered.assumptions,
          `No finite confidence interval was found for registered metric ${preregistered.effectMetric}.`,
        ]),
      ],
    }
  }
  const zAlpha = inverseNormalCdf(1 - preregistered.alpha / 2)
  const zTargetPower = inverseNormalCdf(preregistered.targetPower)
  const noncentrality = preregistered.minimumMeaningfulEffect / standardError
  const achievedPower = Math.min(
    1,
    Math.max(EPSILON, normalCdf(-zAlpha - noncentrality) + 1 - normalCdf(zAlpha - noncentrality)),
  )
  const minimumDetectableEffect = (zAlpha + zTargetPower) * standardError
  const adequate =
    independentEventCount >= preregistered.minimumIndependentEventCount &&
    achievedPower >= preregistered.targetPower &&
    minimumDetectableEffect <= preregistered.minimumMeaningfulEffect
  return {
    ...preregistered,
    achievedPower,
    minimumDetectableEffect,
    independentEventCount,
    adequate,
    assumptions: [
      ...new Set([
        ...preregistered.assumptions,
        'Power uses event-level random-effects precision reconstructed from reported confidence intervals.',
        'Power targets the pre-registered minimum meaningful effect, not the observed effect size.',
      ]),
    ],
  }
}
