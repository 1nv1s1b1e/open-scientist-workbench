import { createHash } from 'node:crypto'
import {
  EvidenceRecordSchema,
  ScientificCorrectionSchema,
  type EvidenceRecord,
  type ScientificCorrection,
} from '@open-scientist/schema'

export interface EvidencePromotionContext {
  stage: 'B' | 'C'
  round: number
  hypothesisIds: readonly string[]
  agentId?: string
  verifyProvenance?: (evidence: EvidenceRecord) => boolean | Promise<boolean>
}

export interface EvidencePromotionResult {
  evidence?: EvidenceRecord
  corrections: ScientificCorrection[]
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function candidateObject(candidate: unknown): Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null
    ? (candidate as Record<string, unknown>)
    : {}
}

function correction(
  context: EvidencePromotionContext,
  kind: ScientificCorrection['kind'],
  severity: ScientificCorrection['severity'],
  message: string,
  action: string,
  evidenceId?: string,
): ScientificCorrection {
  const affectedIds = evidenceId ? [evidenceId] : []
  return ScientificCorrectionSchema.parse({
    correctionId:
      'correction-' +
      digest({
        stage: context.stage,
        kind,
        severity,
        message,
        action,
        affectedIds,
        round: context.round,
      }).slice(0, 16),
    stage: context.stage,
    kind,
    severity,
    message,
    action,
    affectedIds,
    triggeredBy: [evidenceId ?? context.agentId ?? 'round-' + context.round],
    round: context.round,
    ...(context.agentId ? { agentId: context.agentId } : {}),
  })
}

function evidenceIdOf(candidate: unknown): string | undefined {
  const value = candidateObject(candidate).evidenceId
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function downgrade(
  candidate: Record<string, unknown>,
  context: EvidencePromotionContext,
  message: string,
  kind: ScientificCorrection['kind'],
): EvidencePromotionResult {
  const evidenceId = evidenceIdOf(candidate)
  const limitations = Array.isArray(candidate.limitations)
    ? candidate.limitations.filter((item): item is string => typeof item === 'string')
    : []
  const parsed = EvidenceRecordSchema.safeParse({
    ...candidate,
    status: 'unknown',
    evidenceRole: 'diagnostic_boundary',
    limitations: [...limitations, message],
  })
  if (!parsed.success) {
    return {
      corrections: [
        correction(
          context,
          'schema',
          'error',
          '候选证据无法降级为 unknown：' + parsed.error.message,
          '拒绝该候选证据，保留校正记录。',
          evidenceId,
        ),
      ],
    }
  }
  return {
    evidence: parsed.data,
    corrections: [
      correction(
        context,
        kind,
        'warning',
        message,
        '将候选证据降级为 unknown，等待可验证数据或人工复核。',
        parsed.data.evidenceId,
      ),
    ],
  }
}

export async function promoteEvidence(
  candidate: unknown,
  context: EvidencePromotionContext,
): Promise<EvidencePromotionResult> {
  const object = candidateObject(candidate)
  const rawStatus = object.status
  const parsed = EvidenceRecordSchema.safeParse(candidate)

  if (!parsed.success) {
    if (rawStatus === 'support' || rawStatus === 'contradict') {
      return downgrade(
        object,
        context,
        '原始判断缺少可验证的数据处理溯源，已自动降级为 unknown。',
        'provenance',
      )
    }
    return {
      corrections: [
        correction(
          context,
          'schema',
          'error',
          '候选证据结构校验失败：' + parsed.error.message,
          '拒绝该候选证据，不能将其送入科学事实库。',
          evidenceIdOf(candidate),
        ),
      ],
    }
  }

  const evidence = parsed.data
  if (evidence.status === 'unknown') {
    return { evidence, corrections: [] }
  }
  if (!evidence.hypothesisId || !context.hypothesisIds.includes(evidence.hypothesisId)) {
    return downgrade(
      evidence,
      context,
      'Decisive evidence is not bound to a currently registered hypothesis and cannot be promoted.',
      'factual',
    )
  }
  if (evidence.status === 'support' && evidence.sampleIds.length === 0) {
    return downgrade(
      evidence,
      context,
      'Supporting evidence has no auditable sample IDs and cannot be promoted beyond unknown.',
      'factual',
    )
  }
  if (evidence.status === 'contradict' && evidence.sampleIds.length === 0) {
    return downgrade(
      evidence,
      context,
      '反驳证据没有绑定可复核的样本 ID，已自动降级为 unknown。',
      'factual',
    )
  }
  if (context.verifyProvenance) {
    const verified = await context.verifyProvenance(evidence)
    if (!verified) {
      return downgrade(
        evidence,
        context,
        '数据处理溯源未通过快照、处理运行或产物校验，已自动降级为 unknown。',
        'provenance',
      )
    }
  }
  return { evidence, corrections: [] }
}
