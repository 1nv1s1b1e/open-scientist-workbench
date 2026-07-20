import { createModelCallToUIChunkTransform } from '@ai-sdk/workflow'
import { tournamentWorkflow } from '@open-scientist/agents'
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
  getRun,
  updateRunStatus,
} from '@open-scientist/storage'
import { createUIMessageStreamResponse } from 'ai'
import { Hono } from 'hono'
import { getRun as getWorkflowRun, start } from 'workflow/api'

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
 * `settings.agents[role]`. The whole map is plain-serializable and crosses
 * the workflow structured-clone boundary intact.
 *
 * If `modelAlias` is supplied it overrides the `sisyphus` role's modelConfig
 * only (sub-agents still resolve via `settings.models[role]`); this mirrors
 * the single-model `resolveRunModelArg` behaviour for backward compat.
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
 * Starts `tournamentWorkflow` via `start()` (returns a `Run` once the run is
 * registered, without awaiting its completion), persists a `runs` row keyed by
 * the SDK run id, and returns an SSE stream of `UIMessageChunk`s flattened from
 * the parent run's event log. The `x-workflow-run-id` response header carries
 * the SDK run id for client-side reconnection.
 */
runs.post('/api/projects/:name/runs', async (c) => {
  const projectName = c.req.param('name')
  const body = await c.req.json().catch(() => ({}))
  const seed = body?.seed
  if (typeof seed !== 'string' || seed.length === 0) {
    return c.json({ error: 'bad_request', message: 'body.seed is required' }, 400)
  }
  const modelAlias =
    typeof body?.modelAlias === 'string' && body.modelAlias.length > 0 ? body.modelAlias : undefined

  const project = await getProject(projectName)
  if (!project) {
    return c.json({ error: 'not_found', message: `Project "${projectName}" not found` }, 404)
  }

  let modelConfig: ModelArg
  let agentConfigs: Record<string, AgentRuntimeConfig>
  try {
    modelConfig = await resolveRunModelArg(projectName, modelAlias)
    agentConfigs = await resolveRunAgentConfigs(projectName, modelAlias)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Unknown alias is a client error (400); missing model config / credential
    // is a server misconfiguration (500).
    const status = err instanceof ModelAliasNotFoundError ? 400 : 500
    const error = err instanceof ModelAliasNotFoundError ? 'bad_request' : 'model_config_error'
    return c.json({ error, message }, status)
  }

  const run = await start(tournamentWorkflow, [
    {
      seed,
      // The workflow's `projectId` is the project name/slug — it drives the
      // workspace dir + HelixDB scoping via getProjectDir(name).
      projectId: projectName,
      // A business-level run label threaded through runtimeContext for the
      // workflow's snapshot persistence (snapshot.json `runId` field). This is
      // distinct from the SDK `run.runId` (returned below in the
      // `x-workflow-run-id` header) which is the transport-level id used for
      // streaming / cancel / SQLite `runs.id`. Keeping the two separate avoids
      // a chicken-and-egg: the SDK run id only exists *after* start(), but the
      // workflow body needs a runId at invocation time.
      runId: `run-${Date.now()}`,
      // Default model — kept for backward compat (sub-agents without an
      // explicit agentConfigs entry fall back to this).
      modelConfig,
      // Per-agent runtime config map: each role gets its own resolved
      // modelConfig + any non-model overrides (instructions / skillDirectories
      // / mcpServers) configured under settings.agents[role]. See
      // resolveRunAgentConfigs.
      agentConfigs,
    },
  ])

  // Persist a runs row keyed by the SDK run id so GET /stream + POST /stop can
  // look it up by the same id the client received in the response header.
  // project.id is the projects-table UUID (foreign reference).
  await createRun(projectName, project.id, { id: run.runId, status: 'running' })

  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { 'x-workflow-run-id': run.runId },
  })
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

  const run = getWorkflowRun(runId)
  const headers: Record<string, string> = { 'x-workflow-run-id': runId }

  if (startIndex < 0) {
    const tailIndex = await run.getReadable().getTailIndex()
    headers['x-workflow-stream-tail-index'] = String(tailIndex)
  }

  const readable = run.getReadable({ startIndex })
  return createUIMessageStreamResponse({
    stream: readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers,
  })
})

/**
 * GET /api/projects/:name/runs/:runId — fetch a run's persisted status.
 *
 * Reads the `runs` row from the project db. The body mirrors the row plus the
 * SDK run id for client convenience.
 */
runs.get('/api/projects/:name/runs/:runId', async (c) => {
  const projectName = c.req.param('name')
  const runId = c.req.param('runId')
  const row = await getRun(projectName, runId)
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
 * POST /api/projects/:name/runs/:runId/stop — cancel a running workflow.
 *
 * Cancels the SDK run (signals the workflow runtime to stop) and marks the
 * SQLite row as `stopped` (which also sets `endedAt`).
 */
runs.post('/api/projects/:name/runs/:runId/stop', async (c) => {
  const projectName = c.req.param('name')
  const runId = c.req.param('runId')

  const row = await getRun(projectName, runId)
  if (!row) {
    return c.json(
      { error: 'not_found', message: `Run "${runId}" not found in project "${projectName}"` },
      404,
    )
  }

  const run = getWorkflowRun(runId)
  await run.cancel()
  await updateRunStatus(projectName, runId, 'stopped')
  return c.json({ ok: true, runId, status: 'stopped' })
})
