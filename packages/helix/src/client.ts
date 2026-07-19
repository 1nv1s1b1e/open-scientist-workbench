import { Client } from '@helix-db/helix-db'
import { env } from '@open-scientist/config'
import { queries } from './queries.js'
import type {
  ConceptNode,
  CritiqueNode,
  EvidenceNode,
  HypothesisNode,
  PaperNode,
  SnapshotNode,
} from './types.js'

let client: Client | null = null

export function getHelixClient(): Client {
  if (client) return client
  client = new Client(env.HELIX_URL)
  return client
}

// ------------------------------------------------------------
// 批量查询返回的容器形状（readBatch().returning([...]) 产生的对象）
// ------------------------------------------------------------

interface PapersResult {
  papers: PaperNode[]
}
interface HypothesesResult {
  hypos: HypothesisNode[]
}
interface HypoResult {
  hypo: HypothesisNode[]
}
interface PaperResult {
  paper: PaperNode[]
}
interface ConceptsResult {
  concepts: ConceptNode[]
}
interface CritiquesResult {
  critiques: CritiqueNode[]
}
interface SnapshotResult {
  snapshot: SnapshotNode[]
}
interface EvidenceByHypoResult {
  support: EvidenceNode[]
  contradict: EvidenceNode[]
}
interface ConceptResult {
  concept: ConceptNode[]
}

// ------------------------------------------------------------
// 帮助函数
// ------------------------------------------------------------

function first<T>(arr: T[] | undefined): T | null {
  return arr && arr.length > 0 ? arr[0]! : null
}

// ------------------------------------------------------------
// READ 封装
// ------------------------------------------------------------

export async function searchPapers(query: string, k = 10): Promise<PaperNode[]> {
  const res = await getHelixClient()
    .query<PapersResult>()
    .dynamic(queries.call.searchPapers({ queryText: query, k: BigInt(k) }))
    .send()
  return res.papers ?? []
}

export async function searchPapersVector(queryVector: number[], k = 10): Promise<PaperNode[]> {
  const res = await getHelixClient()
    .query<PapersResult>()
    .dynamic(queries.call.searchPapersVector({ queryVector, k: BigInt(k) }))
    .send()
  return res.papers ?? []
}

export async function searchHypotheses(query: string, k = 10): Promise<HypothesisNode[]> {
  const res = await getHelixClient()
    .query<HypothesesResult>()
    .dynamic(queries.call.searchHypotheses({ queryText: query, k: BigInt(k) }))
    .send()
  return res.hypos ?? []
}

export async function searchHypothesesVector(
  queryVector: number[],
  k = 10,
): Promise<HypothesisNode[]> {
  const res = await getHelixClient()
    .query<HypothesesResult>()
    .dynamic(queries.call.searchHypothesesVector({ queryVector, k: BigInt(k) }))
    .send()
  return res.hypos ?? []
}

export async function getPaper(id: string | number | bigint): Promise<PaperNode | null> {
  const res = await getHelixClient()
    .query<PaperResult>()
    .dynamic(queries.call.getPaper({ id: BigInt(id) }))
    .send()
  return first(res.paper)
}

export async function getHypothesis(id: string | number | bigint): Promise<HypothesisNode | null> {
  const res = await getHelixClient()
    .query<HypoResult>()
    .dynamic(queries.call.getHypothesis({ id: BigInt(id) }))
    .send()
  return first(res.hypo)
}

export async function getHypothesesByPaper(
  paperId: string | number | bigint,
): Promise<HypothesisNode[]> {
  const res = await getHelixClient()
    .query<HypothesesResult>()
    .dynamic(queries.call.getHypothesesByPaper({ paperId: BigInt(paperId) }))
    .send()
  return res.hypos ?? []
}

export async function getEvidenceByHypothesis(
  hypoId: string | number | bigint,
): Promise<EvidenceNode[]> {
  const res = await getHelixClient()
    .query<EvidenceByHypoResult>()
    .dynamic(queries.call.getEvidenceByHypothesis({ hypoId: BigInt(hypoId) }))
    .send()
  return [...(res.support ?? []), ...(res.contradict ?? [])]
}

export async function getCritiquesByHypothesis(
  hypoId: string | number | bigint,
): Promise<CritiqueNode[]> {
  const res = await getHelixClient()
    .query<CritiquesResult>()
    .dynamic(queries.call.getCritiquesByHypothesis({ hypoId: BigInt(hypoId) }))
    .send()
  return res.critiques ?? []
}

export async function getRelatedConcepts(hypoId: string | number | bigint): Promise<ConceptNode[]> {
  const res = await getHelixClient()
    .query<ConceptsResult>()
    .dynamic(queries.call.getRelatedConcepts({ hypoId: BigInt(hypoId) }))
    .send()
  return res.concepts ?? []
}

export async function getSnapshot(roundId: number): Promise<SnapshotNode | null> {
  const res = await getHelixClient()
    .query<SnapshotResult>()
    .dynamic(queries.call.getSnapshot({ roundId: BigInt(roundId) }))
    .send()
  return first(res.snapshot)
}

export async function getHypothesesByRound(roundId: number): Promise<HypothesisNode[]> {
  const res = await getHelixClient()
    .query<HypothesesResult>()
    .dynamic(queries.call.getHypothesesByRound({ roundId: BigInt(roundId) }))
    .send()
  return res.hypos ?? []
}

export async function getEvolutionChain(
  hypoId: string | number | bigint,
): Promise<HypothesisNode[]> {
  const res = await getHelixClient()
    .query<HypothesesResult>()
    .dynamic(queries.call.getEvolutionChain({ hypoId: BigInt(hypoId) }))
    .send()
  return res.hypos ?? []
}

export async function getLeaderboard(runId: string, k = 10): Promise<HypothesisNode[]> {
  const res = await getHelixClient()
    .query<HypothesesResult>()
    .dynamic(queries.call.getLeaderboard({ runId, k: BigInt(k) }))
    .send()
  return res.hypos ?? []
}

export async function getConceptByName(name: string): Promise<ConceptNode | null> {
  const res = await getHelixClient()
    .query<ConceptResult>()
    .dynamic(queries.call.getConceptByName({ name }))
    .send()
  return first(res.concept)
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
  await getHelixClient()
    .query()
    .dynamic(
      queries.call.addPaper({
        title: input.title,
        abstract: input.abstract,
        authors: input.authors,
        year: BigInt(input.year),
        doi: input.doi ?? null,
        embedding: input.embedding ?? null,
      }),
    )
    .send()
}

export interface AddHypothesisInput {
  statement: string
  roundId: number
  runId: string
  f1Score: number
  embedding?: number[] | null
  createdAt: string
  // 可选 CITES 边的目标 Paper id；提供则在 addHypothesis 后连边。
  // 注意：SDK 写查询不返回新节点 id，因此 addHypothesis 必须分两步：
  //   1. addHypothesis 建节点（不连边）
  //   2. 调用方用返回的新 hypo id 调 addCitesEdge
  // 这里 paperId 仅作占位；实际连边请直接调用 addCitesEdge。
  paperId?: string | number | bigint | null
}

export async function addHypothesis(input: AddHypothesisInput): Promise<void> {
  await getHelixClient()
    .query()
    .dynamic(
      queries.call.addHypothesis({
        statement: input.statement,
        roundId: BigInt(input.roundId),
        runId: input.runId,
        f1Score: input.f1Score,
        embedding: input.embedding ?? null,
        createdAt: input.createdAt,
      }),
    )
    .send()
  // 注意：CAPTURED_IN / CITES 等连边需要新建节点的 id，
  // SDK write 查询不返回新 id，故连边须由调用方拿到 id 后另行调用 addCitesEdge。
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
  const params = {
    hypoId: BigInt(input.hypoId),
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
}

export interface AddCritiqueInput {
  hypoId: string | number | bigint
  content: string
  severity: 'low' | 'medium' | 'high'
  mutationType?: string | null
  createdAt: string
}

export async function addCritique(input: AddCritiqueInput): Promise<void> {
  await getHelixClient()
    .query()
    .dynamic(
      queries.call.addCritique({
        hypoId: BigInt(input.hypoId),
        content: input.content,
        severity: input.severity,
        mutationType: input.mutationType ?? null,
        createdAt: input.createdAt,
      }),
    )
    .send()
}

export interface AddMutationLinkInput {
  fromHypoId: string | number | bigint
  toHypoId: string | number | bigint
  mutationType: string
}

export async function addMutationLink(input: AddMutationLinkInput): Promise<void> {
  await getHelixClient()
    .query()
    .dynamic(
      queries.call.addMutationLink({
        fromHypoId: BigInt(input.fromHypoId),
        toHypoId: BigInt(input.toHypoId),
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
        hypothesisIds: input.hypothesisIds.map((id) => BigInt(id)),
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
  for (const hypoId of input.hypoIds) {
    await getHelixClient()
      .query()
      .dynamic(
        queries.call.addCaptureInEdge({
          hypoId: BigInt(hypoId),
          snapshotId: BigInt(input.snapshotId),
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
