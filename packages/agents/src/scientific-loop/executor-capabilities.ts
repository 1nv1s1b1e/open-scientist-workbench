import { scientificPredictionId, type ScientificHypothesis } from '@open-scientist/schema'

/**
 * Deterministic capability families for local diagnostic executors.
 *
 * A binding between a hypothesis prediction and a local executor is only
 * legitimate when the executor can actually measure every capability the
 * prediction decisively requires. This replaces pure keyword coincidence:
 * a statement mentioning "94/131 Å 峰值先于 171/193 Å，冷却时滞 5–15 分钟"
 * requires a lag measurement (`cooling_sequence`) and must never be claimed
 * by an executor that only produces hot-channel variability statistics.
 */
export type DiagnosticCapabilityFamily =
  | 'wcs_registration'
  | 'timeseries_lag'
  | 'hot_channel_variability'
  | 'background_contrast'
  | 'dem_thermal_structure'
  | 'cooling_sequence'
  | 'event_threshold_stability'
  | 'magnetic_evolution'
  | 'spatial_wave_propagation'
  | 'event_energy_distribution'
  | 'vector_magnetic_proxies'
  | 'magnetic_thermal_association'
  | 'iris_spectroscopy'
  | 'cross_event_holdout'

/**
 * Executors whose task evidence is always forced to `unknown` /
 * `diagnostic_boundary` (measurement-quality preconditions). They must stay
 * scheduled for every run, so the capability contract never rejects their
 * bindings.
 */
const CAPABILITY_EXEMPT_EXECUTORS: ReadonlySet<string> = new Set([
  'coronal-wcs-unified-roi-v2',
])

/** Capability families each registered local executor can actually measure. */
export const EXECUTOR_CAPABILITIES: Readonly<Record<string, readonly DiagnosticCapabilityFamily[]>> =
  {
    'coronal-wcs-unified-roi-v2': ['wcs_registration'],
    'coronal-timeseries-lag-v1': ['timeseries_lag'],
    'coronal-hot-channel-variability-v1': ['hot_channel_variability'],
    'coronal-background-variability-v1': ['background_contrast', 'hot_channel_variability'],
    'coronal-dem-inversion-v1': ['dem_thermal_structure'],
    'coronal-cooling-sequence-v2': ['cooling_sequence'],
    'coronal-event-threshold-sensitivity-v2': [
      'hot_channel_variability',
      'event_threshold_stability',
    ],
    'coronal-hmi-magnetic-audit-v2': ['magnetic_evolution'],
    'coronal-spatial-wave-v1': ['spatial_wave_propagation'],
    'coronal-event-fluence-distribution-v1': [
      'event_energy_distribution',
      'hot_channel_variability',
    ],
    'coronal-hmi-sharp-vector-v1': ['vector_magnetic_proxies'],
    'coronal-aia-hmi-temporal-association-v1': ['magnetic_thermal_association'],
    'coronal-iris-spectroscopy-v1': ['iris_spectroscopy'],
    'coronal-cross-event-holdout-v1': [
      'cross_event_holdout',
      'timeseries_lag',
      'hot_channel_variability',
    ],
  }

/**
 * Decisive requirements: when one of these matches, the prediction cannot be
 * supported without the corresponding measurement, even if weaker signals are
 * also present in the text.
 */
const DECISIVE_CAPABILITY_RULES: ReadonlyArray<{
  pattern: RegExp
  family: DiagnosticCapabilityFamily
}> = [
  {
    // Ordered hot→cool lag claims: the exact false-coverage class from the
    // 2026-08-21 audit (peak counts were bound to a lag prediction).
    pattern: /(?:冷却时延|冷却时滞|冷却序列|有序冷却|有序时间|热到冷|先于|滞后于|时滞|时间延迟)/i,
    family: 'cooling_sequence',
  },
  {
    pattern: /(?:传播速度|表观传播|相位差|空间相干|时距|time.?distance|驻波|节点|反节点|沿环传播|波列)/i,
    family: 'spatial_wave_propagation',
  },
  {
    pattern: /(?:Doppler|多普勒|非热展宽|谱线|Si\s*IV|IRIS|红移|流速)/i,
    family: 'iris_spectroscopy',
  },
  {
    pattern: /(?:DEM|发射量|温度响应|热结构|多温|高温成分)/i,
    family: 'dem_thermal_structure',
  },
  {
    pattern: /(?:fluence|幂律|能量分布|事件率|发生率|等待时间)/i,
    family: 'event_energy_distribution',
  },
  {
    pattern:
      /(?:磁通|磁场|磁结构|极性反转|PIL)[^。]{0,24}(?:热|增亮|峰|事件)|(?:热|增亮|峰|事件)[^。]{0,24}(?:磁通|磁场|磁结构|极性反转|PIL)/i,
    family: 'magnetic_thermal_association',
  },
  {
    pattern: /(?:独立活动区|跨活动区|留出|holdout)/i,
    family: 'cross_event_holdout',
  },
]

/**
 * Weak signals: only consulted when no decisive rule matched. They keep the
 * historical keyword binding behavior for plain single-diagnostic claims.
 */
const WEAK_CAPABILITY_RULES: ReadonlyArray<{
  pattern: RegExp
  family: DiagnosticCapabilityFamily
}> = [
  {
    pattern: /(?:周期|准周期|振荡|互相关|跨通道相关)/i,
    family: 'timeseries_lag',
  },
  {
    pattern: /(?:SHARP|矢量磁|垂直电流|电流螺度|水平场)/i,
    family: 'vector_magnetic_proxies',
  },
  {
    pattern: /(?:磁通演化|磁梯度|磁通量|视向磁场|HMI)/i,
    family: 'magnetic_evolution',
  },
  {
    pattern: /(?:94|131|热通道)[^。]{0,20}(?:间歇|峰|变异|增亮)|(?:间歇|峰|变异|增亮)[^。]{0,20}(?:94|131|热通道)/i,
    family: 'hot_channel_variability',
  },
  {
    pattern: /(?:背景|对照)/i,
    family: 'background_contrast',
  },
]

/** Families a prediction requires. Empty = no local constraint. */
export function predictionRequiredFamilies(statement: string): readonly DiagnosticCapabilityFamily[] {
  const required = new Set<DiagnosticCapabilityFamily>()
  for (const rule of DECISIVE_CAPABILITY_RULES) {
    if (rule.pattern.test(statement)) required.add(rule.family)
  }
  if (required.size === 0) {
    for (const rule of WEAK_CAPABILITY_RULES) {
      if (rule.pattern.test(statement)) required.add(rule.family)
    }
  }
  return [...required]
}

export function executorCapabilityFamilies(
  executorId: string | null | undefined,
): readonly DiagnosticCapabilityFamily[] {
  if (!executorId) return []
  return EXECUTOR_CAPABILITIES[executorId] ?? []
}

/**
 * Whether the executor may claim a prediction. A compound prediction (e.g.
 * "冷却时延和 DEM 热响应应跨事件复现") legitimately distributes across the
 * executor batch, so binding requires covering at least one required family.
 * Executors covering none of them — the 2026-08-21 false-coverage class
 * (peak counts bound to a lag prediction) — are rejected. Unknown executors
 * (external, model-proposed without a local contract), unconstrained
 * statements and exempt quality-precondition executors stay permissive.
 */
export function executorSupportsPrediction(
  executorId: string | null | undefined,
  statement: string,
): boolean {
  if (!executorId) return true
  if (CAPABILITY_EXEMPT_EXECUTORS.has(executorId)) return true
  const families = EXECUTOR_CAPABILITIES[executorId]
  if (!families) return true
  const required = predictionRequiredFamilies(statement)
  if (required.length === 0) return true
  return required.some((family) => families.includes(family))
}

function predictionIndexFromId(hypothesisId: string, predictionId: string): number | null {
  const prefix = `${hypothesisId}:prediction:`
  if (!predictionId.startsWith(prefix)) return null
  const suffix = predictionId.slice(prefix.length)
  const index = Number.parseInt(suffix, 10)
  return Number.isInteger(index) && index >= 1 ? index : null
}

export function predictionStatementForId(
  hypothesis: ScientificHypothesis,
  predictionId: string,
): string | null {
  const index = predictionIndexFromId(hypothesis.id, predictionId)
  if (index === null) return null
  return hypothesis.predictions[index - 1] ?? null
}

/** Keep only prediction IDs the executor is capable of claiming. */
export function filterPredictionIdsByCapability(
  executorId: string | null | undefined,
  hypothesis: ScientificHypothesis,
  predictionIds: readonly string[],
): string[] {
  return predictionIds.filter((id) => {
    if (predictionStatementForId(hypothesis, id) === null) return false
    return executorSupportsPrediction(executorId, predictionStatementForId(hypothesis, id) ?? '')
  })
}

/** First capability-supported prediction ID for hypothesis-driven evidence. */
export function firstSupportedPredictionId(
  executorId: string | null | undefined,
  hypothesis: ScientificHypothesis,
): string {
  const id = hypothesis.predictions
    .map((_statement, index) => scientificPredictionId(hypothesis.id, index))
    .find((id) => executorSupportsPrediction(executorId, predictionStatementForId(hypothesis, id) ?? ''))
  return id ?? ''
}
