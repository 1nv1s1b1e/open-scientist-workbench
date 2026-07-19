'use workflow'

import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { ModelArg } from '@open-scientist/config'
import type { EvalResult, Hypothesis, OracleOutput, TournamentResult } from '@open-scientist/schema'
import { getWritable } from 'workflow'
import type { Run } from 'workflow/api'
import type { ConvergenceEntry } from '../prometheus/workflow.js'
import type { RoundSnapshot, SpawnExploreEvalArgs } from './steps/index.js'

/** Local typed shape of `./steps/index.js` — avoids `typeof import()` (which bundles). */
interface StepsModule {
  spawnExploreEvalStep: (args: SpawnExploreEvalArgs) => Promise<Run<EvalResult>>
  waitForRunStep: <T>(run: Run<T>) => Promise<T>
  snapshotStep: (snapshot: RoundSnapshot) => Promise<{ path: string }>
}

/** Local typed shape of `./logic.js` — avoids `typeof import()` (which bundles). */
interface LogicModule {
  updateHypothesesWithEval: (hypotheses: Hypothesis[], evalResults: EvalResult[]) => Hypothesis[]
  computeLeader: (hypotheses: Hypothesis[]) => { bestF1: number; leadingHypoId: string | null }
  shouldStopByTarget: (bestF1: number) => boolean
  applyOraclePruning: (hypotheses: Hypothesis[], oracleOutput: OracleOutput) => Hypothesis[]
  buildConvergenceEntry: (round: number, bestF1: number, count: number) => ConvergenceEntry
  shouldStopByPrometheus: (shouldContinue: boolean, round: number) => boolean
}

/** Local typed shape of the sub-workflow modules. */
interface LibrarianWorkflowModule {
  librarianWorkflow: (input: {
    seed: string
    projectId: string
    runId: string
    modelConfig: ModelArg
  }) => Promise<{ hypotheses: Hypothesis[] }>
}
interface OracleWorkflowModule {
  oracleWorkflow: (input: {
    projectId: string
    runId: string
    round: number
    hypotheses: Hypothesis[]
    evalResults: EvalResult[]
    modelConfig: ModelArg
  }) => Promise<OracleOutput>
}
interface PrometheusWorkflowModule {
  prometheusWorkflow: (input: {
    projectId: string
    runId: string
    round: number
    convergenceHistory: ConvergenceEntry[]
    currentBestF1: number
    isFinalRound: boolean
    winningHypothesis?: { hypoId: string; statement: string }
    modelConfig: ModelArg
  }) => Promise<{
    shouldContinue: boolean
    mhdConfig?: { cfgPath: string; observationProposal: string } | null
  }>
}
interface ConfigModule {
  MAX_ROUNDS: number
}

export type { TournamentInput, TournamentResult } from '@open-scientist/schema'

/** Input to the Sisyphus tournament workflow. */
export interface TournamentWorkflowInput {
  /** Seed hypothesis text from the user / API layer. */
  seed: string
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /**
   * Serializable model descriptor — forwarded verbatim to every sub-agent
   * workflow. Each sub-agent's `createXxxAgent` factory reconstructs a
   * `LanguageModel` via `createModelFromConfig(modelConfig)`.
   * The tournament workflow never holds a `LanguageModel` instance itself,
   * because workflow args are structured-clone serialized at every spawn
   * boundary and cannot carry bound methods / SDK clients.
   */
  modelConfig: ModelArg
}

/**
 * Sisyphus tournament workflow: the Tournament Evolution orchestrator.
 *
 * This is a PARENT workflow that composes the 5 specialist sub-agent workflows
 * via Workflow Composition (Workflow DevKit §4.2):
 *
 *   - Direct await (flattening) for SEQUENTIAL composition — the parent needs
 *     the child's result before continuing. Used for librarian / looker /
 *     oracle / prometheus. The child's steps flatten into the parent's event
 *     log and share the parent's runId.
 *
 *   - Background spawn via `start()` for PARALLEL fan-out — each parallel
 *     Explore evaluation gets its own runId + event log + retry boundary.
 *     `start()` MUST be called inside a 'use step' function (see
 *     `spawnExploreEvalStep`); the parent then awaits each Run's
 *     `returnValue` (via `waitForRunStep`) to collect the EvalResults.
 *
 * Round structure (per SPEC §6):
 *   Round 1: librarian → (hypotheses pool)
 *   Round 2..MAX_ROUNDS:
 *     explore ×N (parallel) → oracle (critique + mutate) → prometheus (plan)
 *     → convergence check (F1 >= 0.9 OR round >= 10 OR !shouldContinue)
 *   Final round: prometheus with isFinalRound=true → MHD cfg + observation proposal
 *
 * HUMAN-IN-THE-LOOP (TODO — Phase 4): the SPEC calls for a
 * `review_leading_hypothesis` needsApproval node after Oracle on high-stakes
 * rounds. AI SDK 7 deprecated tool-level `needsApproval` in favor of
 * streamText-level `toolApproval`, which WorkflowAgent.stream does not expose
 * on its options. Wiring this requires Phase 4 API-layer work (suspend the
 * parent workflow via a Hook and resume on user approval). For now the
 * tournament runs fully automatic — the review tool is defined on the
 * Sisyphus agent (see agent.ts) and will be invoked once the approval transport
 * is in place.
 *
 * The Sisyphus agent itself is NOT driven via agent.stream() here — the
 * tournament is deterministic control flow. The agent exists for the Phase 4
 * API layer to use when interpreting free-form user steering messages or
 * driving the approval tool. See `createSisyphusAgent`.
 *
 * runtimeContext discipline: only serializable identifiers (projectId / runId /
 * round) cross the workflow + step boundaries. The model descriptor
 * (`ModelArg` — a plain object) is threaded through workflow args at every
 * spawn boundary and reconstructed into a `LanguageModel` inside each
 * `createXxxAgent` factory; no `LanguageModel` instance ever crosses a
 * structured-clone boundary.
 */
export async function tournamentWorkflow(
  input: TournamentWorkflowInput,
): Promise<TournamentResult> {
  const { seed, projectId, runId, modelConfig } = input

  // Dynamic imports keep heavy / Node-touching modules out of the esbuild
  // workflow bundle:
  //   - sub-workflow modules (librarian/oracle/prometheus/explore) each pull
  //     their own agent.ts → tools/skills/config → node:fs/node:path chain;
  //     workflow functions may not transitively import Node modules.
  //   - ./steps/index.js pulls getRoundsDir from @open-scientist/config
  //     (node:path) + workflow/api's start() (fine in steps, but the static
  //     import would still drag the config chain into the workflow bundle).
  //   - ./logic.js imports MAX_ROUNDS/TARGET_F1 from @open-scientist/config
  //     (the config barrel re-exports paths.ts → node:path).
  //   - @open-scientist/config itself re-exports paths.ts (node:path) +
  //     settings.ts (node:fs/promises).
  //
  // The import specifiers are stored in variables so esbuild cannot statically
  // resolve them and therefore leaves them as runtime import() calls instead
  // of bundling the modules (and their node:* transitive deps) into the
  // workflow bundle. The workflow VM executes these dynamic imports at runtime
  // against the host Node runtime.
  const librarianSpecifier = '../librarian/workflow.js'
  const librarianModule = (await import(librarianSpecifier)) as LibrarianWorkflowModule
  const oracleSpecifier = '../oracle/workflow.js'
  const oracleModule = (await import(oracleSpecifier)) as OracleWorkflowModule
  const prometheusSpecifier = '../prometheus/workflow.js'
  const prometheusModule = (await import(prometheusSpecifier)) as PrometheusWorkflowModule
  const stepsSpecifier = './steps/index.js'
  const stepsModule = (await import(stepsSpecifier)) as StepsModule
  const logicSpecifier = './logic.js'
  const logicModule = (await import(logicSpecifier)) as LogicModule
  const configSpecifier = '@open-scientist/config'
  const configModule = (await import(configSpecifier)) as ConfigModule
  const { MAX_ROUNDS } = configModule

  // ─── Round 1: Librarian generates the hypothesis pool (direct await) ───
  const hypoPool = await librarianModule.librarianWorkflow({ seed, projectId, runId, modelConfig })
  let hypotheses: Hypothesis[] = [...hypoPool.hypotheses]

  // Best-F1 + convergence tracking across rounds.
  let bestF1 = 0
  let leadingHypoId: string | null = null
  const convergenceHistory: ConvergenceEntry[] = []

  // Final-round outputs (filled by Prometheus when the tournament converges).
  let mhdConfigPath: string | null = null
  let observationProposal: string | null = null
  let totalRounds = 1

  // ─── Rounds 2..MAX_ROUNDS: Explore → Oracle → Prometheus loop ───
  for (let round = 2; round <= MAX_ROUNDS; round++) {
    totalRounds = round

    // ── Explore: parallel evaluation of every hypothesis (background spawn) ──
    //
    // Each hypothesis gets its own Explore workflow run with an independent
    // runId + retry boundary. `spawnExploreEvalStep` wraps `start()` (which
    // MUST live inside a 'use step'); `waitForRunStep` awaits each Run's
    // `returnValue` (polls the run store until the child completes).
    //
    // Fan-out: spawn all N runs first (don't block on any single one), then
    // await all returnValues in parallel — true parallelism, not sequential
    // awaits.
    const exploreRuns = await Promise.all(
      hypotheses.map((h) =>
        stepsModule.spawnExploreEvalStep({
          hypoId: h.id,
          projectId,
          runId,
          round,
          hypothesis: { statement: h.statement, pythonCode: h.pythonCode },
          modelConfig,
        }),
      ),
    )
    const evalResults: EvalResult[] = await Promise.all(
      exploreRuns.map((run) => stepsModule.waitForRunStep<EvalResult>(run)),
    )

    // ── Update hypotheses with F1 + status from this round's evaluations ──
    hypotheses = logicModule.updateHypothesesWithEval(hypotheses, evalResults)

    const { bestF1: roundBestF1, leadingHypoId: roundLeader } =
      logicModule.computeLeader(hypotheses)
    bestF1 = roundBestF1
    leadingHypoId = roundLeader

    convergenceHistory.push(logicModule.buildConvergenceEntry(round, bestF1, hypotheses.length))

    // ── Persist round snapshot (durable, retriable) ──
    await stepsModule.snapshotStep({
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
    if (logicModule.shouldStopByTarget(bestF1)) {
      break
    }

    // ── Oracle: critique + mutate + eliminate (direct await) ──
    const oracleOutput = await oracleModule.oracleWorkflow({
      projectId,
      runId,
      round,
      hypotheses,
      evalResults,
      modelConfig,
    })

    // Apply Oracle's pruning + mutations to the pool.
    hypotheses = logicModule.applyOraclePruning(hypotheses, oracleOutput)

    // Oracle may declare a winner early (clear convergence this round).
    if (oracleOutput.winningHypoId) {
      leadingHypoId = oracleOutput.winningHypoId
      break
    }

    // Guard against an empty pool (over-aggressive elimination).
    if (hypotheses.length === 0) {
      break
    }

    // TODO(Phase 4): insert the `review_leading_hypothesis` human-in-the-loop
    // node here once the approval transport (workflow Hook + API resume) is
    // wired in. Sisyphus agent already defines the tool (see agent.ts). For
    // now the tournament runs fully automatic.

    // ── Prometheus: plan next round (direct await) ──
    const prometheusOutput = await prometheusModule.prometheusWorkflow({
      projectId,
      runId,
      round,
      convergenceHistory,
      currentBestF1: bestF1,
      isFinalRound: false,
      modelConfig,
    })

    // ── Convergence check #2: Prometheus says stop OR round cap hit ──
    if (logicModule.shouldStopByPrometheus(prometheusOutput.shouldContinue, round)) {
      break
    }
  }

  // ─── Final round: Prometheus generates MHD cfg + observation proposal ───
  const winningStatement =
    leadingHypoId != null ? (hypotheses.find((h) => h.id === leadingHypoId)?.statement ?? '') : ''

  const finalPrometheus = await prometheusModule.prometheusWorkflow({
    projectId,
    runId,
    round: totalRounds,
    convergenceHistory,
    currentBestF1: bestF1,
    isFinalRound: true,
    winningHypothesis:
      leadingHypoId != null ? { hypoId: leadingHypoId, statement: winningStatement } : undefined,
    modelConfig,
  })

  if (finalPrometheus.mhdConfig) {
    mhdConfigPath = finalPrometheus.mhdConfig.cfgPath
    observationProposal = finalPrometheus.mhdConfig.observationProposal
  }

  return {
    runId,
    winningHypoId: leadingHypoId ?? '',
    bestF1,
    totalRounds,
    mhdConfigPath,
    observationProposal,
  }
}

// Re-export getWritable + ModelCallStreamPart typing for callers that want to
// stream the Sisyphus agent (used by the Phase 4 API layer when wiring the
// human-in-the-loop approval node). Not used by tournamentWorkflow itself.
export { getWritable, type ModelCallStreamPart }
