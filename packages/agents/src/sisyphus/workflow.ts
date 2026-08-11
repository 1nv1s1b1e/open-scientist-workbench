import {
  MAX_ROUNDS,
  TARGET_F1,
  type AgentRuntimeConfig,
  type ModelArg,
} from '@open-scientist/config'
import type {
  ConvergenceEntry,
  EvalResult,
  EvidenceAlignment,
  Hypothesis,
  PhenomenonInput,
  TournamentResult,
} from '@open-scientist/schema'
import type { UIMessageChunk } from 'ai'
import { exploreWorkflow } from '../explore/workflow.ts'
import { librarianWorkflow } from '../librarian/workflow.ts'
import { lookerWorkflow } from '../looker/workflow.ts'
import { oracleWorkflow } from '../oracle/workflow.ts'
import { prometheusWorkflow } from '../prometheus/workflow.ts'
import type { EmitChunk } from '../shared/stream.ts'
import {
  createTournamentScienceLoopRecorder,
  type ScienceLoopRecorder,
} from '../harness/recorder.ts'
import { selectLeadingHypothesis } from './leader.ts'
import type { RoundSnapshot } from './snapshot.ts'
import { snapshotStep } from './snapshot.ts'
import { buildEvidenceAlignmentJobs } from './evidence.ts'
import {
  applyEvaluationResults,
  applyOracleRevision,
  getActiveHypotheses,
  getRevisionTriggers,
} from './loop-logic.ts'

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
 * the loop.
 */
export type OnReviewLeadingHypothesis = (
  context: ReviewLeadingHypothesisContext,
) => Promise<ReviewLeadingHypothesisResult>

/** Input to the Sisyphus tournament workflow. */
export interface TournamentWorkflowInput {
  /** Seed hypothesis text from the user / API layer. */
  seed: string
  /** Structured solar-physics phenomenon selects the scientific-loop path. */
  phenomenon?: PhenomenonInput
  /** Scientific mode may resume from its LangGraph checkpoint without resending phenomenon. */
  resume?: boolean
  /** Explicit API marker; legacy tournament resume must not enter scientific mode. */
  scientificResume?: boolean
  /** Hard cap for the scientific loop; legacy tournament keeps its own cap. */
  maxRounds?: number
  /** Use verified local literature and observation metadata without constructing a model client. */
  localGrounded?: boolean
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /**
   * Serializable model descriptor — the default model applied to every
   * sub-agent that has no explicit entry in `agentConfigs`. When
   * `agentConfigs` is supplied it takes priority per-role.
   */
  modelConfig: ModelArg
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
 * Plain async function that composes the 4 specialist sub-agent workflows:
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
  const loopRecorder = await createTournamentScienceLoopRecorder({
    projectId: input.projectId,
    runId: input.runId,
    question: input.seed,
  })

  try {
    return await runTournamentWorkflow(input, loopRecorder)
  } catch (error) {
    const phase = loopRecorder.getState().phase
    if (phase !== 'completed' && phase !== 'failed') {
      await loopRecorder
        .transition('failed', {
          round: input.resumeFrom?.round ?? 0,
          reason: error instanceof Error ? error.message : String(error),
        })
        .catch(() => undefined)
    }
    throw error
  }
}

async function runTournamentWorkflow(
  input: TournamentWorkflowInput,
  loopRecorder: ScienceLoopRecorder,
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
  // orchestrator hall node status in real time. Cast: AI SDK's UIMessageChunk
  // `custom` type restricts `kind` to `${string}.${string}` and disallows extra
  // fields, but toUIMessageStream passes custom parts through verbatim at runtime.
  const emitAgentState = (role: string, agentState: string) => {
    if (emitChunk) {
      emitChunk({
        type: 'custom',
        kind: 'tournament.agent-state',
        role,
        state: agentState,
      } as unknown as UIMessageChunk)
    }
  }

  // Emit a phase-start marker so the frontend can tag messages with (round, hypoId)
  // for the round-hypothesis selector. `hypoId` is undefined for non-hypothesis-specific
  // phases (Librarian, Oracle, Prometheus). For Explore, call once per hypothesis.
  const emitPhaseStart = (role: string, round: number, hypoId?: string) => {
    if (emitChunk) {
      emitChunk({
        type: 'custom',
        kind: 'tournament.phase-start',
        role,
        round,
        hypoId: hypoId ?? null,
      } as unknown as UIMessageChunk)
    }
  }

  // Helper: emit a round-update custom chunk with the current hypothesis pool
  // + convergence history so the frontend can render the evolution tree and
  // concept net from real data (not mock defaults).
  const emitRoundUpdate = (round: number, hypos: Hypothesis[], convergence: ConvergenceEntry[]) => {
    if (emitChunk) {
      emitChunk({
        type: 'custom',
        kind: 'tournament.round-update',
        round,
        hypotheses: hypos.map((h) => ({
          id: h.id,
          statement: h.statement,
          mechanism: h.mechanism,
          predictions: h.predictions,
          falsificationConditions: h.falsificationConditions,
          sourceIds: h.sourceIds,
          parentId: h.parentId,
          round: h.round,
          f1: h.f1,
          status: h.status,
          createdAt: h.createdAt,
        })),
        convergenceHistory: convergence,
      } as unknown as UIMessageChunk)
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
    // Restore the complete executable/scientific hypothesis context from the
    // snapshot. `createdAt` is reconstructed from the capture timestamp.
    hypotheses = resumeFrom.hypotheses.map((h) => ({
      id: h.id,
      statement: h.statement,
      mechanism: h.mechanism,
      predictions: h.predictions,
      falsificationConditions: h.falsificationConditions,
      sourceIds: h.sourceIds,
      pythonCode: h.pythonCode,
      parentId: h.parentId,
      round: h.round,
      f1: h.f1,
      status: h.status as Hypothesis['status'],
      createdAt: resumeFrom.capturedAt,
    }))
    bestF1 = resumeFrom.bestF1
    leadingHypoId = resumeFrom.leadingHypoId
    convergenceHistory = [...resumeFrom.convergenceHistory]
    await loopRecorder.transition('hypothesis', {
      resumedFromRound: resumeFrom.round,
      hypothesisIds: hypotheses.map((hypothesis) => hypothesis.id),
    })
  } else {
    emitPhaseStart('librarian', 1)
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
    await loopRecorder.transition('hypothesis', {
      round: 1,
      hypothesisIds: hypotheses.map((hypothesis) => hypothesis.id),
    })
    // Emit initial hypotheses from Librarian (Round 1)
    emitRoundUpdate(1, hypotheses, convergenceHistory)
  }

  if (getActiveHypotheses(hypotheses).length === 0) {
    const failureReason = 'hypothesis pool is empty after structured validation or resume'
    await loopRecorder.transition('failed', {
      round: resumeFrom?.round ?? 1,
      reason: failureReason,
      hypothesisIds: hypotheses.map((hypothesis) => hypothesis.id),
    })
    throw new Error(failureReason)
  }

  // Final-round outputs (filled by Prometheus when the tournament converges).
  let mhdConfigPath: string | null = null
  let proposalPath: string | null = null
  let totalRounds = resumeFrom ? resumeFrom.round : 0

  // ─── Rounds 1..MAX_ROUNDS: Librarian (Round 1) → Explore → Oracle → Prometheus loop ───
  //
  // Librarian runs once before the loop (Round 1, generating the initial pool).
  // The loop starts at Round 1 so Explore/Oracle/Prometheus share the same round
  // number as Librarian's initial pool. When resuming, skip completed rounds.
  const startRound = resumeFrom ? resumeFrom.round + 1 : 1
  for (let round = startRound; round <= MAX_ROUNDS; round++) {
    totalRounds = round

    const activeHypotheses = getActiveHypotheses(hypotheses)
    if (activeHypotheses.length === 0) {
      await loopRecorder.transition('failed', {
        round,
        reason: 'Oracle left no active hypothesis for the next evaluation pass',
        hypothesisIds: hypotheses.map((hypothesis) => hypothesis.id),
      })
      break
    }

    if (loopRecorder.getState().phase === 'validation_plan') {
      await loopRecorder.transition('hypothesis', {
        round,
        hypothesisIds: activeHypotheses.map((hypothesis) => hypothesis.id),
      })
    }

    await loopRecorder.transition('evidence', {
      round,
      source: 'configured dataset manifest and snapshot index',
      hypothesisIds: activeHypotheses.map((hypothesis) => hypothesis.id),
    })

    // ── Explore: parallel evaluation of every hypothesis ──
    //
    // Each hypothesis gets its own Explore workflow run with an isolated
    // per-hypothesis bash workspace. Fan-out via Promise.all gives true
    // parallelism; all sub-agent chunks forward to emitChunk concurrently
    // (JS is single-threaded, so the push is safe; chunks may interleave).
    emitAgentState('explore', 'thinking')
    const evalResults: EvalResult[] = await Promise.all(
      activeHypotheses.map((h) =>
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

    // ── Looker: align only deterministic, manifest-backed candidates ──
    //
    // The demo JW-FD manifest has no active-region/time/wavelength fields, so
    // this job list is empty there. A real dataset can opt in by declaring the
    // three fields in featureColumns; no astronomical metadata is fabricated.
    const evidenceJobs = buildEvidenceAlignmentJobs(evalResults, 1)
    let evidenceAlignments: Array<{
      hypoId: string
      snapshotId: string
      alignment: EvidenceAlignment
    }> = []
    if (evidenceJobs.length > 0) {
      emitAgentState('looker', 'thinking')
      evidenceAlignments = await Promise.all(
        evidenceJobs.map(async (job) => {
          emitPhaseStart('looker', round, job.hypoId)
          const alignment = await lookerWorkflow({
            hypoId: job.hypoId,
            projectId,
            runId,
            candidateCase: job.candidateCase,
            modelConfig,
            ...(agentConfigFor('looker') ? { agentConfig: agentConfigFor('looker') } : {}),
            ...(emitChunk ? { emitChunk } : {}),
            ...(abortSignal ? { abortSignal } : {}),
          })
          return { hypoId: job.hypoId, snapshotId: job.snapshotId, alignment }
        }),
      )
      emitAgentState('looker', 'idle')
    }

    await loopRecorder.transition('evaluation', {
      round,
      results: evalResults.map((result) => ({
        hypoId: result.hypoId,
        f1: result.f1,
        truePositives: result.truePositives,
        falsePositives: result.falsePositives,
        falseNegatives: result.falseNegatives,
        executionMs: result.executionMs,
      })),
      evidenceAlignmentJobs: evidenceJobs.map((job) => ({
        hypoId: job.hypoId,
        snapshotId: job.snapshotId,
      })),
      evidenceAlignments: evidenceAlignments.map(({ hypoId, snapshotId, alignment }) => ({
        hypoId,
        snapshotId,
        fitsPaths: alignment.fitsPaths,
        videoClipPath: alignment.videoClipPath,
        metadata: alignment.metadata,
      })),
    })
    await loopRecorder.transition('counterexample', {
      round,
      counterexamples: evalResults.flatMap((result) =>
        result.counterexamples.map((counterexample) => ({
          hypoId: result.hypoId,
          snapshotId: counterexample.snapshotId,
          reason: counterexample.reason,
        })),
      ),
    })

    // ── Update hypotheses with F1 + status from this round's evaluations ──
    hypotheses = applyEvaluationResults(hypotheses, evalResults)

    const roundBestF1 = activeHypotheses.reduce((max, h) => {
      const current = hypotheses.find((candidate) => candidate.id === h.id)
      return Math.max(max, current?.f1 ?? 0)
    }, 0)
    bestF1 = Math.max(bestF1, roundBestF1)
    leadingHypoId = selectLeadingHypothesis(getActiveHypotheses(hypotheses)).hypoId

    convergenceHistory.push({ round, bestF1, count: activeHypotheses.length })

    // Emit evaluated hypotheses with F1 scores (visualizer can show the tree)
    emitRoundUpdate(round, hypotheses, convergenceHistory)

    // ── Persist round snapshot ──
    await snapshotStep({
      round,
      runId,
      projectId,
      bestF1,
      leadingHypoId,
      survivingCount: getActiveHypotheses(hypotheses).length,
      hypotheses: hypotheses.map((h) => ({
        id: h.id,
        statement: h.statement,
        mechanism: h.mechanism,
        predictions: h.predictions,
        falsificationConditions: h.falsificationConditions,
        sourceIds: h.sourceIds,
        pythonCode: h.pythonCode,
        f1: h.f1,
        status: h.status,
        parentId: h.parentId,
        round: h.round,
      })),
      convergenceHistory,
      capturedAt: new Date().toISOString(),
    })

    // ── Convergence check #1: F1 target hit → skip Oracle/Prometheus, go to final ──
    if (bestF1 >= TARGET_F1) {
      await loopRecorder.transition('revision', {
        round,
        triggeredBy: 'deterministic evaluation reached the configured target',
        mutations: [],
      })
      break
    }

    // ── Oracle: critique + mutate + eliminate ──
    emitPhaseStart('oracle', round)
    emitAgentState('oracle', 'thinking')
    const oracleOutput = await oracleWorkflow({
      projectId,
      runId,
      round,
      hypotheses: getActiveHypotheses(hypotheses),
      evalResults,
      modelConfig,
      ...(agentConfigFor('oracle') ? { agentConfig: agentConfigFor('oracle') } : {}),
      ...(emitChunk ? { emitChunk } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    })
    emitAgentState('oracle', 'idle')

    // Apply Oracle's pruning + mutations to the pool.
    hypotheses = applyOracleRevision(hypotheses, oracleOutput)
    leadingHypoId = selectLeadingHypothesis(getActiveHypotheses(hypotheses)).hypoId

    await loopRecorder.transition('revision', {
      round,
      triggeredBy: getRevisionTriggers(evalResults, oracleOutput),
      mutations: oracleOutput.mutations.map((mutation) => ({
        parentHypoId: mutation.parentHypoId,
        childHypoId: mutation.mutatedHypothesis.id,
        rationale: mutation.mutationRationale,
      })),
    })

    // Emit mutated/eliminated hypothesis pool (visualizer shows new branches)
    emitRoundUpdate(round, hypotheses, convergenceHistory)

    // Oracle may declare a winner early (clear convergence this round).
    if (oracleOutput.winningHypoId) {
      if (!getActiveHypotheses(hypotheses).some((h) => h.id === oracleOutput.winningHypoId)) {
        throw new Error(
          `Oracle winner is not an active hypothesis: ${oracleOutput.winningHypoId}`,
        )
      }
      leadingHypoId = oracleOutput.winningHypoId
      break
    }

    // Guard against an empty pool (over-aggressive elimination).
    if (getActiveHypotheses(hypotheses).length === 0) {
      await loopRecorder.transition('failed', {
        round,
        reason: 'Oracle eliminated every active hypothesis without a mutation',
        hypothesisIds: hypotheses.map((hypothesis) => hypothesis.id),
        triggeredBy: getRevisionTriggers(evalResults, oracleOutput),
      })
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
        survivingCount: getActiveHypotheses(hypotheses).length,
      })
      reviewFeedback = reviewResult.feedback
    }

    // ── Prometheus: plan next round ──
    emitPhaseStart('prometheus', round)
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
    if (!prometheusOutput.shouldContinue || round >= MAX_ROUNDS) {
      await loopRecorder.transition('validation_plan', {
        round,
        plan: prometheusOutput.plan,
        shouldContinue: prometheusOutput.shouldContinue,
      })
      break
    }

    await loopRecorder.transition('validation_plan', {
      round,
      plan: prometheusOutput.plan,
      shouldContinue: true,
    })
  }

  if (loopRecorder.getState().phase === 'failed') {
    throw new Error(`Science loop failed during round ${totalRounds}`)
  }

  if (leadingHypoId === null) {
    const failureReason = 'no evaluated active hypothesis is available for final validation'
    await loopRecorder.transition('failed', {
      round: totalRounds,
      reason: failureReason,
      hypothesisIds: hypotheses.map((hypothesis) => hypothesis.id),
    })
    throw new Error(failureReason)
  }

  // ─── Final round: Prometheus generates MHD cfg + observation proposal ───
  emitPhaseStart('prometheus', totalRounds)
  emitAgentState('prometheus', 'thinking')
  const winningHypothesis =
    leadingHypoId !== null ? hypotheses.find((h) => h.id === leadingHypoId) : undefined

  const finalPrometheus = await prometheusWorkflow({
    projectId,
    runId,
    round: totalRounds,
    convergenceHistory,
    currentBestF1: bestF1,
    isFinalRound: true,
    winningHypothesis: winningHypothesis
      ? {
          hypoId: winningHypothesis.id,
          statement: winningHypothesis.statement,
          mechanism: winningHypothesis.mechanism,
          predictions: winningHypothesis.predictions,
          falsificationConditions: winningHypothesis.falsificationConditions,
          sourceIds: winningHypothesis.sourceIds,
        }
      : undefined,
    modelConfig,
    ...(agentConfigFor('prometheus') ? { agentConfig: agentConfigFor('prometheus') } : {}),
    ...(emitChunk ? { emitChunk } : {}),
    ...(abortSignal ? { abortSignal } : {}),
  })
  emitAgentState('prometheus', 'idle')

  if (finalPrometheus.mhdConfig === null) {
    const failureReason = 'final Prometheus output did not contain an MHD configuration artifact'
    if (loopRecorder.getState().phase !== 'failed') {
      await loopRecorder.transition('failed', {
        round: totalRounds,
        reason: failureReason,
        winningHypoId: leadingHypoId,
      })
    }
    throw new Error(failureReason)
  }

  if (loopRecorder.getState().phase === 'counterexample') {
    await loopRecorder.transition('revision', {
      round: totalRounds,
      triggeredBy: 'final planning requested before convergence',
      mutations: [],
    })
  }
  if (loopRecorder.getState().phase === 'revision') {
    await loopRecorder.transition('validation_plan', {
      round: totalRounds,
      plan: finalPrometheus.plan,
      shouldContinue: false,
    })
  }
  if (loopRecorder.getState().phase === 'validation_plan') {
    await loopRecorder.transition('completed', {
      round: totalRounds,
      winningHypoId: leadingHypoId,
      bestF1,
    })
  }

  if (finalPrometheus.mhdConfig) {
    mhdConfigPath = finalPrometheus.mhdConfig.cfgPath
    proposalPath = finalPrometheus.mhdConfig.proposalPath
  }

  // Emit final round-update with winner status
  if (leadingHypoId !== null) {
    hypotheses = hypotheses.map((h) =>
      h.id === leadingHypoId ? { ...h, status: 'winner' as const } : h,
    )
    emitRoundUpdate(totalRounds, hypotheses, convergenceHistory)
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
