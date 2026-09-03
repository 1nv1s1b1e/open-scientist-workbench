import type { LocalCoronalAnalysis } from './local-processing.ts'

/**
 * Single source of truth for the local deterministic executor contracts.
 *
 * Historically the executor identity was maintained in three independent
 * places that had to be kept in sync by hand (the P1-7 audit finding):
 *
 * 1. `MODEL_DIAGNOSTIC_EXECUTORS` — planner diagnostic ID → executor ID;
 * 2. `localValidationExecutor` — task objective → claiming executor regexes,
 *    once for requested executors and once for keyword inference;
 * 3. `diagnosticQuantitativeResults` — executor ID → metric prefix switch.
 *
 * Every binding now lives in {@link EXECUTOR_CONTRACTS} exactly once. Adding
 * a new local executor means adding one entry here; the diagnostic mapping,
 * task claiming, metric attribution and mechanism classification all follow
 * automatically. The regex fields are intentionally kept verbatim so the
 * claiming behavior stays byte-for-byte equivalent to the pre-refactor
 * implementation (guarded by the local-grounded pipeline tests).
 */

/** Mechanism bucket recorded on evidence produced by a local executor. */
export type LocalExecutorMechanismKey = keyof LocalCoronalAnalysis['diagnostics']

export interface LocalExecutorContract {
  /** Pre-registered diagnostic identifier the model planner (D.plan) emits. */
  readonly diagnosticId: string
  /** Deterministic executor that claims this diagnostic. */
  readonly executorId: string
  /**
   * Metric prefix used to attribute `quantitativeResults` rows to this
   * executor. `null` keeps every parsed result (the cross-event holdout
   * aggregates across observable families); an empty string filters all
   * rows out (the WCS audit produces measurement-quality metrics only).
   */
  readonly metricPrefix: string | null
  /**
   * Mechanism bucket stamped onto evidence rows created by this executor.
   * `null` derives the bucket from the hypothesis itself (holdout) or is
   * bypassed entirely by quality-precondition executors (WCS audit).
   */
  readonly mechanismKey: LocalExecutorMechanismKey | null
  /** Pattern a task objective must match when this executor was requested. */
  readonly requestedPattern: RegExp
  /**
   * Hard exclusion applied after `requestedPattern`. The cross-channel lag
   * executor must never claim objectives that ask for hot-channel (94/131)
   * variability work even though they also mention 171/193 lags.
   */
  readonly requestedExcludePattern?: RegExp
  /**
   * Pattern used by the no-executor inference chain; defaults to
   * `requestedPattern`. Kept separate where the two paths historically
   * differed (DEM inference lacks the "正则化 DEM" alternative).
   */
  readonly inferencePattern?: RegExp
  /** Whether the no-executor inference chain may select this executor. */
  readonly inferable?: boolean
  /**
   * The IRIS spectroscopy executor validates its own objective before the
   * compound rejection runs, so a requested spectroscopy task is not
   * rejected merely because its compound wording mentions an unimplemented
   * companion step. Inference (no requested executor) never bypasses the
   * rejection.
   */
  readonly bypassesCompoundRejection?: boolean
  /**
   * Measurement-quality precondition executors (WCS unified ROI) only
   * establish coordinate consistency; they schedule for every run and their
   * evidence is forced to `diagnostic_boundary`.
   */
  readonly qualityPreconditionOnly?: boolean
}

/**
 * Reject compound tasks as soon as they require any unimplemented step.
 * The current processor does not perform manual loop masks, spectroscopy
 * (outside the registered IRIS relative-Doppler product), spatially resolved
 * DEM, multiscale decomposition, spectroscopic energy flux, coronal field
 * extrapolation or simulations. A supported substring must never make the
 * whole compound task look executable.
 */
export const COMPOUND_TASK_REJECTION_PATTERN =
  /(?:人工.*(?:掩膜|日冕环)|光谱|Doppler|非热展宽|逐像素.*DEM|空间分辨.*DEM|小波|wavelet|EMD|多尺度|多周期|高频.*功率谱|功率谱.*斜率|真实.*能流|能流.*闭合|能量闭合|MHD|前向模型|NLFFF|无力场|自由能|阿尔芬.*时标|声学.*时标|密度诊断)/i

/**
 * Ordered registry. Array order is the historical keyword-inference order
 * and must not change: the first matching pattern claims the objective when
 * a task arrives without a requested executor.
 */
export const EXECUTOR_CONTRACTS = [
  {
    diagnosticId: 'aia-cooling-sequence-v2',
    executorId: 'coronal-cooling-sequence-v2',
    metricPrefix: 'aia_cooling_',
    mechanismKey: 'cooling_sequence',
    requestedPattern:
      /(?:94|131).*(?:335).*(?:211).*(?:193).*(?:171)|(?:冷却|热演化).*(?:时延|序列)/i,
    inferable: true,
  },
  {
    diagnosticId: 'aia-dem-inversion-v1',
    executorId: 'coronal-dem-inversion-v1',
    metricPrefix: 'aia_dem_',
    mechanismKey: 'dem_temperature',
    requestedPattern:
      /(?:六通道|94.*131.*171.*193.*211.*335|DEM).*(?:DEM|反演|温度|热结构)|(?:正则化.*DEM)/i,
    inferencePattern: /(?:六通道|94.*131.*171.*193.*211.*335|DEM).*(?:DEM|反演|温度|热结构)/i,
    inferable: true,
  },
  {
    diagnosticId: 'aia-wcs-unified-roi-v2',
    executorId: 'coronal-wcs-unified-roi-v2',
    metricPrefix: '',
    mechanismKey: null,
    requestedPattern: /(?:WCS|重投影|统一.*ROI|配准)/i,
    inferable: true,
    qualityPreconditionOnly: true,
  },
  {
    diagnosticId: 'aia-event-threshold-sensitivity-v2',
    executorId: 'coronal-event-threshold-sensitivity-v2',
    metricPrefix: 'aia_94_131_',
    mechanismKey: 'reconnection',
    requestedPattern: /(?:阈值|prominence).*(?:敏感|稳定)|(?:事件检测).*(?:敏感|阈值)/i,
    inferable: true,
  },
  {
    diagnosticId: 'hmi-magnetic-metadata-audit-v2',
    executorId: 'coronal-hmi-magnetic-audit-v2',
    metricPrefix: 'hmi_projected_',
    mechanismKey: 'magnetic_evolution',
    requestedPattern: /(?:HMI|磁通|磁梯度|PIL).*(?:审计|可用|代理|元数据|投影|视向)/i,
    inferable: true,
  },
  {
    diagnosticId: 'aia-spatial-wave-v1',
    executorId: 'coronal-spatial-wave-v1',
    metricPrefix: 'aia_spatial_',
    mechanismKey: 'spatial_wave',
    requestedPattern: /(?:空间相干|节点|反节点|时距|time.?distance|表观传播|传播速度)/i,
    inferable: true,
  },
  {
    diagnosticId: 'aia-event-fluence-distribution-v1',
    executorId: 'coronal-event-fluence-distribution-v1',
    metricPrefix: 'aia_hot_event_',
    mechanismKey: 'event_fluence_distribution',
    requestedPattern: /(?:事件目录|事件能量|能量分布|fluence|幂律|发生率|事件频率)/i,
    inferable: true,
  },
  {
    diagnosticId: 'hmi-sharp-vector-v1',
    executorId: 'coronal-hmi-sharp-vector-v1',
    metricPrefix: 'hmi_sharp_',
    mechanismKey: 'vector_magnetic_evolution',
    requestedPattern: /(?:SHARP|矢量磁场|径向磁通|水平场|垂直电流|电流螺度|消歧)/i,
    inferable: true,
  },
  {
    diagnosticId: 'aia-hmi-temporal-association-v1',
    executorId: 'coronal-aia-hmi-temporal-association-v1',
    metricPrefix: 'hmi_sharp_hot_event_',
    mechanismKey: 'magnetic_thermal_association',
    requestedPattern:
      /(?:磁场|磁通|电流).*(?:热峰|热增亮|热通道|94|131).*(?:时序|关联|相关|起始|滞后)|(?:热峰|热增亮|热通道|94|131).*(?:磁场|磁通|电流).*(?:时序|关联|相关|起始|滞后)/i,
    inferable: true,
  },
  {
    diagnosticId: 'iris-relative-doppler-v1',
    executorId: 'coronal-iris-spectroscopy-v1',
    metricPrefix: 'iris_',
    mechanismKey: 'spectroscopy',
    requestedPattern: /(?:IRIS|Si\s*IV|Doppler|多普勒|光谱|红移|下流|流速)/i,
    inferable: true,
    bypassesCompoundRejection: true,
  },
  {
    diagnosticId: 'aia-171-193-timeseries-v1',
    executorId: 'coronal-timeseries-lag-v1',
    metricPrefix: 'aia_171_193_',
    mechanismKey: 'wave',
    requestedPattern: /(?:171|193).*(?:时延|相位|互相关)|(?:跨通道).*(?:时延|相关)/i,
    requestedExcludePattern: /(?:94|131|热通道)/i,
    inferable: true,
  },
  {
    diagnosticId: 'aia-target-background-variability-v1',
    executorId: 'coronal-background-variability-v1',
    metricPrefix: 'target_to_background_',
    mechanismKey: 'reconnection',
    requestedPattern:
      /(?:目标|活动).*(?:背景|对照).*(?:变异|比)|(?:背景|对照).*(?:热通道|94|131).*(?:变异|比)/i,
    inferable: true,
  },
  {
    diagnosticId: 'aia-94-131-hot-channel-variability-v1',
    executorId: 'coronal-hot-channel-variability-v1',
    metricPrefix: 'aia_94_131_',
    mechanismKey: 'reconnection',
    requestedPattern: /(?:94|131|热通道).*(?:稳健峰|峰值|相对变异|间歇性)/i,
    inferable: true,
  },
  {
    diagnosticId: 'aia-cross-event-holdout-v1',
    executorId: 'coronal-cross-event-holdout-v1',
    metricPrefix: null,
    mechanismKey: null,
    requestedPattern:
      /(?:独立|跨).*(?:活动区|事件).*(?:留出|冻结|复测)|(?:留出|holdout).*(?:活动区|事件)/i,
    inferable: false,
  },
  {
    diagnosticId: 'external',
    executorId: 'external',
    metricPrefix: '',
    mechanismKey: null,
    // Never consulted: external executor IDs return null before any pattern
    // test. The entry only completes the diagnostic → executor mapping.
    requestedPattern: /(?!)/,
    inferable: false,
  },
] as const satisfies readonly LocalExecutorContract[]

export type ExecutorContractEntry = (typeof EXECUTOR_CONTRACTS)[number]

const CONTRACT_BY_EXECUTOR_ID = new Map<string, LocalExecutorContract>(
  EXECUTOR_CONTRACTS.map((contract) => [contract.executorId, contract]),
)

const CONTRACT_BY_DIAGNOSTIC_ID = new Map<string, LocalExecutorContract>(
  EXECUTOR_CONTRACTS.map((contract) => [contract.diagnosticId, contract]),
)

export function executorContractByExecutorId(
  executorId: string | null | undefined,
): LocalExecutorContract | undefined {
  if (!executorId) return undefined
  return CONTRACT_BY_EXECUTOR_ID.get(executorId)
}

export function executorContractByDiagnosticId(
  diagnosticId: string | null | undefined,
): LocalExecutorContract | undefined {
  if (!diagnosticId) return undefined
  return CONTRACT_BY_DIAGNOSTIC_ID.get(diagnosticId)
}

/** Registry entries the no-executor inference chain may select, in order. */
export function inferableExecutorContracts(): readonly LocalExecutorContract[] {
  return EXECUTOR_CONTRACTS.filter((contract) => contract.inferable)
}

/**
 * Stable system identifiers (hypothesis, prediction, task, evidence, …) embed
 * hex digests, and those digests can accidentally contain domain keywords
 * such as "94", "131", "335" or "171". Regression: the prediction id
 * `h-local-wave-kinematics-6013bc0131:prediction:2` contains "131", so the
 * hot-channel exclusion of `coronal-timeseries-lag-v1` rejected a pure
 * 171/193 task and the task stayed `planned` forever (2026-09-01 demo run,
 * task-local-fc98eb001bbe). Executor claiming must therefore run on the
 * natural-language objective only, never on embedded identifier tokens.
 */
export const STABLE_ID_TOKEN_PATTERN =
  /\b(?:h|task|e|correction|processing|snapshot|artifact|run|obs)-[a-z0-9-]*[0-9a-f]{8,}[a-z0-9-]*(?::(?:prediction|falsification):\d+)*/gi

/**
 * Remove stable identifier tokens (and their `:prediction:N` /
 * `:falsification:N` suffixes) from a task objective so keyword-based
 * claiming, exclusion and compound-rejection patterns only ever see
 * natural-language text.
 */
export function stripStableIdTokens(text: string): string {
  return text.replace(STABLE_ID_TOKEN_PATTERN, ' ')
}
