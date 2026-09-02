import type {
  EvidenceRecord,
  EvidenceStrengthGrade,
  ValidationTask,
} from '@open-scientist/schema'

export interface SupportGatePolicy {
  /** Stable prediction ids that must each be covered by auditable support. */
  requiredPredictionIds?: readonly string[]
  minSupportRecords?: number
  minIndependentEvents?: number
  minObservableFamilies?: number
  minMethodFamilies?: number
  requireHoldout?: boolean
  requireAllPredictions?: boolean
  contradictionPolicy?: 'veto' | 'report'
}

export interface ResolvedSupportGatePolicy {
  requiredPredictionIds: string[]
  minSupportRecords: number
  minIndependentEvents: number
  minObservableFamilies: number
  minMethodFamilies: number
  requireHoldout: boolean
  requireAllPredictions: boolean
  contradictionPolicy: 'veto' | 'report'
}

/**
 * Pre-registered minimum number of independent active-region event groups for
 * any strong claim. Single source shared by the support gate and the
 * preregistered detectability contract, so a threshold change propagates to
 * both instead of drifting apart.
 */
export const PREREGISTERED_MINIMUM_INDEPENDENT_EVENTS = 3

/** Competition-facing default: a deliberately strong promotion threshold, not a closure rule. */
export const DEFAULT_STRONG_SUPPORT_POLICY: Omit<
  ResolvedSupportGatePolicy,
  'requiredPredictionIds'
> = {
  minSupportRecords: 3,
  minIndependentEvents: PREREGISTERED_MINIMUM_INDEPENDENT_EVENTS,
  minObservableFamilies: 2,
  minMethodFamilies: 2,
  requireHoldout: true,
  requireAllPredictions: true,
  contradictionPolicy: 'veto',
}

export interface SupportGateAssessment {
  supportRecords: EvidenceRecord[]
  validSupportRecords: EvidenceRecord[]
  /**
   * Support-labelled records that are fully auditable (deterministic
   * provenance, lineage, prediction-bound, complete intervals) but only
   * prediction-consistent — they cannot pass the mechanism gate, yet they do
   * lift the ordinal evidence-strength grade to `limited`/`moderate`.
   */
  auditableConsistentRecords: EvidenceRecord[]
  validContradictionRecords: EvidenceRecord[]
  processingRunIds: string[]
  dataSnapshotIds: string[]
  methods: string[]
  agents: string[]
  artifactPackages: string[]
  sampleIds: string[]
  eventGroupIds: string[]
  rawDataFingerprints: string[]
  observableFamilies: string[]
  methodFamilies: string[]
  analysisSplits: string[]
  coveredPredictionIds: string[]
  uncoveredPredictionIds: string[]
  hasHoldoutEvidence: boolean
  hasQuantitativeMetrics: boolean
  meetsEvidenceCriteria: boolean
  evidenceStrengthGrade: EvidenceStrengthGrade
  supported: boolean
  policy: ResolvedSupportGatePolicy
  reasons: string[]
}

export interface EliminationGatePolicy {
  /** Stable, pre-registered falsification ids. One decisive condition is fatal by default. */
  requiredFalsificationConditionIds?: readonly string[]
  minContradictionRecords?: number
  minIndependentEvents?: number
  requireHoldout?: boolean
  requireAdequateDetectability?: boolean
  requireAllFalsificationConditions?: boolean
}

export interface ResolvedEliminationGatePolicy {
  requiredFalsificationConditionIds: string[]
  minContradictionRecords: number
  minIndependentEvents: number
  requireHoldout: boolean
  requireAdequateDetectability: boolean
  requireAllFalsificationConditions: boolean
}

export interface EliminationGateAssessment {
  validContradictionRecords: EvidenceRecord[]
  eliminationEvidenceRecords: EvidenceRecord[]
  coveredFalsificationConditionIds: string[]
  decisiveFalsificationConditionIds: string[]
  uncoveredFalsificationConditionIds: string[]
  eventGroupIds: string[]
  rawDataFingerprints: string[]
  analysisSplits: string[]
  adequateTaskIds: string[]
  eliminated: boolean
  policy: ResolvedEliminationGatePolicy
  reasons: string[]
}

export const DEFAULT_STRONG_ELIMINATION_POLICY: Omit<
  ResolvedEliminationGatePolicy,
  'requiredFalsificationConditionIds'
> = {
  minContradictionRecords: 2,
  minIndependentEvents: 2,
  requireHoldout: true,
  requireAdequateDetectability: true,
  requireAllFalsificationConditions: false,
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

export interface IndependenceConsistencyIssue {
  kind: 'fingerprint_reused_across_events' | 'lineage_fingerprint_drift'
  evidenceIds: string[]
  message: string
}

/**
 * Audit the two identifiers used by the support/elimination gates before they
 * are counted as independent. Multiple instruments in one event are allowed;
 * fingerprint drift is flagged only within the same observable/method/split.
 */
export function auditIndependenceConsistency(
  records: readonly EvidenceRecord[],
): IndependenceConsistencyIssue[] {
  const fingerprintRows = new Map<string, EvidenceRecord[]>()
  const lineageRows = new Map<string, EvidenceRecord[]>()
  for (const record of records) {
    const lineage = record.lineage
    if (!lineage) continue
    const fingerprintGroup = fingerprintRows.get(lineage.rawDataFingerprint) ?? []
    fingerprintGroup.push(record)
    fingerprintRows.set(lineage.rawDataFingerprint, fingerprintGroup)
    const lineageKey = [
      lineage.eventGroupId,
      lineage.observableFamily,
      lineage.methodFamily,
      lineage.analysisSplit,
    ].join('|')
    const lineageGroup = lineageRows.get(lineageKey) ?? []
    lineageGroup.push(record)
    lineageRows.set(lineageKey, lineageGroup)
  }
  const issues: IndependenceConsistencyIssue[] = []
  for (const [fingerprint, rows] of fingerprintRows) {
    const eventGroups = unique(rows.map((row) => row.lineage!.eventGroupId))
    if (eventGroups.length <= 1) continue
    issues.push({
      kind: 'fingerprint_reused_across_events',
      evidenceIds: unique(rows.map((row) => row.evidenceId)),
      message: `Raw-data fingerprint ${fingerprint} is assigned to multiple event groups (${eventGroups.join(', ')}).`,
    })
  }
  for (const [lineageKey, rows] of lineageRows) {
    const fingerprints = unique(rows.map((row) => row.lineage!.rawDataFingerprint))
    if (fingerprints.length <= 1) continue
    issues.push({
      kind: 'lineage_fingerprint_drift',
      evidenceIds: unique(rows.map((row) => row.evidenceId)),
      message: `Equivalent event/observable/method lineage ${lineageKey} has conflicting raw-data fingerprints (${fingerprints.join(', ')}).`,
    })
  }
  return issues
}

function canonicalMethod(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
}

function containsFiniteNumber(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || value === null) return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some((item) => containsFiniteNumber(item, seen))
  return Object.values(value).some((item) => containsFiniteNumber(item, seen))
}

function hasCompleteQuantitativeResults(item: EvidenceRecord): boolean {
  return (
    item.quantitativeResults.length > 0 &&
    item.quantitativeResults.every(
      (result) =>
        Number.isFinite(result.estimate) &&
        Number.isFinite(result.lowerBound) &&
        Number.isFinite(result.upperBound) &&
        result.lowerBound <= result.estimate &&
        result.estimate <= result.upperBound,
    )
  )
}

function isAuditableEvidence(item: EvidenceRecord): boolean {
  return Boolean(
    item.provenance?.deterministic &&
    item.provenance.processingRunId &&
    item.provenance.dataSnapshotIds.length > 0 &&
    item.provenance.artifactIds.length > 0 &&
    item.sourceIds.length > 0 &&
    item.sampleIds.length > 0 &&
    item.lineage?.eventGroupId &&
    item.lineage.rawDataFingerprint &&
    item.lineage.methodFamily &&
    (containsFiniteNumber(item.metrics) || hasCompleteQuantitativeResults(item)),
  )
}

function isGateReadySupport(item: EvidenceRecord): boolean {
  return (
    item.evidenceRole === 'mechanism_discriminating' &&
    (!item.adjudication || item.adjudication.status === 'accepted') &&
    isAuditableEvidence(item) &&
    item.predictionIds.length > 0 &&
    hasCompleteQuantitativeResults(item)
  )
}

/**
 * Auditable but explicitly non-discriminating support. These records satisfy
 * every auditability requirement except the `mechanism_discriminating` role:
 * deterministic provenance, event lineage, prediction binding and complete
 * quantitative intervals. They never pass the mechanism gate, but they make
 * the ordinal grade ladder (`limited`/`moderate`) reachable so a run can
 * express "reproducible, prediction-consistent signal without mechanism
 * discrimination" instead of collapsing everything to `insufficient`.
 */
function isAuditableConsistentEvidence(item: EvidenceRecord): boolean {
  return (
    item.evidenceRole !== 'mechanism_discriminating' &&
    (!item.adjudication || item.adjudication.status === 'accepted') &&
    isAuditableEvidence(item) &&
    item.predictionIds.length > 0 &&
    hasCompleteQuantitativeResults(item)
  )
}

function isGateReadyContradiction(item: EvidenceRecord): boolean {
  return (
    (item.contradictionScope === 'mechanism' ||
      item.contradictionScope === 'critical_prediction') &&
    (!item.adjudication || item.adjudication.status === 'accepted') &&
    isAuditableEvidence(item) &&
    (item.predictionIds.length > 0 || item.falsificationConditionIds.length > 0) &&
    hasCompleteQuantitativeResults(item)
  )
}

function taskSupportsAdequateCounterexampleSearch(
  task: ValidationTask,
  falsificationConditionId: string,
  evidenceIds: ReadonlySet<string>,
): boolean {
  if (
    task.status !== 'completed' ||
    !task.falsificationConditionIds.includes(falsificationConditionId) ||
    !task.detectability?.adequate
  ) {
    return false
  }
  return task.resultEvidenceIds.some((evidenceId) => evidenceIds.has(evidenceId))
}

/**
 * Eliminate an active hypothesis only after a pre-registered fatal condition
 * is contradicted by replicated, auditable evidence and an adequately powered
 * counterexample task. Missing data, a failed proxy, or one event is never a
 * rejection. Eliminated nodes remain in the audit lineage.
 */
export function assessEliminationGate(
  records: readonly EvidenceRecord[],
  tasks: readonly ValidationTask[],
  policy: EliminationGatePolicy = {},
): EliminationGateAssessment {
  const resolvedPolicy: ResolvedEliminationGatePolicy = {
    ...DEFAULT_STRONG_ELIMINATION_POLICY,
    ...policy,
    requiredFalsificationConditionIds: unique(
      policy.requiredFalsificationConditionIds ?? [],
    ),
  }
  const validContradictionRecords = records.filter(
    (item) => item.status === 'contradict' && isGateReadyContradiction(item),
  )
  const requiredIds = resolvedPolicy.requiredFalsificationConditionIds
  const coveredFalsificationConditionIds = requiredIds.filter((conditionId) =>
    validContradictionRecords.some((record) =>
      record.falsificationConditionIds.includes(conditionId),
    ),
  )
  const decisiveFalsificationConditionIds: string[] = []
  const decisiveEvidenceIds = new Set<string>()
  const adequateTaskIds = new Set<string>()
  const conditionReasons: string[] = []

  for (const conditionId of coveredFalsificationConditionIds) {
    const conditionRecords = validContradictionRecords.filter((record) =>
      record.falsificationConditionIds.includes(conditionId),
    )
    const eventGroupIds = unique(
      conditionRecords.flatMap((record) =>
        record.lineage?.eventGroupId ? [record.lineage.eventGroupId] : [],
      ),
    )
    const rawFingerprints = unique(
      conditionRecords.flatMap((record) =>
        record.lineage?.rawDataFingerprint ? [record.lineage.rawDataFingerprint] : [],
      ),
    )
    const splits = unique(
      conditionRecords.flatMap((record) =>
        record.lineage?.analysisSplit ? [record.lineage.analysisSplit] : [],
      ),
    )
    const conditionEvidenceIds = new Set(conditionRecords.map((record) => record.evidenceId))
    const adequateTasks = tasks.filter((task) =>
      taskSupportsAdequateCounterexampleSearch(task, conditionId, conditionEvidenceIds),
    )
    const enoughRecords = conditionRecords.length >= resolvedPolicy.minContradictionRecords
    const enoughEvents =
      eventGroupIds.length >= resolvedPolicy.minIndependentEvents &&
      rawFingerprints.length >= resolvedPolicy.minIndependentEvents
    const hasHoldout = !resolvedPolicy.requireHoldout || splits.includes('holdout')
    const hasPower =
      !resolvedPolicy.requireAdequateDetectability || adequateTasks.length > 0
    if (enoughRecords && enoughEvents && hasHoldout && hasPower) {
      decisiveFalsificationConditionIds.push(conditionId)
      for (const record of conditionRecords) decisiveEvidenceIds.add(record.evidenceId)
      for (const task of adequateTasks) adequateTaskIds.add(task.taskId)
      continue
    }
    const gaps = [
      ...(enoughRecords
        ? []
        : [`少于 ${resolvedPolicy.minContradictionRecords} 条可审计反例`]),
      ...(enoughEvents
        ? []
        : [`少于 ${resolvedPolicy.minIndependentEvents} 个独立事件/原始数据谱系`]),
      ...(hasHoldout ? [] : ['缺少留出集反例']),
      ...(hasPower ? [] : ['缺少达到预注册功效和最小可检测效应的已完成任务']),
    ]
    conditionReasons.push(`${conditionId} 尚非决定性证伪：${gaps.join('、')}。`)
  }

  const uncoveredFalsificationConditionIds = requiredIds.filter(
    (conditionId) => !coveredFalsificationConditionIds.includes(conditionId),
  )
  const eliminated =
    requiredIds.length > 0 &&
    (resolvedPolicy.requireAllFalsificationConditions
      ? requiredIds.every((conditionId) =>
          decisiveFalsificationConditionIds.includes(conditionId),
        )
      : decisiveFalsificationConditionIds.length > 0)
  const eliminationEvidenceRecords = validContradictionRecords.filter((record) =>
    decisiveEvidenceIds.has(record.evidenceId),
  )
  const reasons = eliminated
    ? [
        `预注册证伪条件 ${decisiveFalsificationConditionIds.join('、')} 通过独立事件、留出集和检验功效门槛；该假设从活跃候选池淘汰，但保留完整审计记录。`,
      ]
    : [
        ...(validContradictionRecords.length === 0
          ? ['没有可挑战机制或关键预测的可审计反例。']
          : []),
        ...(coveredFalsificationConditionIds.length === 0 &&
        validContradictionRecords.length > 0
          ? ['现有反例未绑定任何预注册证伪条件，不能用于淘汰。']
          : []),
        ...conditionReasons,
      ]
  return {
    validContradictionRecords,
    eliminationEvidenceRecords,
    coveredFalsificationConditionIds,
    decisiveFalsificationConditionIds,
    uncoveredFalsificationConditionIds,
    eventGroupIds: unique(
      eliminationEvidenceRecords.flatMap((record) =>
        record.lineage?.eventGroupId ? [record.lineage.eventGroupId] : [],
      ),
    ),
    rawDataFingerprints: unique(
      eliminationEvidenceRecords.flatMap((record) =>
        record.lineage?.rawDataFingerprint ? [record.lineage.rawDataFingerprint] : [],
      ),
    ),
    analysisSplits: unique(
      eliminationEvidenceRecords.flatMap((record) =>
        record.lineage?.analysisSplit ? [record.lineage.analysisSplit] : [],
      ),
    ),
    adequateTaskIds: [...adequateTaskIds],
    eliminated,
    policy: resolvedPolicy,
    reasons,
  }
}

function artifactPackage(item: EvidenceRecord): string {
  const provenance = item.provenance
  if (!provenance) return ''
  return [
    provenance.processingRunId,
    ...[...provenance.dataSnapshotIds].sort(),
    ...[...provenance.artifactIds].sort(),
  ].join('|')
}

/**
 * Promote a hypothesis only when existing records form an event-independent,
 * prediction-bound and quantitatively auditable evidence set. A new agent,
 * processing id or rerun of the same raw event does not count as independent.
 */
export function assessSupportGate(
  records: readonly EvidenceRecord[],
  policy: SupportGatePolicy = {},
): SupportGateAssessment {
  const resolvedPolicy: ResolvedSupportGatePolicy = {
    ...DEFAULT_STRONG_SUPPORT_POLICY,
    ...policy,
    requiredPredictionIds: unique(policy.requiredPredictionIds ?? []),
  }
  const supportRecords = records.filter((item) => item.status === 'support')
  const validSupportRecords = supportRecords.filter(isGateReadySupport)
  const auditableConsistentRecords = supportRecords.filter((item) =>
    isAuditableConsistentEvidence(item),
  )
  const validContradictionRecords = records.filter(
    (item) => item.status === 'contradict' && isGateReadyContradiction(item),
  )
  const processingRunIds = unique(
    validSupportRecords.map((item) => item.provenance!.processingRunId),
  )
  const dataSnapshotIds = unique(
    validSupportRecords.flatMap((item) => item.provenance!.dataSnapshotIds),
  )
  const methods = unique(validSupportRecords.map((item) => canonicalMethod(item.method)))
  const agents = unique(
    validSupportRecords.map((item) => item.agentId ?? item.provenance!.generatedBy),
  )
  const artifactPackages = unique(validSupportRecords.map(artifactPackage).filter(Boolean))
  const sampleIds = unique(validSupportRecords.flatMap((item) => item.sampleIds))
  const eventGroupIds = unique(validSupportRecords.map((item) => item.lineage!.eventGroupId))
  const rawDataFingerprints = unique(
    validSupportRecords.map((item) => item.lineage!.rawDataFingerprint),
  )
  const observableFamilies = unique(
    validSupportRecords.map((item) => item.lineage!.observableFamily),
  )
  const methodFamilies = unique(
    validSupportRecords.map((item) => canonicalMethod(item.lineage!.methodFamily)),
  )
  const analysisSplits = unique(validSupportRecords.map((item) => item.lineage!.analysisSplit))
  const coveredPredictionIds = unique(validSupportRecords.flatMap((item) => item.predictionIds))
  const requiredPredictionIds = resolvedPolicy.requiredPredictionIds
  const uncoveredPredictionIds = requiredPredictionIds.filter(
    (predictionId) => !coveredPredictionIds.includes(predictionId),
  )
  const hasHoldoutEvidence = analysisSplits.includes('holdout')
  const hasQuantitativeMetrics = validSupportRecords.length > 0
  // Independence aggregates for the auditable-but-nondiscriminating tier.
  // Repeated metrics on one processing run or one event never count twice.
  const consistentEventGroupIds = unique(
    auditableConsistentRecords.map((item) => item.lineage!.eventGroupId),
  )
  const consistentObservableFamilies = unique(
    auditableConsistentRecords.map((item) => item.lineage!.observableFamily),
  )
  const consistentMethodFamilies = unique(
    auditableConsistentRecords.map((item) => canonicalMethod(item.lineage!.methodFamily)),
  )
  const evidenceReasons: string[] = []

  if (validSupportRecords.length < resolvedPolicy.minSupportRecords) {
    evidenceReasons.push(
      `requires at least ${resolvedPolicy.minSupportRecords} mechanism-discriminating support records`,
    )
  }
  if (eventGroupIds.length < resolvedPolicy.minIndependentEvents) {
    evidenceReasons.push(
      `requires at least ${resolvedPolicy.minIndependentEvents} independent event groups`,
    )
  }
  if (rawDataFingerprints.length < resolvedPolicy.minIndependentEvents) {
    evidenceReasons.push(
      `requires at least ${resolvedPolicy.minIndependentEvents} independent raw-data lineages`,
    )
  }
  if (observableFamilies.length < resolvedPolicy.minObservableFamilies) {
    evidenceReasons.push(
      `requires at least ${resolvedPolicy.minObservableFamilies} observable families`,
    )
  }
  if (methodFamilies.length < resolvedPolicy.minMethodFamilies) {
    evidenceReasons.push(`requires at least ${resolvedPolicy.minMethodFamilies} method families`)
  }
  if (resolvedPolicy.requireHoldout && !hasHoldoutEvidence) {
    evidenceReasons.push('requires at least one holdout evidence record')
  }
  if (resolvedPolicy.requireAllPredictions && uncoveredPredictionIds.length > 0) {
    evidenceReasons.push(`uncovered predictions: ${uncoveredPredictionIds.join(', ')}`)
  }

  const meetsEvidenceCriteria = evidenceReasons.length === 0
  const contradictionSatisfied =
    resolvedPolicy.contradictionPolicy === 'report' || validContradictionRecords.length === 0
  const supported = meetsEvidenceCriteria && contradictionSatisfied
  // Ordinal grade ladder. `strong`/`conflicted` require gate-valid records;
  // `moderate`/`limited` are now reachable by fully auditable
  // prediction-consistent records so a run can distinguish "reproducible
  // signal, no mechanism discrimination" from "no usable signal".
  const consistentModerateTier =
    auditableConsistentRecords.length >= 2 &&
    consistentEventGroupIds.length >= 2 &&
    consistentObservableFamilies.length >= 2 &&
    consistentMethodFamilies.length >= 2
  const evidenceStrengthGrade: EvidenceStrengthGrade =
    validContradictionRecords.length > 0
      ? 'conflicted'
      : supported
        ? 'strong'
        : (validSupportRecords.length >= 2 &&
            eventGroupIds.length >= 2 &&
            observableFamilies.length >= 2 &&
            methodFamilies.length >= 2) ||
            consistentModerateTier
          ? 'moderate'
          : validSupportRecords.length > 0 || auditableConsistentRecords.length > 0
            ? 'limited'
            : records.length > 0
              ? 'insufficient'
              : 'not_assessed'
  const reasons = [...evidenceReasons]
  if (validSupportRecords.length !== supportRecords.length) {
    reasons.push(
      `${supportRecords.length - validSupportRecords.length} support-labelled record(s) are only prediction-consistent, revoked, or incomplete and do not count toward mechanism support`,
    )
  }
  if (validContradictionRecords.length > 0) {
    reasons.push('contains auditable contradictory evidence')
  }
  if (
    auditableConsistentRecords.length > 0 &&
    (evidenceStrengthGrade === 'limited' || evidenceStrengthGrade === 'moderate')
  ) {
    reasons.push(
      `${auditableConsistentRecords.length} auditable prediction-consistent record(s) across ${consistentEventGroupIds.length} event group(s) lift the ordinal grade to ${evidenceStrengthGrade}; they do not count toward mechanism support`,
    )
  }
  return {
    supportRecords,
    validSupportRecords,
    auditableConsistentRecords,
    validContradictionRecords,
    processingRunIds,
    dataSnapshotIds,
    methods,
    agents,
    artifactPackages,
    sampleIds,
    eventGroupIds,
    rawDataFingerprints,
    observableFamilies,
    methodFamilies,
    analysisSplits,
    coveredPredictionIds,
    uncoveredPredictionIds,
    hasHoldoutEvidence,
    hasQuantitativeMetrics,
    meetsEvidenceCriteria,
    evidenceStrengthGrade,
    supported,
    policy: resolvedPolicy,
    reasons,
  }
}
