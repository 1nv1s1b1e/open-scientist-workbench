import { randomUUID } from 'node:crypto'
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
import { StartRunRequestSchema } from '@open-scientist/schema'
import { Hono } from 'hono'

import { attachRunCompletion, respondWithRunStream } from '../lib/run-helpers'
import { getRun as getRegistryRun, start as startRun } from '../lib/run-stream'

export const runs = new Hono()

/**
 * Resolve the serializable {@link ModelArg} for a tournament run.
 *
 * Delegates to {@link resolveModelArg} (config package), which reads settings
 * → ModelConfig (carrying `credentialId`) → CredentialStore.get(credentialId)
 * → full endpoint bundle `{provider, apiKey, baseURL?}`.
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
 * with fallback `default` → `sisyphus`) plus any non-model overrides
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
 * POST /api/projects/:name/runs — start a tournament run.
 *
 * Body: `{ seed: string, modelAlias?: string }`.
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
      { error: 'bad_request', message: parsedBody.error.issues[0]?.message ?? 'Invalid run request' },
      400,
    )
  }
  const { seed, phenomenon, maxRounds } = parsedBody.data
  const localGrounded = parsedBody.data.executionMode === 'local-grounded' && Boolean(phenomenon)
  const runSeed = seed ?? phenomenon?.requestedQuestion ?? phenomenon?.title ?? 'structured-phenomenon'
  const modelAlias = parsedBody.data.modelAlias

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

  const run = startRun({
    seed: runSeed,
    ...(phenomenon ? { phenomenon } : {}),
    ...(maxRounds !== undefined ? { maxRounds } : {}),
    // The workflow's `projectId` is the project name/slug — it drives the
    ...(localGrounded ? { localGrounded: true } : {}),
    // workspace dir + HelixDB scoping via getProjectDir(name).
    projectId: projectName,
    // A business-level run label threaded through runtimeContext for the
    // workflow's snapshot persistence (snapshot.json `runId` field). This is
    // the same id used as the transport-level `x-workflow-run-id` (returned
    // below) since we no longer have an SDK run id distinct from the
    // business run id — the RunRegistry keys runs by this label directly.
    // Suffix a short random UUID to avoid same-millisecond collisions when
    // two POST /runs land in the same Date.now() tick.
    runId: `run-${Date.now()}-${randomUUID().slice(0, 8)}`,
    // Default model — sub-agents without an explicit agentConfigs entry
    // fall back to this.
    modelConfig,
    // Per-agent runtime config map: each role gets its own resolved
    // modelConfig + any non-model overrides (instructions / skillDirectories
    // / mcpServers) configured under settings.agents[role]. See
    // resolveRunAgentConfigs.
    agentConfigs,
  })

  // Persist a runs row keyed by the run id so GET /stream + POST /stop can
  // look it up by the same id the client received in the response header.
  // project.id is the projects-table UUID (foreign reference).
  await createRun(projectName, project.id, { id: run.runId, status: 'running' })

  attachRunCompletion(projectName, run)

  return respondWithRunStream(c, run, 0)
})

/**
 * GET /api/projects/:name/runs/:runId/stream — reconnect to a run's event stream.
 *
 * Query: `startIndex` (integer, default 0; negative = tail-relative, e.g. -3
 * reads the last 3 chunks). When `startIndex < 0`, the response carries an
 * `x-workflow-stream-tail-index` header with the absolute tail index so the
 * client can reconcile its local cursor.
 *
 * The project name is in the path (rather than reverse-looked-up from the run
 * id) to avoid scanning every project db — the client already knows it.
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
 * GET /api/projects/:name/runs/:runId — fetch a run's persisted status.
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
  })
})

/**
 * GET /api/projects/:name/runs/:runId/chunks — fetch all persisted chunks for a run.
 *
 * Returns an array of `{ seq, chunk }` objects (chunk = parsed UIMessageChunk).
 * Used by the frontend to restore message history after page refresh.
 */
runs.get('/api/projects/:name/runs/:runId/chunks', async (c) => {
  const projectName = c.req.param('name')
  const runId = c.req.param('runId')
  const rows = await getRunChunks(projectName, runId)
  return c.json(rows.map((r) => ({ seq: r.seq, chunk: JSON.parse(r.chunkJson) as unknown })))
})

/**
 * GET /api/projects/:name/runs — list all runs for a project.
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
      })),
  )
})

/**
 * POST /api/projects/:name/runs/:runId/stop — cancel a running workflow.
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

  const run = getRegistryRun(runId)
  if (run) {
    await run.cancel()
  }
  await updateRunStatus(projectName, runId, 'stopped')
  return c.json({ ok: true, runId, status: 'stopped' })
})

/**
 * POST /api/projects/:name/runs/:runId/resume — resume a crashed run from its
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
 * Returns the same SSE stream shape as POST `/runs` — the client can treat
 * the resumed run identically (same `x-workflow-run-id` header, same
 * `/stream` reconnect endpoint).
 *
 * 404 if the run has no snapshots (e.g. it crashed before completing Round 1).
 */
runs.post('/api/projects/:name/runs/:runId/resume', async (c) => {
  const projectName = c.req.param('name')
  const runId = c.req.param('runId')
  const body = await c.req.json().catch(() => ({}))
  const modelAlias =
    typeof body?.modelAlias === 'string' && body.modelAlias.length > 0 ? body.modelAlias : undefined
  // seed is optional on resume — only used for display, not passed to Librarian.
  const seed = typeof body?.seed === 'string' ? body.seed : '(resumed)'

  const project = await getProject(projectName)
  if (!project) {
    return c.json({ error: 'not_found', message: `Project "${projectName}" not found` }, 404)
  }

  // Scientific resume is explicit and reads the LangGraph checkpoint. The
  // legacy snapshot recovery path below remains unchanged.
  if (body?.scientific === true) {
    let modelConfig: ModelArg
    let agentConfigs: Record<string, AgentRuntimeConfig>
    try {
      modelConfig = await resolveRunModelArg(projectName, modelAlias)
      agentConfigs = await resolveRunAgentConfigs(projectName, modelAlias)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const status = err instanceof ModelAliasNotFoundError ? 400 : 500
      const error = err instanceof ModelAliasNotFoundError ? 'bad_request' : 'model_config_error'
      return c.json({ error, message }, status)
    }

    const run = startRun({
      seed: '(scientific-resumed)',
      projectId: projectName,
      runId,
      modelConfig,
      agentConfigs,
      scientificResume: true,
    })
    await updateRunStatus(projectName, runId, 'running')
    attachRunCompletion(projectName, run)
    return respondWithRunStream(c, run, 0)
  }

  // Find the latest snapshot for this run.
  const snapshot = await readLatestSnapshot(projectName, runId)
  if (!snapshot) {
    return c.json(
      {
        error: 'not_found',
        message: `No snapshot found for run "${runId}" — cannot resume (the run may have crashed before completing Round 1)`,
      },
      404,
    )
  }

  let modelConfig: ModelArg
  let agentConfigs: Record<string, AgentRuntimeConfig>
  try {
    modelConfig = await resolveRunModelArg(projectName, modelAlias)
    agentConfigs = await resolveRunAgentConfigs(projectName, modelAlias)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = err instanceof ModelAliasNotFoundError ? 400 : 500
    const error = err instanceof ModelAliasNotFoundError ? 'bad_request' : 'model_config_error'
    return c.json({ error, message }, status)
  }

  const run = startRun({
    seed,
    projectId: projectName,
    runId,
    modelConfig,
    agentConfigs,
    resumeFrom: snapshot,
  })

  // Update the SQLite row back to 'running' (it may have been 'stopped' or
  // stuck in 'running' from the crash).
  await updateRunStatus(projectName, runId, 'running')

  attachRunCompletion(projectName, run)

  return respondWithRunStream(c, run, 0)
})
