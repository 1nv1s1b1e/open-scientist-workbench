import { createHash } from 'node:crypto'

/**
 * Human-in-the-loop control channel for the scientific loop.
 *
 * Design contract (must hold forever):
 * 1. The loop NEVER waits for a human unless a gate is explicitly armed
 *    (`gateMode: 'plan_review'`). Pause/steer/gate are opt-in interaction
 *    surfaces, not closure requirements.
 * 2. Humans can pause, inject steering text, and approve/reject the
 *    continuation decision — but they can never write evidence, alter a gate
 *    verdict (`assessSupportGate` / `assessEliminationGate`), or change a
 *    hypothesis status. Steering is advisory context for A-stage generation.
 * 3. An armed gate is fail-open: absent human response resolves via timeout
 *    (auto-proceed) or abort, so a run can never be stalled forever by a
 *    missing human.
 */

export interface ScientificSteeringMessage {
  messageId: string
  mode: 'steering' | 'follow-up'
  content: string
  queuedAt: string
  /** Round whose A-stage consumed this message (set on drain). */
  injectedRound?: number
}

export type HumanGateKind = 'plan_review'

export interface HumanGateRequest {
  gateId: string
  kind: HumanGateKind
  round: number
  summary: string
}

export interface HumanGateDecision {
  gateId: string
  kind: HumanGateKind
  round: number
  approved: boolean
  source: 'human' | 'auto_timeout' | 'auto_aborted'
  reason?: string
  decidedAt: string
}

/** The workflow-facing subset the scientific graph is allowed to call. */
export interface ScientificHumanChannel {
  /** True when an approval gate is armed and will actually wait. */
  hasGate(): boolean
  /** True while the run is paused (before any wait). */
  isPaused(): boolean
  /** Resolve once the run is unpaused or the signal aborts. */
  waitWhilePaused(signal?: AbortSignal): Promise<void>
  /** Drain steering messages queued since the last drain, tagging the round. */
  drainSteering(round: number): ScientificSteeringMessage[]
  /** Ask for the continuation approval. Immediate auto-approval when disarmed. */
  requestGate(
    request: { kind: HumanGateKind; round: number; summary: string },
    signal?: AbortSignal,
  ): Promise<HumanGateDecision>
}

/** Full control surface used by the API layer. */
export interface ScientificHumanControl extends ScientificHumanChannel {
  readonly runId: string
  readonly gateMode: 'off' | 'plan_review'
  /** Queue a steering/follow-up message for the next A-stage. */
  steer(content: string, mode: 'steering' | 'follow-up'): ScientificSteeringMessage
  pause(): void
  unpause(): void
  /** The currently pending gate request, if any (for UI polling). */
  pendingGateRequest(): HumanGateRequest | undefined
  /** Approve or reject the pending gate. `undefined` when nothing is pending. */
  approve(input: {
    approved: boolean
    reason?: string
    gateId?: string
  }): HumanGateDecision | undefined
  /** Decisions resolved so far (audit trail mirrored into the run result). */
  gateDecisions(): readonly HumanGateDecision[]
  /** Wake every waiter and auto-resolve pending gates (process shutdown). */
  close(): void
}

export interface ScientificHumanControlOptions {
  runId: string
  gateMode?: 'off' | 'plan_review'
  /** Fail-open timeout for an armed gate. Default 5 minutes. */
  gateTimeoutMs?: number
}

interface PendingGate {
  request: HumanGateRequest
  resolve: (decision: HumanGateDecision) => void
  timer: NodeJS.Timeout | undefined
}

export function createInMemoryScientificHumanControl(
  options: ScientificHumanControlOptions,
): ScientificHumanControl {
  const runId = options.runId
  const gateMode = options.gateMode ?? 'off'
  const gateTimeoutMs = options.gateTimeoutMs ?? 5 * 60_000

  let paused = false
  let closed = false
  const pauseWaiters = new Set<(value: void | PromiseLike<void>) => void>()
  const steeringQueue: ScientificSteeringMessage[] = []
  const injected: ScientificSteeringMessage[] = []
  let pending: PendingGate | undefined
  const decisions: HumanGateDecision[] = []

  const now = () => new Date().toISOString()

  const control: ScientificHumanControl = {
    runId,
    gateMode,
    hasGate: () => gateMode === 'plan_review' && !closed,
    isPaused: () => paused,
    steer(content, mode) {
      const message: ScientificSteeringMessage = {
        messageId: `steer-${createHash('sha256')
          .update(
            JSON.stringify({ runId, content, mode, at: Date.now(), queue: steeringQueue.length }),
          )
          .digest('hex')
          .slice(0, 16)}`,
        mode,
        content,
        queuedAt: now(),
      }
      steeringQueue.push(message)
      return message
    },
    pause() {
      if (closed) return
      paused = true
    },
    unpause() {
      paused = false
      for (const resolve of [...pauseWaiters]) resolve()
      pauseWaiters.clear()
    },
    pendingGateRequest() {
      return pending ? { ...pending.request } : undefined
    },
    approve({ approved, reason, gateId }) {
      const current = pending
      if (!current) return undefined
      if (gateId && gateId !== current.request.gateId) return undefined
      if (current.timer) clearTimeout(current.timer)
      pending = undefined
      const decision: HumanGateDecision = {
        gateId: current.request.gateId,
        kind: current.request.kind,
        round: current.request.round,
        approved,
        source: 'human',
        ...(reason !== undefined ? { reason } : {}),
        decidedAt: now(),
      }
      decisions.push(decision)
      current.resolve(decision)
      return decision
    },
    gateDecisions: () => [...decisions],
    close() {
      closed = true
      paused = false
      for (const resolve of [...pauseWaiters]) resolve()
      pauseWaiters.clear()
      const current = pending
      if (current) {
        if (current.timer) clearTimeout(current.timer)
        pending = undefined
        const decision: HumanGateDecision = {
          gateId: current.request.gateId,
          kind: current.request.kind,
          round: current.request.round,
          approved: true,
          source: 'auto_aborted',
          decidedAt: now(),
        }
        decisions.push(decision)
        current.resolve(decision)
      }
    },
    async waitWhilePaused(signal) {
      while (paused && !closed && !signal?.aborted) {
        await new Promise<void>((resolve) => {
          pauseWaiters.add(resolve)
          if (signal) {
            const onAbort = () => {
              pauseWaiters.delete(resolve)
              resolve()
            }
            if (signal.aborted) {
              onAbort()
              return
            }
            signal.addEventListener('abort', onAbort, { once: true })
          }
        })
      }
    },
    drainSteering(round) {
      if (steeringQueue.length === 0) return []
      const drained = steeringQueue.splice(0).map((message) => ({
        ...message,
        injectedRound: round,
      }))
      injected.push(...drained)
      return drained
    },
    async requestGate(request, signal) {
      if (gateMode !== 'plan_review' || closed) {
        // Disarmed gates never happened from the workflow's perspective; the
        // graph only calls this when `hasGate()` is true, so this branch is a
        // defensive fail-open. Not recorded in the audit trail.
        const decision: HumanGateDecision = {
          gateId: `gate-${createHash('sha256')
            .update(JSON.stringify({ runId, ...request }))
            .digest('hex')
            .slice(0, 16)}`,
          kind: request.kind,
          round: request.round,
          approved: true,
          source: 'auto_timeout',
          decidedAt: now(),
        }
        return decision
      }
      const gateId = `gate-${createHash('sha256')
        .update(JSON.stringify({ runId, ...request }))
        .digest('hex')
        .slice(0, 16)}`
      return new Promise<HumanGateDecision>((resolve) => {
        let timer: NodeJS.Timeout | undefined
        let onAbort: (() => void) | undefined
        const settle = (decision: HumanGateDecision) => {
          if (timer) clearTimeout(timer)
          if (signal && onAbort) signal.removeEventListener('abort', onAbort)
          pending = undefined
          decisions.push(decision)
          resolve(decision)
        }
        timer = setTimeout(() => {
          if (pending?.request.gateId !== gateId) return
          settle({
            gateId,
            kind: request.kind,
            round: request.round,
            approved: true,
            source: 'auto_timeout',
            decidedAt: now(),
          })
        }, gateTimeoutMs)
        if (signal) {
          onAbort = () => {
            if (pending?.request.gateId !== gateId) return
            settle({
              gateId,
              kind: request.kind,
              round: request.round,
              approved: true,
              source: 'auto_aborted',
              decidedAt: now(),
            })
          }
          if (signal.aborted) {
            onAbort()
            return
          }
          signal.addEventListener('abort', onAbort, { once: true })
        }
        pending = {
          request: { ...request, gateId },
          resolve: (decision) => settle(decision),
          timer,
        }
      })
    },
  }

  return control
}

/**
 * Format drained steering messages as an advisory prompt block. The block
 * explicitly states that steering cannot alter gate verdicts — this text is
 * part of the integrity contract, not decoration.
 */
export function steeringPromptBlock(
  messages: readonly ScientificSteeringMessage[] | undefined,
): string {
  if (!messages || messages.length === 0) return ''
  const lines = messages.map(
    (message, index) => `${index + 1}. [${message.mode}] ${message.content}`,
  )
  return [
    '',
    '【人工转向输入（仅供参考与优先级调整，不可改变门禁裁决或证据事实）】',
    ...lines,
    '【结束】候选假设仍必须满足全部结构与来源约束；不满足的转向要求应如实说明而非迁就。',
    '',
  ].join('\n')
}
