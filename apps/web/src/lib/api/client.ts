/**
 * 后端 REST API 客户端 — 所有 fetch 调用集中于此。
 *
 * 契约来源：apps/api/src/routes/ 实际实现（非设计期 spec）。
 * 基础路径 /api 由 Next.js rewrites 代理到 apps/api，浏览器同源，无需 CORS。
 *
 * 错误处理：后端统一 envelope `{ error: string, message: string }`，
 * 4xx/5xx 抛 ApiError。SSE 流端点返回 Response 供上层自行消费。
 */

import type {
  CreateProjectRequest,
  CredentialResponse,
  GlobalSettings,
  ModelConfig,
  TestLlmRequest,
  TestLlmResponse,
} from '@open-scientist/schema'

/** 后端统一错误 envelope */
export interface ApiErrorBody {
  error: string
  message: string
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/**
 * SSE streaming endpoints must bypass the Next.js rewrite proxy, which buffers
 * the entire response (breaking live streaming). In dev, point directly to the
 * API server. In prod, a reverse proxy should handle /api/* without buffering.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? ''

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null
  try {
    body = (await res.json()) as ApiErrorBody
  } catch {
    // 非 JSON 响应（如 SSE 端点返回错误），用 statusText 兜底
  }
  return new ApiError(res.status, body?.error ?? 'unknown_error', body?.message ?? res.statusText)
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// 1. Health
// ---------------------------------------------------------------------------

export async function getHealth(
  fetchFn: typeof fetch = fetch,
): Promise<{ status: string; timestamp: string; baseDir: string }> {
  return jsonOrThrow(await fetchFn('/api/health'))
}

// ---------------------------------------------------------------------------
// 2. Settings (global)
// ---------------------------------------------------------------------------

export async function getGlobalSettings(fetchFn: typeof fetch = fetch): Promise<GlobalSettings> {
  return jsonOrThrow(await fetchFn('/api/settings'))
}

export async function putGlobalSettings(
  body: GlobalSettings,
  fetchFn: typeof fetch = fetch,
): Promise<GlobalSettings> {
  return jsonOrThrow(
    await fetchFn('/api/settings', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  )
}

export async function patchGlobalSettings(
  body: Partial<GlobalSettings>,
  fetchFn: typeof fetch = fetch,
): Promise<GlobalSettings> {
  return jsonOrThrow(
    await fetchFn('/api/settings', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  )
}

// --- per-role model config ---

export async function getModelConfig(
  role: string,
  fetchFn: typeof fetch = fetch,
): Promise<ModelConfig> {
  return jsonOrThrow(await fetchFn(`/api/settings/models/${encodeURIComponent(role)}`))
}

export async function putModelConfig(
  role: string,
  body: ModelConfig,
  fetchFn: typeof fetch = fetch,
): Promise<ModelConfig> {
  return jsonOrThrow(
    await fetchFn(`/api/settings/models/${encodeURIComponent(role)}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  )
}

export async function deleteModelConfig(
  role: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true }> {
  return jsonOrThrow(
    await fetchFn(`/api/settings/models/${encodeURIComponent(role)}`, { method: 'DELETE' }),
  )
}

// --- model aliases ---

export async function listModelAliases(
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, ModelConfig>> {
  return jsonOrThrow(await fetchFn('/api/settings/model-aliases'))
}

export async function putModelAlias(
  alias: string,
  body: ModelConfig,
  fetchFn: typeof fetch = fetch,
): Promise<ModelConfig> {
  return jsonOrThrow(
    await fetchFn(`/api/settings/model-aliases/${encodeURIComponent(alias)}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  )
}

export async function deleteModelAlias(
  alias: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true }> {
  return jsonOrThrow(
    await fetchFn(`/api/settings/model-aliases/${encodeURIComponent(alias)}`, { method: 'DELETE' }),
  )
}

// ---------------------------------------------------------------------------
// 3. Project settings
// ---------------------------------------------------------------------------

export interface ProjectSettings {
  models?: Record<string, ModelConfig>
  modelAliases?: Record<string, ModelConfig>
  tournament?: GlobalSettings['tournament']
  concurrency?: GlobalSettings['concurrency']
  steering?: GlobalSettings['steering']
  mcp?: { servers: unknown[] }
  skills?: { directories: string[] }
  prompts?: { dir: string }
}

export async function getProjectSettings(
  project: string,
  fetchFn: typeof fetch = fetch,
): Promise<ProjectSettings> {
  return jsonOrThrow(await fetchFn(`/api/projects/${encodeURIComponent(project)}/settings`))
}

export async function patchProjectSettings(
  project: string,
  body: Partial<ProjectSettings>,
  fetchFn: typeof fetch = fetch,
): Promise<ProjectSettings> {
  return jsonOrThrow(
    await fetchFn(`/api/projects/${encodeURIComponent(project)}/settings`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  )
}

// ---------------------------------------------------------------------------
// 4. Credentials
// ---------------------------------------------------------------------------

export interface AddCredentialRequest {
  id?: string
  provider: string
  type?: 'api-key' | 'oauth-token'
  key: string
  baseURL?: string
  metadata?: Record<string, unknown>
}

export async function listCredentials(
  fetchFn: typeof fetch = fetch,
): Promise<CredentialResponse[]> {
  return jsonOrThrow(await fetchFn('/api/credentials'))
}

export async function addCredential(
  body: AddCredentialRequest,
  fetchFn: typeof fetch = fetch,
): Promise<CredentialResponse> {
  const res = await fetchFn('/api/credentials', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
  if (!res.ok && res.status !== 201) throw await parseError(res)
  return (await res.json()) as CredentialResponse
}

export async function deleteCredential(
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true }> {
  return jsonOrThrow(
    await fetchFn(`/api/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  )
}

// ---------------------------------------------------------------------------
// 5. Projects
// ---------------------------------------------------------------------------

export interface ProjectListItem {
  name: string
  createdAt: null
}

export interface ProjectDetail {
  id: string
  name: string
  createdAt: string
  config: Record<string, unknown> | null
}

export async function listProjects(fetchFn: typeof fetch = fetch): Promise<ProjectListItem[]> {
  return jsonOrThrow(await fetchFn('/api/projects'))
}

export async function createProject(
  body: CreateProjectRequest,
  fetchFn: typeof fetch = fetch,
): Promise<ProjectDetail> {
  const res = await fetchFn('/api/projects', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
  if (!res.ok && res.status !== 201) throw await parseError(res)
  return (await res.json()) as ProjectDetail
}

export async function getProject(
  name: string,
  fetchFn: typeof fetch = fetch,
): Promise<ProjectDetail> {
  return jsonOrThrow(await fetchFn(`/api/projects/${encodeURIComponent(name)}`))
}

export async function deleteProject(
  name: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true }> {
  return jsonOrThrow(
    await fetchFn(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  )
}

// ---------------------------------------------------------------------------
// 6. Test LLM
// ---------------------------------------------------------------------------

export async function testLlm(
  body: TestLlmRequest,
  fetchFn: typeof fetch = fetch,
): Promise<TestLlmResponse> {
  return jsonOrThrow(
    await fetchFn('/api/test-llm', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  )
}

// ---------------------------------------------------------------------------
// 7. Runs (Tournament Workflow)
// ---------------------------------------------------------------------------

export type RunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'stopped'

export interface RunStatusResponse {
  runId: string
  projectId: string
  status: RunStatus
  startedAt: string
  endedAt: string | null
  currentRound: number
  bestF1: number
}

export interface StartRunRequest {
  seed: string
  modelAlias?: string
}

/**
 * POST /api/projects/:name/runs
 *
 * 启动 tournament run。返回 SSE 流 Response（Content-Type: text/event-stream），
 * header 携带 x-workflow-run-id。调用方需：
 *   1. 读取 res.headers.get('x-workflow-run-id') 保存 runId
 *   2. 消费 res.body（ReadableStream<Uint8Array>）解析 SSE chunks
 *   3. 流结束发送 [DONE]
 *
 * 不抛 ApiError 之外的异常；4xx/5xx 由 parseError 处理。
 */
export async function startRun(
  project: string,
  body: StartRunRequest,
  fetchFn: typeof fetch = fetch,
): Promise<{ response: Response; runId: string }> {
  const res = await fetchFn(`${API_BASE}/api/projects/${encodeURIComponent(project)}/runs`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await parseError(res)

  const runId = res.headers.get('x-workflow-run-id')
  if (!runId) {
    throw new ApiError(500, 'missing_run_id', 'Response missing x-workflow-run-id header')
  }
  return { response: res, runId }
}

/**
 * GET /api/projects/:name/runs/:runId/stream?startIndex=N
 *
 * 断线重连。startIndex 负数 = tail-relative。
 * 响应 header：
 *   - x-workflow-run-id: 始终返回（echo path param）
 *   - x-workflow-stream-tail-index: 仅当 startIndex < 0 时返回（绝对 tail index）
 */
export async function reconnectRunStream(
  project: string,
  runId: string,
  startIndex: number = 0,
  fetchFn: typeof fetch = fetch,
): Promise<{ response: Response; tailIndex: number | null }> {
  const res = await fetchFn(
    `${API_BASE}/api/projects/${encodeURIComponent(project)}/runs/${encodeURIComponent(runId)}/stream?startIndex=${startIndex}`,
  )
  if (!res.ok) throw await parseError(res)

  const tailIndexHeader = res.headers.get('x-workflow-stream-tail-index')
  const tailIndex = tailIndexHeader != null ? Number.parseInt(tailIndexHeader, 10) : null
  return { response: res, tailIndex }
}

export async function getRunStatus(
  project: string,
  runId: string,
  fetchFn: typeof fetch = fetch,
): Promise<RunStatusResponse> {
  return jsonOrThrow(
    await fetchFn(`/api/projects/${encodeURIComponent(project)}/runs/${encodeURIComponent(runId)}`),
  )
}

export async function stopRun(
  project: string,
  runId: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; runId: string; status: 'stopped' }> {
  return jsonOrThrow(
    await fetchFn(
      `/api/projects/${encodeURIComponent(project)}/runs/${encodeURIComponent(runId)}/stop`,
      {
        method: 'POST',
      },
    ),
  )
}

// ---------------------------------------------------------------------------
// 聚合导出（便于 TanStack Query 的 queryFn 引用）
// ---------------------------------------------------------------------------

export const api = {
  getHealth,
  // settings
  getGlobalSettings,
  putGlobalSettings,
  patchGlobalSettings,
  getModelConfig,
  putModelConfig,
  deleteModelConfig,
  listModelAliases,
  putModelAlias,
  deleteModelAlias,
  getProjectSettings,
  patchProjectSettings,
  // credentials
  listCredentials,
  addCredential,
  deleteCredential,
  // projects
  listProjects,
  createProject,
  getProject,
  deleteProject,
  // test llm
  testLlm,
  // runs
  startRun,
  reconnectRunStream,
  getRunStatus,
  stopRun,
}

export type Api = typeof api
