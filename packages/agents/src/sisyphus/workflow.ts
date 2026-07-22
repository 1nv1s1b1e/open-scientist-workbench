import type { AgentRuntimeConfig } from '@open-scientist/config'
import type { EvalResult, Hypothesis, TournamentResult } from '@open-scientist/schema'
import { exploreWorkflow } from '../explore/workflow.ts'
import { librarianWorkflow } from '../librarian/workflow.ts'
import { oracleWorkflow } from '../oracle/workflow.ts'
import { prometheusWorkflow } from '../prometheus/workflow.ts'
import type { ConvergenceEntry } from '../shared/convergence.ts'
import type { EmitChunk } from '../shared/stream.ts'
import {
  applyOraclePruning,
  buildConvergenceEntry,
  computeLeader,
  MAX_ROUNDS,
  shouldStopByPrometheus,
  shouldStopByTarget,
  updateHypothesesWithEval,
} from './logic.ts'
import type { RoundSnapshot } from './snapshot.ts'
import { snapshotStep } from './snapshot.ts'

export type { TournamentInput, TournamentResult } from '@open-scientist/schema'
export type { RoundSnapshot } from './snapshot.ts'

/**
 * Context passed to the `onReviewLeadingHypothesis` callback. Contains
 * everything a human reviewer needs to decide whether to approve the leader.
 */
export interface ReviewLeadingHypothesisContext {
  /** Current round number (the round that just finished Oracle). */
  round: number
  /** Project identifier — for looking up persistence / SSE context. */
  projectId: string
  /** Run identifier — for looking up persistence / SSE context. */
  runId: string
  /** The leading hypothesis ID (null if no hypotheses survived). */
  leadingHypoId: string | null
  /** The leading hypothesis statement (empty string if no leader). */
  leadingStatement: string
  /** Best F1 score so far. */
  bestF1: number
  /** Number of surviving hypotheses in the pool. */
  survivingCount: number
}

/**
 * Result returned by the `onReviewLeadingHypothesis` callback.
 * - `approved: true` → tournament continues to Prometheus (next round / final).
 * - `approved: false` → tournament still continues, but the feedback is
 *   forwarded to Prometheus as steering input (e.g. "force another round",
 *   "consider alternative mechanism"). The tournament does NOT abort on
 *   rejection — it just incorporates the feedback. To fully abort a run,
 *   use `POST /runs/:runId/stop`.
 */
export interface ReviewLeadingHypothesisResult {
  approved: boolean
  /** Optional steering feedback for Prometheus / next round. */
  feedback: string | null
}

/**
 * Optional human-in-the-loop callback invoked after Oracle and before
 * Prometheus on each round. When provided, the tournament pauses and calls
 * this function with the current leader context. The caller (typically the
 * Phase 4 API layer) surfaces this to a human reviewer via SSE
 * `tool-approval-request`-style chunk and resumes when the user responds.
 *
 * When omitted (default), the tournament runs fully automatic — no review
 * node is inserted. This keeps the tournament testable without a human in
 * the loop and matches the pre-Phase-4 behavior.
 */
export type OnReviewLeadingHypothesis = (
  context: ReviewLeadingHypothesisContext,
) => Promise<ReviewLeadingHypothesisResult>

/** Input to the Sisyphus tournament workflow. */
export interface TournamentWorkflowInput {
  /** Seed hypothesis text from the user / API layer. */
  seed: string
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /**
   * Serializable model descriptor — the default model applied to every
   * sub-agent that has no explicit entry in `agentConfigs`. Kept for backward
   * compatibility with the single-model tournament; when `agentConfigs` is
   * supplied it takes priority per-role.
   */
  modelConfig: import('@open-scientist/config').ModelArg
  /**
   * Per-agent runtime config map keyed by role name
   * (`sisyphus` / `librarian` / `looker` / `explore` / `oracle` /
   * `prometheus`). Each entry is a plain serializable
   * {@link AgentRuntimeConfig} carrying its own `modelConfig` plus optional
   * `instructions` / `skillDirectories` / `mcpServers` overrides.
   *
   * When `agentConfigs[role]` is present the sub-workflow receives it as
   * `agentConfig` and the factory applies the overrides; when absent the
   * sub-workflow falls back to `modelConfig` + factory defaults.
   */
  agentConfigs?: Record<string, AgentRuntimeConfig>
  /**
   * Optional SSE chunk sink. When provided, each `UIMessageChunk` produced by
   * any sub-agent's `fullStream` is forwarded to this callback. The
   * orchestrator (RunRegistry) buffers these for SSE replay / reconnect.
   */
  emitChunk?: EmitChunk
  /**
   * Optional human-in-the-loop review callback invoked after Oracle and before
   * Prometheus on each round. When provided, the tournament pauses for human
   * review of the leading hypothesis. When omitted (default), the tournament
   * runs fully automatic. See {@link OnReviewLeadingHypothesis}.
   */
  onReviewLeadingHypothesis?: OnReviewLeadingHypothesis
  /**
   * Optional snapshot to resume from (dev-mode crash recovery). When provided,
   * the tournament skips Round 1 (Librarian) and resumes from
   * `resumeFrom.round + 1` using the snapshot's hypotheses + convergence
   * history. Use {@link readLatestSnapshot} to find the latest snapshot for a
   * given project + run. When omitted (default), the tournament starts fresh
   * from Round 1.
   */
  resumeFrom?: RoundSnapshot
  /**
   * Optional abort signal. When provided, the tournament threads it into every
   * sub-workflow's `agent.stream({abortSignal})` call so `POST /stop` actually
   * halts in-flight LLM + tool execution rather than merely marking the
   * SQLite row stopped. The RunRegistry (`apps/api/src/lib/run-stream.ts`)
   * supplies the `AbortController`'s signal here on `start()`.
   */
  abortSignal?: AbortSignal
}

/**
 * Sisyphus tournament workflow: the Tournament Evolution orchestrator.
 *
 * Plain async function that composes the 5 specialist sub-agent workflows:
 *
 *   - Sequential `await` for librarian / oracle / prometheus (the parent needs
 *     the child's result before continuing).
 *   - Parallel `Promise.all` fan-out for Explore — each hypothesis evaluation
 *     runs concurrently. All sub-agent stream chunks are forwarded to
 *     `emitChunk` (if provided); chunks from parallel Explore runs may
 *     interleave, which is fine for SSE (each chunk is self-contained).
 *
 * Round structure (per SPEC §6):
 *   Round 1: librarian → (hypotheses pool)
 *   Round 2..MAX_ROUNDS:
 *     explore ×N (parallel) → oracle (critique + mutate) → [optional review] → prometheus (plan)
 *     → convergence check (F1 >= 0.9 OR round >= 10 OR !shouldContinue)
 *   Final round: prometheus with isFinalRound=true → MHD cfg + observation proposal
 *
 * RESUME FROM SNAPSHOT: when `resumeFrom` is provided (dev-mode crash
 * recovery), Round 1 (Librarian) is skipped and the tournament resumes from
 * `resumeFrom.round + 1` using the snapshot's hypotheses + convergence
 * history. Use `readLatestSnapshot(projectId, runId)` to find the latest
 * snapshot for a given run.
 *
 * HUMAN-IN-THE-LOOP: the SPEC calls for a `review_leading_hypothesis`
 * approval node after Oracle on high-stakes rounds. This is wired via the
 * optional `onReviewLeadingHypothesis` callback on `TournamentWorkflowInput`.
 * When provided, the tournament pauses after Oracle and calls the callback
 * with the current leader context. The caller (Phase 4 API layer) surfaces
 * this to a human reviewer via SSE and resumes when the user responds. The
 * feedback (if any) is forwarded to Prometheus as steering input. When the
 * callback is omitted (default), the tournament runs fully automatic.
 *
 * Additionally, the Sisyphus agent (see agent.ts) has `toolApproval` configured
 * for the `review_leading_hypothesis` tool, so when the Phase 4 API layer
 * spins up a Sisyphus `agent.stream()` (for free-form steering or LLM-driven
 * review), the stream suspends and emits a `tool-approval-request` chunk that
 * the frontend can render. The `onReviewLeadingHypothesis` callback here is
 * the deterministic-tournament equivalent — it does not require an LLM loop.
 *
 * The Sisyphus agent itself is NOT driven via agent.stream() here — the
 * tournament is deterministic control flow. The agent exists for the Phase 4
 * API layer to use when interpreting free-form user steering messages or
 * driving the approval tool. See `createSisyphusAgent`.
 */
export async function tournamentWorkflow(
  input: TournamentWorkflowInput,
): Promise<TournamentResult> {
  const {
    seed,
    projectId,
    runId,
    modelConfig,
    agentConfigs,
    emitChunk,
    onReviewLeadingHypothesis,
    resumeFrom,
    abortSignal,
  } = input

  // Helper: pull this role's override (if any) from agentConfigs.
  const agentConfigFor = (role: string) => agentConfigs?.[role]

  // Helper: emit an agent-state custom chunk so the frontend can update the
  // orchestrator hall node status in real time. The chunk shape matches the
  // UIMessageChunk `custom` type: { type:'custom', kind:'tournament.agent-state', role, state }.
  // Cast needed: the AI SDK's custom stream part type restricts `kind` to
  // `${string}.${string}` and doesn't allow extra fields, but toUIMessageStream
  // passes custom parts through verbatim at runtime.
  const emitAgentState = (role: string, agentState: string) => {
    if (emitChunk) {
      emitChunk({
        type: 'custom',
        kind: 'tournament.agent-state',
        role,
        state: agentState,
      } as never)
    }
  }

  // ─── Round 1: Librarian generates the hypothesis pool (or resume from snapshot) ───
  //
  // When `resumeFrom` is provided (dev-mode crash recovery), skip Round 1 and
  // restore the hypotheses + convergence history from the snapshot. The loop
  // starts at `resumeFrom.round + 1`. When omitted, run Librarian fresh.
  let hypotheses: Hypothesis[]
  let bestF1: number
  let leadingHypoId: string | null
  let convergenceHistory: ConvergenceEntry[]

  if (resumeFrom) {
    // Restore hypotheses + convergence history from the snapshot. The snapshot
    // doesn't persist `pythonCode` or `createdAt` (they're not needed for
    // resume — Explore re-derives pythonCode from the statement if the
    // hypothesis is re-evaluated). Provide sensible defaults.
    hypotheses = resumeFrom.hypotheses.map((h) => ({
      id: h.id,
      statement: h.statement,
      pythonCode: '', // not persisted in snapshot; Explore re-derives if needed
      parentId: h.parentId,
      round: h.round,
      f1: h.f1,
      status: h.status as Hypothesis['status'],
      createdAt: resumeFrom.capturedAt,
    }))
    bestF1 = resumeFrom.bestF1
    leadingHypoId = resumeFrom.leadingHypoId
    convergenceHistory = [...resumeFrom.convergenceHistory]
  } else {
    emitAgentState('librarian', 'thinking')
    const hypoPool = await librarianWorkflow({
      seed,
      projectId,
      runId,
      modelConfig,
      ...(agentConfigFor('librarian') ? { agentConfig: agentConfigFor('librarian') } : {}),
      ...(emitChunk ? { emitChunk } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    })
    emitAgentState('librarian', 'idle')
    hypotheses = [...hypoPool.hypotheses]
    bestF1 = 0
    leadingHypoId = null
    convergenceHistory = []
  }

  // Final-round outputs (filled by Prometheus when the tournament converges).
  let mhdConfigPath: string | null = null
  let proposalPath: string | null = null
  let totalRounds = resumeFrom ? resumeFrom.round : 1

  // ─── Rounds (resumeFrom.round + 1)..MAX_ROUNDS: Explore → Oracle → Prometheus loop ───
  //
  // When resuming, start at resumeFrom.round + 1 (the snapshot's round already
  // completed). When fresh, start at 2 (Round 1 was Librarian).
  const startRound = resumeFrom ? resumeFrom.round + 1 : 2
  for (let round = startRound; round <= MAX_ROUNDS; round++) {
    totalRounds = round

    // ── Explore: parallel evaluation of every hypothesis ──
    //
    // Each hypothesis gets its own Explore workflow run with an isolated
    // per-hypothesis bash workspace. Fan-out via Promise.all gives true
    // parallelism; all sub-agent chunks forward to emitChunk concurrently
    // (JS is single-threaded, so the push is safe; chunks may interleave).
    emitAgentState('explore', 'thinking')
    const evalResults: EvalResult[] = await Promise.all(
      hypotheses.map((h) =>
        exploreWorkflow({
          hypoId: h.id,
          projectId,
          runId,
          round,
          hypothesis: { statement: h.statement, pythonCode: h.pythonCode },
          modelConfig,
          ...(agentConfigFor('explore') ? { agentConfig: agentConfigFor('explore') } : {}),
          ...(emitChunk ? { emitChunk } : {}),
          ...(abortSignal ? { abortSignal } : {}),
        }),
      ),
    )
    emitAgentState('explore', 'idle')

    // ── Update hypotheses with F1 + status from this round's evaluations ──
    hypotheses = updateHypothesesWithEval(hypotheses, evalResults)

    const { bestF1: roundBestF1, leadingHypoId: roundLeader } = computeLeader(hypotheses)
    bestF1 = roundBestF1
    leadingHypoId = roundLeader

    convergenceHistory.push(buildConvergenceEntry(round, bestF1, hypotheses.length))

    // ── Persist round snapshot ──
    await snapshotStep({
      round,
      runId,
      projectId,
      bestF1,
      leadingHypoId,
      survivingCount: hypotheses.length,
      hypotheses: hypotheses.map((h) => ({
        id: h.id,
        statement: h.statement,
        f1: h.f1,
        status: h.status,
        parentId: h.parentId,
        round: h.round,
      })),
      convergenceHistory,
      capturedAt: new Date().toISOString(),
    })

    // ── Convergence check #1: F1 target hit → skip Oracle/Prometheus, go to final ──
    if (shouldStopByTarget(bestF1)) {
      break
    }

    // ── Oracle: critique + mutate + eliminate ──
    emitAgentState('oracle', 'thinking')
    const oracleOutput = await oracleWorkflow({
      projectId,
      runId,
      round,
      hypotheses,
      evalResults,
      modelConfig,
      ...(agentConfigFor('oracle') ? { agentConfig: agentConfigFor('oracle') } : {}),
      ...(emitChunk ? { emitChunk } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    })
    emitAgentState('oracle', 'idle')

    // Apply Oracle's pruning + mutations to the pool.
    hypotheses = applyOraclePruning(hypotheses, oracleOutput)

    // Oracle may declare a winner early (clear convergence this round).
    if (oracleOutput.winningHypoId) {
      leadingHypoId = oracleOutput.winningHypoId
      break
    }

    // Guard against an empty pool (over-aggressive elimination).
    if (hypotheses.length === 0) {
      break
    }

    // ── Human-in-the-loop review node (optional) ──
    //
    // When `onReviewLeadingHypothesis` is provided, pause the tournament and
    // ask a human reviewer to approve the leader. The callback returns
    // {approved, feedback}. On rejection the tournament does NOT abort — the
    // feedback is forwarded to Prometheus as steering input (e.g. "force
    // another round", "consider nanoflares"). To fully abort, use
    // `POST /runs/:runId/stop`. When the callback is omitted (default), the
    // tournament runs fully automatic.
    let reviewFeedback: string | null = null
    if (onReviewLeadingHypothesis) {
      const leaderHypo =
        leadingHypoId !== null ? hypotheses.find((h) => h.id === leadingHypoId) : undefined
      const reviewResult = await onReviewLeadingHypothesis({
        round,
        projectId,
        runId,
        leadingHypoId,
        leadingStatement: leaderHypo?.statement ?? '',
        bestF1,
        survivingCount: hypotheses.length,
      })
      reviewFeedback = reviewResult.feedback
    }

    // ── Prometheus: plan next round ──
    emitAgentState('prometheus', 'thinking')
    const prometheusOutput = await prometheusWorkflow({
      projectId,
      runId,
      round,
      convergenceHistory,
      currentBestF1: bestF1,
      isFinalRound: false,
      modelConfig,
      ...(agentConfigFor('prometheus') ? { agentConfig: agentConfigFor('prometheus') } : {}),
      ...(emitChunk ? { emitChunk } : {}),
      ...(reviewFeedback !== null ? { userFeedback: reviewFeedback } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    })
    emitAgentState('prometheus', 'idle')

    // ── Convergence check #2: Prometheus says stop OR round cap hit ──
    if (shouldStopByPrometheus(prometheusOutput.shouldContinue, round)) {
      break
    }
  }

  // ─── Final round: Prometheus generates MHD cfg + observation proposal ───
  emitAgentState('prometheus', 'thinking')
  const winningStatement =
    leadingHypoId != null ? (hypotheses.find((h) => h.id === leadingHypoId)?.statement ?? '') : ''

  const finalPrometheus = await prometheusWorkflow({
    projectId,
    runId,
    round: totalRounds,
    convergenceHistory,
    currentBestF1: bestF1,
    isFinalRound: true,
    winningHypothesis:
      leadingHypoId != null ? { hypoId: leadingHypoId, statement: winningStatement } : undefined,
    modelConfig,
    ...(agentConfigFor('prometheus') ? { agentConfig: agentConfigFor('prometheus') } : {}),
    ...(emitChunk ? { emitChunk } : {}),
    ...(abortSignal ? { abortSignal } : {}),
  })
  emitAgentState('prometheus', 'idle')

  if (finalPrometheus.mhdConfig) {
    mhdConfigPath = finalPrometheus.mhdConfig.cfgPath
    proposalPath = finalPrometheus.mhdConfig.proposalPath
  }

  return {
    runId,
    winningHypoId: leadingHypoId ?? '',
    bestF1,
    totalRounds,
    mhdConfigPath,
    proposalPath,
  }
}
