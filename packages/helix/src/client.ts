import { Client } from '@helix-db/helix-db'
import { env } from '@open-scientist/config'
import { createLogger } from '@open-scientist/logger'
import { queries } from './queries.ts'
import type {
  ConceptNode,
  CritiqueNode,
  EvidenceNode,
  HypothesisNode,
  PaperNode,
  SnapshotNode,
} from './types.ts'

const logger = createLogger('helix')

let _client: Client | null = null

export function getHelixClient(): Client {
  if (_client) return _client
  logger.info({ helixUrl: env.HELIX_URL }, 'getHelixClient: creating new Client singleton')
  _client = new Client(env.HELIX_URL)
  logger.info('getHelixClient: Client singleton created')
  return _client
}

export function setHelixClient(client: Client | null): void {
  _client = client
}

// ------------------------------------------------------------
// 批量查询返回的容器形状
// HelixDB read 查询返回 { <var>:{ properties: T[], ids?: number[] } }，
// 其中 properties 数组每项是投影后的属性对象（含 Expr.id() 投影出的 id 字段）。
// ------------------------------------------------------------

/** @internal */
export interface ReadContainer<T> {
  properties?: T[]
  ids?: number[]
}

interface PapersResult {
  papers: ReadContainer<PaperNode>
}
interface HypothesesResult {
  hypos: ReadContainer<HypothesisNode>
}
interface HypoResult {
  hypo: ReadContainer<HypothesisNode>
}
interface PaperResult {
  paper: ReadContainer<PaperNode>
}
interface ConceptsResult {
  concepts: ReadContainer<ConceptNode>
}
interface CritiquesResult {
  critiques: ReadContainer<CritiqueNode>
}
interface SnapshotResult {
  snapshot: ReadContainer<SnapshotNode>
}
interface EvidenceByHypoResult {
  support: ReadContainer<EvidenceNode>
  contradict: ReadContainer<EvidenceNode>
}
interface ConceptResult {
  concept: ReadContainer<ConceptNode>
}

// ------------------------------------------------------------
// 帮助函数
// ------------------------------------------------------------

/** @internal */
export function unwrap<T>(container: ReadContainer<T> | undefined): T[] {
  return container?.properties ?? []
}

/**
 * Safely convert a value to BigInt. Returns null for non-numeric strings
 * (e.g. "hypothesis-ac-phasemixing") that would cause BigInt() to throw.
 * @internal
 */
export function safeBigInt(v: string | number | bigint): bigint | null {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(v)
  const n = Number(v)
  if (Number.isFinite(n) && /^\d+$/.test(v.trim())) return BigInt(v.trim())
  return null
}

function first<T>(arr: T[] | undefined): T | null {
  return arr && arr.length > 0 ? arr[0]! : null
}

// ------------------------------------------------------------
// READ 封装
// ------------------------------------------------------------

export async function searchPapers(query: string, k = 10): Promise<PaperNode[]> {
  logger.info({ query, k }, 'searchPapers: sending query')
  const client = getHelixClient()
  const [titleRes, abstractRes] = await Promise.all([
    client
      .query<PapersResult>()
      .dynamic(queries.call.searchPapers({ queryText: query, k: BigInt(k) }))
      .send(),
    client
      .query<PapersResult>()
      .dynamic(queries.call.searchPapersByAbstract({ queryText: query, k: BigInt(k) }))
      .send(),
  ])
  const seen = new Set<number>()
  const papers: PaperNode[] = []
  for (const paper of [...unwrap(titleRes.papers), ...unwrap(abstractRes.papers)]) {
    if (seen.has(paper.id)) continue
    seen.add(paper.id)
    papers.push(paper)
    if (papers.length === k) break
  }
  logger.info({ query, k, count: papers.length }, 'searchPapers: query done')
  return papers
}

export async function searchHypotheses(query: string, k = 10): Promise<HypothesisNode[]> {
  logger.info({ query, k }, 'searchHypotheses: sending query')
  const res = await getHelixClient()
    .query<HypothesesResult>()
    .dynamic(queries.call.searchHypotheses({ queryText: query, k: BigInt(k) }))
    .send()
  const hypos = unwrap(res.hypos)
  logger.info({ query, k, count: hypos.length }, 'searchHypotheses: query done')
  return hypos
}

export async function getPaper(id: string | number | bigint): Promise<PaperNode | null> {
  const bid = safeBigInt(id)
  if (bid === null) return null
  const res = await getHelixClient()
    .query<PaperResult>()
    .dynamic(queries.call.getPaper({ id: bid }))
    .send()
  return first(unwrap(res.paper))
}

export async function getHypothesis(id: string | number | bigint): Promise<HypothesisNode | null> {
  const bid = safeBigInt(id)
  if (bid === null) return null
  const res = await getHelixClient()
    .query<HypoResult>()
    .dynamic(queries.call.getHypothesis({ id: bid }))
    .send()
  return first(unwrap(res.hypo))
}

export async function getEvidenceByHypothesis(
  hypoId: string | number | bigint,
): Promise<EvidenceNode[]> {
  const bid = safeBigInt(hypoId)
  if (bid === null) return []
  const res = await getHelixClient()
    .query<EvidenceByHypoResult>()
    .dynamic(queries.call.getEvidenceByHypothesis({ hypoId: bid }))
    .send()
  return [...unwrap(res.support), ...unwrap(res.contradict)]
}

export async function getCritiquesByHypothesis(
  hypoId: string | number | bigint,
): Promise<CritiqueNode[]> {
  const bid = safeBigInt(hypoId)
  if (bid === null) return []
  const res = await getHelixClient()
    .query<CritiquesResult>()
    .dynamic(queries.call.getCritiquesByHypothesis({ hypoId: bid }))
    .send()
  return unwrap(res.critiques)
}

export async function getRelatedConcepts(hypoId: string | number | bigint): Promise<ConceptNode[]> {
  const bid = safeBigInt(hypoId)
  if (bid === null) return []
  const res = await getHelixClient()
    .query<ConceptsResult>()
    .dynamic(queries.call.getRelatedConcepts({ hypoId: bid }))
    .send()
  return unwrap(res.concepts)
}

export async function getSnapshot(roundId: number): Promise<SnapshotNode | null> {
  const res = await getHelixClient()
    .query<SnapshotResult>()
    .dynamic(queries.call.getSnapshot({ roundId: BigInt(roundId) }))
    .send()
  return first(unwrap(res.snapshot))
}

export async function getHypothesesByRound(roundId: number): Promise<HypothesisNode[]> {
  const res = await getHelixClient()
    .query<HypothesesResult>()
    .dynamic(queries.call.getHypothesesByRound({ roundId: BigInt(roundId) }))
    .send()
  return unwrap(res.hypos)
}

export async function getEvolutionChain(
  hypoId: string | number | bigint,
): Promise<HypothesisNode[]> {
  const bid = safeBigInt(hypoId)
  if (bid === null) return []
  const res = await getHelixClient()
    .query<HypothesesResult>()
    .dynamic(queries.call.getEvolutionChain({ hypoId: bid }))
    .send()
  return unwrap(res.hypos)
}

export async function getLeaderboard(runId: string, k = 10): Promise<HypothesisNode[]> {
  const res = await getHelixClient()
    .query<HypothesesResult>()
    .dynamic(queries.call.getLeaderboard({ runId, k: BigInt(k) }))
    .send()
  return unwrap(res.hypos)
}

export async function getConceptByName(name: string): Promise<ConceptNode | null> {
  const res = await getHelixClient()
    .query<ConceptResult>()
    .dynamic(queries.call.getConceptByName({ name }))
    .send()
  return first(unwrap(res.concept))
}

// ------------------------------------------------------------
// WRITE 封装
// ------------------------------------------------------------

export interface AddPaperInput {
  title: string
  abstract: string
  authors: string[]
  year: number
  doi?: string | null
  embedding?: number[] | null
}

export async function addPaper(input: AddPaperInput): Promise<void> {
  logger.info(
    { title: input.title.slice(0, 60), year: input.year, hasEmbedding: !!input.embedding },
    'addPaper: sending write',
  )
  const base = {
    title: input.title,
    abstract: input.abstract,
    authors: input.authors,
    year: BigInt(input.year),
    doi: input.doi ?? null,
  }
  const req =
    input.embedding && input.embedding.length > 0
      ? queries.call.addPaperWithEmbedding({ ...base, embedding: input.embedding })
      : queries.call.addPaper(base)
  await getHelixClient().query().dynamic(req).send()
  logger.info({ title: input.title.slice(0, 60) }, 'addPaper: write done')
}

export interface AddHypothesisInput {
  statement: string
  roundId: number
  runId: string
  f1Score: number
  embedding?: number[] | null
  createdAt: string
  /** JSON-encoded mechanism/predictions/falsification/source/code context. */
  contextJson?: string
  // 可选 CITES 边的目标 Paper id；提供则在 addHypothesis 后连边。
  // 注意：SDK 写查询不返回新节点 id，因此 addHypothesis 必须分两步：
  //   1. addHypothesis 建节点（不连边）
  //   2. 调用方用返回的新 hypo id 调 addCitesEdge
  // 这里 paperId 仅作占位；实际连边请直接调用 addCitesEdge。
  paperId?: string | number | bigint | null
}

export async function addHypothesis(input: AddHypothesisInput): Promise<void> {
  logger.info(
    {
      roundId: input.roundId,
      runId: input.runId,
      f1Score: input.f1Score,
      statementLen: input.statement.length,
      hasEmbedding: !!input.embedding,
    },
    'addHypothesis: sending write',
  )
  const base = {
    statement: input.statement,
    roundId: BigInt(input.roundId),
    runId: input.runId,
    f1Score: input.f1Score,
    createdAt: input.createdAt,
  }
  const req =
    input.embedding && input.embedding.length > 0
      ? input.contextJson
        ? queries.call.addHypothesisWithEmbeddingContext({
            ...base,
            embedding: input.embedding,
            contextJson: input.contextJson,
          })
        : queries.call.addHypothesisWithEmbedding({ ...base, embedding: input.embedding })
      : input.contextJson
        ? queries.call.addHypothesisWithContext({ ...base, contextJson: input.contextJson })
        : queries.call.addHypothesis(base)
  await getHelixClient().query().dynamic(req).send()
  logger.info({ roundId: input.roundId, runId: input.runId }, 'addHypothesis: write done')
}

export interface AddCitesEdgeInput {
  hypoId: string | number | bigint
  paperId: string | number | bigint
}

export async function addCitesEdge(input: AddCitesEdgeInput): Promise<void> {
  await getHelixClient()
    .query()
    .dynamic(
      queries.call.addCitesEdge({
        hypoId: BigInt(input.hypoId),
        paperId: BigInt(input.paperId),
      }),
    )
    .send()
}

export interface AddEvidenceInput {
  hypoId: string | number | bigint
  type: 'support' | 'contradict'
  content: string
  f1Score: number
  fitsPaths: string[]
  videoPath?: string | null
  createdAt: string
}

export async function addEvidence(input: AddEvidenceInput): Promise<void> {
  logger.info(
    {
      hypoId: input.hypoId,
      type: input.type,
      contentLen: input.content.length,
      f1Score: input.f1Score,
    },
    'addEvidence: sending write',
  )
  const bid = safeBigInt(input.hypoId)
  if (bid === null) {
    throw new Error(`addEvidence: non-numeric hypoId "${input.hypoId}"`)
  }
  const params = {
    hypoId: bid,
    content: input.content,
    f1Score: input.f1Score,
    fitsPaths: input.fitsPaths,
    videoPath: input.videoPath ?? null,
    createdAt: input.createdAt,
  }
  const req =
    input.type === 'contradict'
      ? queries.call.addContradictingEvidence(params)
      : queries.call.addSupportingEvidence(params)
  await getHelixClient().query().dynamic(req).send()
  logger.info({ hypoId: input.hypoId, type: input.type }, 'addEvidence: write done')
}

export interface AddCritiqueInput {
  hypoId: string | number | bigint
  content: string
  severity: 'low' | 'medium' | 'high'
  mutationType?: string | null
  createdAt: string
}

export async function addCritique(input: AddCritiqueInput): Promise<void> {
  logger.info(
    {
      hypoId: input.hypoId,
      severity: input.severity,
      contentLen: input.content.length,
    },
    'addCritique: sending write',
  )
  const bid = safeBigInt(input.hypoId)
  if (bid === null) {
    throw new Error(`addCritique: non-numeric hypoId "${input.hypoId}"`)
  }
  await getHelixClient()
    .query()
    .dynamic(
      queries.call.addCritique({
        hypoId: bid,
        content: input.content,
        severity: input.severity,
        mutationType: input.mutationType ?? null,
        createdAt: input.createdAt,
      }),
    )
    .send()
  logger.info({ hypoId: input.hypoId, severity: input.severity }, 'addCritique: write done')
}

export interface AddMutationLinkInput {
  fromHypoId: string | number | bigint
  toHypoId: string | number | bigint
  mutationType: string
}

export async function addMutationLink(input: AddMutationLinkInput): Promise<void> {
  const fromBid = safeBigInt(input.fromHypoId)
  const toBid = safeBigInt(input.toHypoId)
  if (fromBid === null || toBid === null) {
    throw new Error(
      `addMutationLink: non-numeric id (fromHypoId="${input.fromHypoId}", toHypoId="${input.toHypoId}")`,
    )
  }
  await getHelixClient()
    .query()
    .dynamic(
      queries.call.addMutationLink({
        fromHypoId: fromBid,
        toHypoId: toBid,
        mutationType: input.mutationType,
      }),
    )
    .send()
}

export interface AddSnapshotInput {
  roundId: number
  runId: string
  hypothesisIds: Array<string | number | bigint>
  createdAt: string
  // 新建 Snapshot 后回填的 hypo id 列表（用于建 CAPTURED_IN 边）。
  // 若调用方已知 snapshotId，可直接传 snapshotId；否则本函数会先 addSnapshot 取返回 id。
  snapshotId?: string | number | bigint | null
}

export async function addSnapshot(input: AddSnapshotInput): Promise<void> {
  await getHelixClient()
    .query()
    .dynamic(
      queries.call.addSnapshot({
        roundId: BigInt(input.roundId),
        runId: input.runId,
        hypothesisIds: input.hypothesisIds
          .map((id) => safeBigInt(id))
          .filter((b): b is bigint => b !== null),
        createdAt: input.createdAt,
      }),
    )
    .send()
  // CAPTURED_IN 边：需要 snapshotId；当前 SDK 写查询不返回新节点 id，
  // 调用方需在 addSnapshot 后用 getSnapshot(roundId) 取 id 再调用 addCaptureInEdges。
  // 这里若提供 snapshotId 则立即建边。
  if (input.snapshotId != null) {
    await addCaptureInEdges({
      snapshotId: input.snapshotId,
      hypoIds: input.hypothesisIds,
    })
  }
}

export interface AddCaptureInEdgesInput {
  snapshotId: string | number | bigint
  hypoIds: Array<string | number | bigint>
}

export async function addCaptureInEdges(input: AddCaptureInEdgesInput): Promise<void> {
  const snapBid = safeBigInt(input.snapshotId)
  if (snapBid === null) return
  for (const hypoId of input.hypoIds) {
    const bid = safeBigInt(hypoId)
    if (bid === null) continue
    await getHelixClient()
      .query()
      .dynamic(
        queries.call.addCaptureInEdge({
          hypoId: bid,
          snapshotId: snapBid,
        }),
      )
      .send()
  }
}

export interface UpsertConceptInput {
  name: string
  description?: string | null
}

export async function upsertConcept(input: UpsertConceptInput): Promise<void> {
  const existing = await getConceptByName(input.name)
  if (existing) {
    if (input.description != null) {
      await getHelixClient()
        .query()
        .dynamic(
          queries.call.updateConceptDescription({
            id: BigInt(existing.id),
            description: input.description,
          }),
        )
        .send()
    }
    return
  }
  await getHelixClient()
    .query()
    .dynamic(
      queries.call.upsertConcept({
        name: input.name,
        description: input.description ?? null,
      }),
    )
    .send()
}

// ------------------------------------------------------------
// Index 管理
// ------------------------------------------------------------

let indexesEnsured = false

export async function ensureIndexes(): Promise<void> {
  if (indexesEnsured) return
  logger.info('ensureIndexes: creating text + vector indexes (one-time)')
  await getHelixClient().query().dynamic(queries.call.ensureIndexes({})).send()
  indexesEnsured = true
  logger.info('ensureIndexes: indexes created')
}
