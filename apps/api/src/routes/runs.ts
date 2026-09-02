import { createHash, randomUUID } from 'node:crypto'
import { readLatestSnapshot } from '@open-scientist/agents'
import {
  type AgentRuntimeConfig,
  ModelAliasNotFoundError,
  type ModelArg,
  resolveAgentConfigs,
  resolveModelArg,
} from '@open-scientist/config'
import {
  createCredentialStore,
  createRun,
  getProject,
  getRun as getStorageRun,
  getRunChunks,
  listRuns,
  updateRunStatus,
} from '@open-scientist/storage'
import {
  ResumeRunRequestSchema,
  StartRunRequestSchema,
  SteerRequestSchema,
  ApproveRequestSchema,
} from '@open-scientist/schema'
import { Hono, type Context } from 'hono'

import { attachRunCompletion, respondWithRunStream } from '../lib/run-helpers'
import { getRunHumanControl } from '../lib/run-control'
import { getRun as getRegistryRun, start as startRun } from '../lib/run-stream'

export const runs = new Hono()

function parseStoredJson(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function withCanonicalInputDigest<T extends { inputDigest?: string }>(
  value: T,
): T & {
  inputDigest: string
} {
  const { inputDigest: _claimedDigest, ...canonical } = value
  return {
    ...value,
    inputDigest: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
  }
}

/**
 * Resolve the serializable {@link ModelArg} for a tournament run.
 *
 * Delegates to {@link resolveModelArg} (config package), which reads settings
 * 鈫?ModelConfig (carrying `credentialId`) 鈫?CredentialStore.get(credentialId)
 * 鈫?full endpoint bundle `{provider, apiKey, baseURL?}`.
 *
 * "Same provider, different url+key" is two distinct credential rows.
 */
async function resolveRunModelArg(projectName: string, modelAlias?: string): Promise<ModelArg> {
  const credentials = await createCredentialStore()
  return resolveModelArg(projectName, credentials, {
    role: 'sisyphus',
    ...(modelAlias ? { modelAlias } : {}),
  })
}

/**
 * Resolve the per-agent runtime config map for every tournament agent role.
 *
 * Returns a `Record<AgentRole, AgentRuntimeConfig>` keyed by role name. Each
 * entry carries its own resolved `modelConfig` (from `settings.models[role]`
 * with fallback `default` 鈫?`sisyphus`) plus any non-model overrides
 * (`instructions` / `skillDirectories` / `mcpServers`) configured under
 * `settings.agents[role]`.
 *
 * If `modelAlias` is supplied it overrides the `sisyphus` role's modelConfig
 * only (sub-agents still resolve via `settings.models[role]`).
 */
async function resolveRunAgentConfigs(
  projectName: string,
  modelAlias?: string,
): Promise<Record<string, AgentRuntimeConfig>> {
  const credentials = await createCredentialStore()
  const configs = await resolveAgentConfigs(projectName, credentials)
  if (modelAlias) {
    // resolveModelArg with modelAlias throws ModelAliasNotFoundError if absent.
    const sisyphusModel = await resolveModelArg(projectName, credentials, { modelAlias })
    configs.sisyphus = { ...configs.sisyphus, modelConfig: sisyphusModel }
  }
  return configs
}

/**
 * POST /api/projects/:name/runs 鈥?start a run.
 *
 * Body: `{ phenomenon?: ScientificPhenomenon, seed?: string, modelAlias?: string }`.
 * A `phenomenon` payload routes to the current `scientificLoopWorkflow`; a
 * bare `seed` (no phenomenon) routes to the archived `tournamentWorkflow`
 * (legacy compatibility path).
 *
 * When `modelAlias` is provided, the model config is resolved from
 * `settings.modelAliases[alias]` (400 if not found); otherwise it falls back
 * to `settings.models.sisyphus ?? settings.models.default`.
 *
 * Starts `tournamentWorkflow` via the in-memory `RunRegistry` (returns a
 * `Run` once the run is registered, without awaiting its completion),
 * persists a `runs` row keyed by the run id, and returns an SSE stream of
 * `UIMessageChunk`s flattened from the parent run's event log. The
 * `x-workflow-run-id` response header carries the run id for client-side
 * reconnection.
 */
runs.post('/api/projects/:name/runs', async (c) => {
  const projectName = c.req.param('name')
  const body = await c.req.json().catch(() => ({}))
  const parsedBody = StartRunRequestSchema.safeParse(body)
  if (!parsedBody.success) {
    return c.json(
      {
        error: 'bad_request',
        message: parsedBody.error.issues[0]?.message ?? 'Invalid run request',
      },
      400,
    )
  }
  const { seed, phenomenon, maxRounds } = parsedBody.data
  const scientificPhenomenon = phenomenon ? withCanonicalInputDigest(phenomenon) : undefined
  const localGrounded = parsedBody.data.executionMode === 'local-grounded' && Boolean(phenomenon)
  const runSeed =
    seed ?? phenomenon?.requestedQuestion ?? phenomenon?.title ?? 'structured-phenomenon'
  const modelAlias = parsedBody.data.modelAlias
  const humanGate = parsedBody.data.humanGate
  const humanGateTimeoutMs = parsedBody.data.humanGateTimeoutMs

  const project = await getProject(projectName)
  if (!project) {
    return c.json({ error: 'not_found', message: `Project "${projectName}" not found` }, 404)
  }

  let modelConfig: ModelArg
  let agentConfigs: Record<string, AgentRuntimeConfig>
  if (localGrounded) {
    modelConfig = {
      provider: 'openai',
      model: 'local-grounded',
      thinkingLevel: 'off',
      apiMode: 'chat',
      apiKey: '',
    }
    agentConfigs = {}
  } else {
    try {
      modelConfig = await resolveRunModelArg(projectName, modelAlias)
      agentConfigs = await resolveRunAgentConfigs(projectName, modelAlias)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const status = err instanceof ModelAliasNotFoundError ? 400 : 500
      const error = err instanceof ModelAliasNotFoundError ? 'bad_request' : 'model_config_error'
      return c.json({ error, message }, status)
    }
  }

  const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`
  const workflowType = phenomenon ? ('scientific-loop' as const) : ('tournament' as const)
  await createRun(projectName, project.id, {
    id: runId,
    status: 'pending',
    workflowType,
    config: {
      workflowType,
      executionMode: localGrounded ? 'local-grounded' : 'model-assisted',
      ...(maxRounds !== undefined ? { maxRounds } : {}),
      ...(modelAlias ? { modelAlias } : {}),
      humanGate,
      ...(humanGateTimeoutMs !== undefined ? { humanGateTimeoutMs } : {}),
      provider: modelConfig.provider,
      model: modelConfig.model,
      apiMode: modelConfig.apiMode,
      thinkingLevel: modelConfig.thinkingLevel,
      ...(scientificPhenomenon ? { inputDigest: scientificPhenomenon.inputDigest } : {}),
    },
  })

  let run: ReturnType<typeof startRun>
  try {
    run = startRun({
      seed: runSeed,
      ...(scientificPhenomenon ? { phenomenon: scientificPhenomenon } : {}),
      ...(maxRounds !== undefined ? { maxRounds } : {}),
      // The workflow's `projectId` is the project name/slug 鈥?it drives the
      ...(localGrounded ? { localGrounded: true } : {}),
      // workspace dir + HelixDB scoping via getProjectDir(name).
      projectId: projectName,
      // A business-level run label threaded through runtimeContext for the
      // workflow's snapshot persistence (snapshot.json `runId` field). This is
      // the same id used as the transport-level `x-workflow-run-id` (returned
      // below) since we no longer have an SDK run id distinct from the
      // business run id 鈥?the RunRegistry keys runs by this label directly.
      // Suffix a short random UUID to avoid same-millisecond collisions when
      // two POST /runs land in the same Date.now() tick.
      runId,
      // Default model 鈥?sub-agents without an explicit agentConfigs entry
      // fall back to this.
      modelConfig,
      // Per-agent runtime config map: each role gets its own resolved
      // modelConfig + any non-model overrides (instructions / skillDirectories
      // / mcpServers) configured under settings.agents[role]. See
      // resolveRunAgentConfigs.
      agentConfigs,
      // Human-in-the-loop config: `off` (default) keeps the loop fully
      // automatic; `plan_review` arms the D.route approval gate.
      humanGate,
      ...(humanGateTimeoutMs !== undefined ? { humanGateTimeoutMs } : {}),
    })
    await updateRunStatus(projectName, runId, 'running')
  } catch (error) {
    await updateRunStatus(projectName, runId, 'failed')
    return c.json(
      {
        error: 'run_start_failed',
        message: error instanceof Error ? error.message : String(error),
        runId,
      },
      500,
    )
  }

  attachRunCompletion(projectName, run)

  return respondWithRunStream(c, run, 0)
})

/**
 * GET /api/projects/:name/runs/:runId/stream 鈥?reconnect to a run's event stream.
 *
 * Query: `startIndex` (integer, default 0; negative = tail-relative, e.g. -3
 * reads the last 3 chunks). When `startIndex < 0`, the response carries an
 * `x-workflow-stream-tail-index` header with the absolute tail index so the
 * client can reconcile its local cursor.
 *
 * The project name is in the path (rather than reverse-looked-up from the run
 * id) to avoid scanning every project db 鈥?the client already knows it.
 */
runs.get('/api/projects/:name/runs/:runId/stream', async (c) => {
  const runId = c.req.param('runId')
  const startIndexParam = c.req.query('startIndex')
  const startIndex = startIndexParam === undefined ? 0 : Number.parseInt(startIndexParam, 10)
  if (Number.isNaN(startIndex)) {
    return c.json({ error: 'bad_request', message: 'startIndex must be an integer' }, 400)
  }

  const run = getRegistryRun(runId)
  if (!run) {
    return c.json(
      { error: 'not_found', message: `Run "${runId}" not found or already completed` },
      404,
    )
  }

  return respondWithRunStream(c, run, startIndex)
})

/**
 * GET /api/projects/:name/runs/:runId 鈥?fetch a run's persisted status.
 *
 * Reads the `runs` row from the project db. The body mirrors the row plus the
 * run id for client convenience.
 */
runs.get('/api/projects/:name/runs/:runId', async (c) => {
  const projectName = c.req.param('name')
  const runId = c.req.param('runId')
  const row = await getStorageRun(projectName, runId)
  if (!row) {
    return c.json(
      { error: 'not_found', message: `Run "${runId}" not found in project "${projectName}"` },
      404,
    )
  }
  return c.json({
    runId: row.id,
    projectId: row.projectId,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    currentRound: row.currentRound,
    bestF1: row.bestF1,
    workflowType: row.workflowType,
    scientificStatus: row.scientificStatus,
    terminationReason: row.terminationReason,
    config: parseStoredJson(row.configJson),
    result: parseStoredJson(row.resultJson),
  })
})

/**
 * GET /api/projects/:name/runs/:runId/chunks 鈥?fetch all persisted chunks for a run.
 *
 * Returns an array of `{ seq, chunk }` objects (chunk = parsed UIMessageChunk).
 * Used by the frontend to restore message history after page refresh.
 */
runs.get('/api/projects/:name/runs/:runId/chunks', async (c) => {
  const projectName = c.req.param('name')
  const runId = c.req.param('runId')
  const rows = await getRunChunks(projectName, runId)
  return c.json(
    rows.map((r) => {
      const chunk = parseStoredJson(r.chunkJson)
      return chunk === null ? { seq: r.seq, chunk: null, invalid: true } : { seq: r.seq, chunk }
    }),
  )
})

/**
 * GET /api/projects/:name/runs 鈥?list all runs for a project.
 */
runs.get('/api/projects/:name/runs', async (c) => {
  const projectName = c.req.param('name')
  const rows = await listRuns(projectName)
  return c.json(
    rows
      .slice()
      .reverse()
      .map((r) => ({
        runId: r.id,
        projectId: r.projectId,
        status: r.status,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        currentRound: r.currentRound,
        bestF1: r.bestF1,
        workflowType: r.workflowType,
        scientificStatus: r.scientificStatus,
        terminationReason: r.terminationReason,
      })),
  )
})

/**
 * POST /api/projects/:name/runs/:runId/stop 鈥?cancel a running workflow.
 *
 * Aborts the in-memory run (signals tool exec / LLM calls to stop) and marks
 * the SQLite row as `stopped` (which also sets `endedAt`).
 */
runs.post('/api/projects/:name/runs/:runId/stop', async (c) => {
  const projectName = c.req.param('name')
  const runId = c.req.param('runId')

  const row = await getStorageRun(projectName, runId)
  if (!row) {
    return c.json(
      { error: 'not_found', message: `Run "${runId}" not found in project "${projectName}"` },
      404,
    )
  }
  if (row.status === 'completed' || row.status === 'failed' || row.status === 'stopped') {
    return c.json(
      {
        error: 'conflict',
        message: `Run "${runId}" is already ${row.status}`,
      },
      409,
    )
  }

  const run = getRegistryRun(runId)
  if (run) {
    await run.cancel()
  }
  await updateRunStatus(projectName, runId, 'stopped')
  return c.json({ ok: true, runId, status: 'stopped' })
})

/**
 * POST /api/projects/:name/runs/:runId/resume 鈥?resume a crashed run from its
 * latest snapshot.
 *
 * Dev-mode crash recovery: after a `tsx watch` restart or process crash, an
 * in-flight tournament run is lost from the in-memory `RunRegistry`. This
 * endpoint reads the latest `rounds/<n>/snapshot.json` for the run and
 * restarts `tournamentWorkflow` from `snapshot.round + 1`, skipping Round 1
 * (Librarian) and restoring the hypotheses + convergence history from the
 * snapshot.
 *
 * Body: `{ seed?: string, modelAlias?: string }`. The `seed` is only needed
 * for display purposes (the resumed run doesn't call Librarian); `modelAlias`
 * resolves the model config the same way as POST `/runs`.
 *
 * Returns the same SSE stream shape as POST `/runs` 鈥?the client can treat
 * the resumed run identically (same `x-workflow-run-id` header, same
 * `/stream` reconnect endpoint).
 *
 * 404 if the run has no snapshots (e.g. it crashed before completing Round 1).
 */
runs.post('/api/projects/:name/runs/:runId/resume', async (c) => {
  const projectName = c.req.param('name')
  const runId = c.req.param('runId')
  const rawBody = await c.req.json().catch(() => ({}))
  const parsedBody = ResumeRunRequestSchema.safeParse(rawBody)
  if (!parsedBody.success) {
    return c.json(
      {
        error: 'bad_request',
        message: parsedBody.error.issues[0]?.message ?? 'Invalid resume request',
      },
      400,
    )
  }
  const body = parsedBody.data
  const modelAlias = body.modelAlias
  // seed is optional on resume 鈥?only used for display, not passed to Librarian.
  const seed = typeof body?.seed === 'string' ? body.seed : '(resumed)'

  const project = await getProject(projectName)
  if (!project) {
    return c.json({ error: 'not_found', message: `Project "${projectName}" not found` }, 404)
  }

  const storedRun = await getStorageRun(projectName, runId)
  if (!storedRun) {
    return c.json({ error: 'not_found', message: `Run "${runId}" not found` }, 404)
  }
  if (getRegistryRun(runId)) {
    return c.json({ error: 'conflict', message: `Run "${runId}" is already active` }, 409)
  }
  if (storedRun.status === 'completed') {
    return c.json({ error: 'conflict', message: `Run "${runId}" is already completed` }, 409)
  }

  const storedConfig = parseStoredJson(storedRun.configJson) as Record<string, unknown> | null
  const storedModelAlias =
    typeof storedConfig?.modelAlias === 'string' ? storedConfig.modelAlias : undefined
  if (modelAlias && storedModelAlias && modelAlias !== storedModelAlias) {
    return c.json(
      {
        error: 'conflict',
        message: 'Resume must use the model alias recorded for the original run',
      },
      409,
    )
  }
  const resolvedModelAlias = modelAlias ?? storedModelAlias

  // Scientific resume is explicit and reads the LangGraph checkpoint. The
  // legacy snapshot recovery path below remains unchanged.
  const scientificResume = body.scientific === true || storedRun.workflowType === 'scientific-loop'
  if (scientificResume) {
    let modelConfig: ModelArg
    let agentConfigs: Record<string, AgentRuntimeConfig>
    const localGrounded = storedConfig?.executionMode === 'local-grounded'
    if (localGrounded) {
      modelConfig = {
        provider: 'openai',
        model: 'local-grounded',
        thinkingLevel: 'off',
        apiMode: 'chat',
        apiKey: '',
      }
      agentConfigs = {}
    } else {
      try {
        modelConfig = await resolveRunModelArg(projectName, resolvedModelAlias)
        agentConfigs = await resolveRunAgentConfigs(projectName, resolvedModelAlias)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const status = err instanceof ModelAliasNotFoundError ? 400 : 500
        const error = err instanceof ModelAliasNotFoundError ? 'bad_request' : 'model_config_error'
        return c.json({ error, message }, status)
      }
    }

    await updateRunStatus(projectName, runId, 'running')
    let run: ReturnType<typeof startRun>
    try {
      run = startRun({
        seed: '(scientific-resumed)',
        projectId: projectName,
        runId,
        modelConfig,
        agentConfigs,
        ...(localGrounded ? { localGrounded: true } : {}),
        scientificResume: true,
        // Restore the human gate mode recorded for the original run.
        humanGate:
          storedConfig?.humanGate === 'plan_review' ? ('plan_review' as const) : ('off' as const),
        ...(typeof storedConfig?.humanGateTimeoutMs === 'number'
          ? { humanGateTimeoutMs: storedConfig.humanGateTimeoutMs }
          : {}),
      })
    } catch (error) {
      await updateRunStatus(projectName, runId, 'failed')
      return c.json(
        {
          error: 'resume_failed',
          message: error instanceof Error ? error.message : String(error),
        },
        500,
      )
    }
    attachRunCompletion(projectName, run)
    return respondWithRunStream(c, run, 0)
  }

  // Find the latest snapshot for this run.
  const snapshot = await readLatestSnapshot(projectName, runId)
  if (!snapshot) {
    return c.json(
      {
        error: 'not_found',
        message: `No snapshot found for run "${runId}" 鈥?cannot resume (the run may have crashed before completing Round 1)`,
      },
      404,
    )
  }

  let modelConfig: ModelArg
  let agentConfigs: Record<string, AgentRuntimeConfig>
  try {
    modelConfig = await resolveRunModelArg(projectName, resolvedModelAlias)
    agentConfigs = await resolveRunAgentConfigs(projectName, resolvedModelAlias)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = err instanceof ModelAliasNotFoundError ? 400 : 500
    const error = err instanceof ModelAliasNotFoundError ? 'bad_request' : 'model_config_error'
    return c.json({ error, message }, status)
  }

  // Update the SQLite row back to 'running' (it may have been 'stopped' or
  // stuck in 'running' from the crash).
  await updateRunStatus(projectName, runId, 'running')
  let run: ReturnType<typeof startRun>
  try {
    run = startRun({
      seed,
      projectId: projectName,
      runId,
      modelConfig,
      agentConfigs,
      resumeFrom: snapshot,
    })
  } catch (error) {
    await updateRunStatus(projectName, runId, 'failed')
    return c.json(
      {
        error: 'resume_failed',
        message: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }

  attachRunCompletion(projectName, run)

  return respondWithRunStream(c, run, 0)
})

/**
 * Human-in-the-loop control endpoints.
 *
 * These are opt-in interaction surfaces: a run started with the default
 * `humanGate: 'off'` reaches closure without any of them being called. When
 * used, they let a human pause between phases, inject advisory steering into
 * the next A-stage, or approve/reject the D.route continuation decision.
 * None of them can write evidence or alter a support/elimination gate verdict.
 */

/** Resolve the live human control for an active run, or an HTTP error. */
async function requireRunControl(
  c: Context,
  projectName: string,
  runId: string,
): Promise<ReturnType<typeof getRunHumanControl>> {
  const control = getRunHumanControl(runId)
  if (control) return control
  const row = await getStorageRun(projectName, runId)
  if (!row) {
    await c.json(
      { error: 'not_found', message: `Run "${runId}" not found in project "${projectName}"` },
      404,
    )
  } else {
    await c.json(
      {
        error: 'conflict',
        message: `Run "${runId}" is not active 鈥?human control ends when the run settles`,
      },
      409,
    )
  }
  return undefined
}

/** GET /api/projects/:name/runs/:runId/human 鈥?human control state. */
runs.get('/api/projects/:name/runs/:runId/human', async (c) => {
  const runId = c.req.param('runId')
  const control = getRunHumanControl(runId)
  if (!control) {
    return c.json({ error: 'not_found', message: `Run "${runId}" is not active` }, 404)
  }
  return c.json({
    runId,
    gateMode: control.gateMode,
    paused: control.isPaused(),
    pendingGate: control.pendingGateRequest() ?? null,
    gateDecisions: control.gateDecisions().length,
  })
})

/**
 * POST /api/projects/:name/runs/:runId/steer 鈥?queue an advisory steering or
 * follow-up message. It is drained at the next A.generate entry; the
 * model-assisted path may use it as emphasis, the local-grounded path records
 * it without consuming (deterministic generation stays reproducible).
 */
runs.post('/api/projects/:name/runs/:runId/steer', async (c) => {
  const control = await requireRunControl(c, c.req.param('name'), c.req.param('runId'))
  if (!control) return c.res
  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = SteerRequestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return c.json(
      {
        error: 'bad_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid steer request',
      },
      400,
    )
  }
  const message = control.steer(parsed.data.content, parsed.data.mode)
  return c.json({ ok: true, runId: control.runId, message })
})

/** POST /api/projects/:name/runs/:runId/pause 鈥?pause at the next node boundary. */
runs.post('/api/projects/:name/runs/:runId/pause', async (c) => {
  const control = await requireRunControl(c, c.req.param('name'), c.req.param('runId'))
  if (!control) return c.res
  control.pause()
  return c.json({ ok: true, runId: control.runId, paused: true })
})

/** POST /api/projects/:name/runs/:runId/unpause 鈥?release a pause. */
runs.post('/api/projects/:name/runs/:runId/unpause', async (c) => {
  const control = await requireRunControl(c, c.req.param('name'), c.req.param('runId'))
  if (!control) return c.res
  control.unpause()
  return c.json({ ok: true, runId: control.runId, paused: false })
})

/**
 * POST /api/projects/:name/runs/:runId/approve 鈥?answer the pending approval
 * gate (armed with `humanGate: 'plan_review'`). `approved: false` halts the
 * loop with `terminationReason: 'human_halted_at_plan_review'` 鈥?it records a
 * human decision, it does not fabricate or overwrite any scientific verdict.
 */
runs.post('/api/projects/:name/runs/:runId/approve', async (c) => {
  const control = await requireRunControl(c, c.req.param('name'), c.req.param('runId'))
  if (!control) return c.res
  const rawBody = await c.req.json().catch(() => ({}))
  const parsed = ApproveRequestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return c.json(
      {
        error: 'bad_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid approve request',
      },
      400,
    )
  }
  const decision = control.approve({
    approved: parsed.data.approved,
    ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
    ...(parsed.data.gateId !== undefined ? { gateId: parsed.data.gateId } : {}),
  })
  if (!decision) {
    return c.json(
      { error: 'conflict', message: `Run "${control.runId}" has no pending approval gate` },
      409,
    )
  }
  return c.json({ ok: true, runId: control.runId, decision })
})
