// HelixDB DSL 查询定义（运行时 generate 生成 queries.json）
//
// 23 个查询（12 read + 11 write），覆盖太阳物理多智能体假设生成系统的
// RAG 检索 + 关系遍历 + 演化链 + 快照写回。其中 21 个对应 spec 必需项，
// 5 个为拆分/辅助查询（addCitesEdge / addSupportingEvidence / addContradictingEvidence /
// addCaptureInEdge / getConceptByName / updateConceptDescription），用于规避静态 builder
// 无法按参数值分支的限制。所有查询通过 registerRead/registerWrite 注册为参数化 batch，
// 运行时经 `queries.call.<name>(params)` 生成 DynamicQueryRequest，
// 再由 client.query<T>().dynamic(req).send() 发送。
//
// 编译：vp run --filter @open-scientist/helix generate-queries
// （运行时 queries.generate 在模块 import 时即写入 src/queries.json）

import {
  defineParams,
  defineQueries,
  Expr,
  g,
  NodeRef,
  Order,
  Projection,
  param,
  RepeatConfig,
  readBatch,
  registerRead,
  registerWrite,
  SourcePredicate,
  sub,
  writeBatch,
} from '@helix-db/helix-db'

// ------------------------------------------------------------
// 节点投影（project(...) 的 PropertyProjection，按 types.ts 字段顺序）
// 可选字段也一并投影（缺失则返回 null）。
// ------------------------------------------------------------

const PAPER_PROJ = [
  Projection.expr('id', Expr.id()),
  Projection.property('title', 'title'),
  Projection.property('abstract', 'abstract'),
  Projection.property('authors', 'authors'),
  Projection.property('year', 'year'),
  Projection.property('doi', 'doi'),
  Projection.property('embedding', 'embedding'),
]

const HYPOTHESIS_PROJ = [
  Projection.expr('id', Expr.id()),
  Projection.property('statement', 'statement'),
  Projection.property('roundId', 'roundId'),
  Projection.property('runId', 'runId'),
  Projection.property('f1Score', 'f1Score'),
  Projection.property('embedding', 'embedding'),
  Projection.property('createdAt', 'createdAt'),
]

const EVIDENCE_PROJ = [
  Projection.expr('id', Expr.id()),
  Projection.property('hypothesisId', 'hypothesisId'),
  Projection.property('type', 'type'),
  Projection.property('content', 'content'),
  Projection.property('f1Score', 'f1Score'),
  Projection.property('fitsPaths', 'fitsPaths'),
  Projection.property('videoPath', 'videoPath'),
  Projection.property('createdAt', 'createdAt'),
]

const CRITIQUE_PROJ = [
  Projection.expr('id', Expr.id()),
  Projection.property('hypothesisId', 'hypothesisId'),
  Projection.property('content', 'content'),
  Projection.property('severity', 'severity'),
  Projection.property('mutationType', 'mutationType'),
  Projection.property('createdAt', 'createdAt'),
]

const CONCEPT_PROJ = [
  Projection.expr('id', Expr.id()),
  Projection.property('name', 'name'),
  Projection.property('description', 'description'),
]

const SNAPSHOT_PROJ = [
  Projection.expr('id', Expr.id()),
  Projection.property('roundId', 'roundId'),
  Projection.property('runId', 'runId'),
  Projection.property('hypothesisIds', 'hypothesisIds'),
  Projection.property('createdAt', 'createdAt'),
]

// ============================================================
// READ 查询
// ============================================================

// 1. searchPapers — Paper 标题文本检索
const searchPapersParams = defineParams({
  queryText: param.string(),
  k: param.i64(),
})

const searchPapers = registerRead(
  (p) =>
    readBatch()
      .varAs(
        'papers',
        g()
          .textSearchNodesWith('Paper', 'title', p.queryText, p.k ?? 10)
          .project(PAPER_PROJ),
      )
      .returning(['papers']),
  searchPapersParams,
)

// 3. searchHypotheses — Hypothesis statement 文本检索
const searchHypothesesParams = defineParams({
  queryText: param.string(),
  k: param.i64(),
})

const searchHypotheses = registerRead(
  (p) =>
    readBatch()
      .varAs(
        'hypos',
        g()
          .textSearchNodesWith('Hypothesis', 'statement', p.queryText, p.k ?? 10)
          .project(HYPOTHESIS_PROJ),
      )
      .returning(['hypos']),
  searchHypothesesParams,
)

// 5. getPaper — 按 id 取 Paper
const getPaperParams = defineParams({
  id: param.i64(),
})

const getPaper = registerRead(
  (p) =>
    readBatch()
      .varAs('paper', g().n(NodeRef.param(p.id.name)).hasLabel('Paper').project(PAPER_PROJ))
      .returning(['paper']),
  getPaperParams,
)

// 6. getHypothesis — 按 id 取 Hypothesis
const getHypothesisParams = defineParams({
  id: param.i64(),
})

const getHypothesis = registerRead(
  (p) =>
    readBatch()
      .varAs(
        'hypo',
        g().n(NodeRef.param(p.id.name)).hasLabel('Hypothesis').project(HYPOTHESIS_PROJ),
      )
      .returning(['hypo']),
  getHypothesisParams,
)

// 8. getEvidenceByHypothesis — Hypothesis → out('SUPPORTED_BY'|'CONTRADICTED_BY') → Evidence
//    双边遍历：SDK SubTraversal 的 union 仅支持基础遍历且需手动构造；这里用双 varAs
//    分别取 support / contradict，客户端合并。
const getEvidenceByHypothesisParams = defineParams({
  hypoId: param.i64(),
})

const getEvidenceByHypothesis = registerRead(
  (p) =>
    readBatch()
      .varAs(
        'support',
        g()
          .n(NodeRef.param(p.hypoId.name))
          .hasLabel('Hypothesis')
          .out('SUPPORTED_BY')
          .hasLabel('Evidence')
          .project(EVIDENCE_PROJ),
      )
      .varAs(
        'contradict',
        g()
          .n(NodeRef.param(p.hypoId.name))
          .hasLabel('Hypothesis')
          .out('CONTRADICTED_BY')
          .hasLabel('Evidence')
          .project(EVIDENCE_PROJ),
      )
      .returning(['support', 'contradict']),
  getEvidenceByHypothesisParams,
)

// 9. getCritiquesByHypothesis — Hypothesis → out('CRITIQUED_BY') → Critique
const getCritiquesByHypothesisParams = defineParams({
  hypoId: param.i64(),
})

const getCritiquesByHypothesis = registerRead(
  (p) =>
    readBatch()
      .varAs(
        'critiques',
        g()
          .n(NodeRef.param(p.hypoId.name))
          .hasLabel('Hypothesis')
          .out('CRITIQUED_BY')
          .hasLabel('Critique')
          .project(CRITIQUE_PROJ),
      )
      .returning(['critiques']),
  getCritiquesByHypothesisParams,
)

// 10. getRelatedConcepts — Hypothesis → out('INVOLVES') → Concept
const getRelatedConceptsParams = defineParams({
  hypoId: param.i64(),
})

const getRelatedConcepts = registerRead(
  (p) =>
    readBatch()
      .varAs(
        'concepts',
        g()
          .n(NodeRef.param(p.hypoId.name))
          .hasLabel('Hypothesis')
          .out('INVOLVES')
          .hasLabel('Concept')
          .project(CONCEPT_PROJ),
      )
      .returning(['concepts']),
  getRelatedConceptsParams,
)

// 11. getSnapshot — 按 roundId 取 Snapshot
// 注意：不要用 `g().nWhere(SourcePredicate.eq('roundId', p.roundId)).hasLabel('Snapshot')`。
// 实测在 HelixDB v3.0.8 上，NWhere 步骤后接独立 HasLabel 步骤对 i64 属性参数不生效
// （NWhere 的 EqExpr 源生成与 HasLabel 不组合，返回 0 节点；String 属性碰巧能命中）。
// 必须用 nWithLabelWhere 把 label 和属性谓词合并进同一个 NWhere And，等价于
//   NWhere{ And:[ Eq["$label",...], EqExpr[prop, Param] ] }
// 该写法与 getLeaderboard 一致，curl 实验已验证可匹配 Snapshot 节点。
const getSnapshotParams = defineParams({
  roundId: param.i64(),
})

const getSnapshot = registerRead(
  (p) =>
    readBatch()
      .varAs(
        'snapshot',
        g()
          .nWithLabelWhere('Snapshot', SourcePredicate.eq('roundId', p.roundId))
          .limit(1)
          .project(SNAPSHOT_PROJ),
      )
      .returning(['snapshot']),
  getSnapshotParams,
)

// 12. getHypothesesByRound — Snapshot → in('CAPTURED_IN') → Hypothesis
// 同 getSnapshot：用 nWithLabelWhere 而非 nWhere+hasLabel，否则 NWhere 对 i64 属性
// 不匹配，后续 in() 遍历起点为空。
const getHypothesesByRoundParams = defineParams({
  roundId: param.i64(),
})

const getHypothesesByRound = registerRead(
  (p) =>
    readBatch()
      .varAs(
        'hypos',
        g()
          .nWithLabelWhere('Snapshot', SourcePredicate.eq('roundId', p.roundId))
          .in('CAPTURED_IN')
          .hasLabel('Hypothesis')
          .project(HYPOTHESIS_PROJ),
      )
      .returning(['hypos']),
  getHypothesesByRoundParams,
)

// 13. getEvolutionChain — Hypothesis → out('MUTATED_FROM')* → Hypothesis
//     repeat(sub().out('MUTATED_FROM')) emitAll。maxDepth 固定 50（SDK maxDepth 仅接受 number 字面量，
//     不支持 ParamRef 绑定；客户端可对超长链做二次截断）。
const getEvolutionChainParams = defineParams({
  hypoId: param.i64(),
})

const getEvolutionChain = registerRead(
  (p) =>
    readBatch()
      .varAs(
        'chain',
        g()
          .n(NodeRef.param(p.hypoId.name))
          .hasLabel('Hypothesis')
          .repeat(
            RepeatConfig.new(sub().out('MUTATED_FROM').hasLabel('Hypothesis'))
              .emitAll()
              .maxDepth(50),
          )
          .project(HYPOTHESIS_PROJ),
      )
      .returning(['chain']),
  getEvolutionChainParams,
)

// 14. getLeaderboard — Hypothesis.where(runId=runId).orderBy(f1Score, desc).limit(k)
const getLeaderboardParams = defineParams({
  runId: param.string(),
  k: param.i64(),
})

const getLeaderboard = registerRead(
  (p) =>
    readBatch()
      .varAs(
        'hypos',
        g()
          .nWithLabelWhere('Hypothesis', SourcePredicate.eq('runId', p.runId))
          .orderBy('f1Score', Order.Desc)
          .limit(p.k ?? 10)
          .project(HYPOTHESIS_PROJ),
      )
      .returning(['hypos']),
  getLeaderboardParams,
)

// 21b. getConceptByName — 配合 upsert 查重（read，提前列出）
// 同 getSnapshot：统一用 nWithLabelWhere（i64 属性场景下 nWhere+hasLabel 不匹配，
// 详见 getSnapshot 注释；String 属性碰巧能命中，但统一写法避免踩坑）。
const getConceptByNameParams = defineParams({
  name: param.string(),
})

const getConceptByName = registerRead(
  (p) =>
    readBatch()
      .varAs(
        'concept',
        g()
          .nWithLabelWhere('Concept', SourcePredicate.eq('name', p.name))
          .limit(1)
          .project(CONCEPT_PROJ),
      )
      .returning(['concept']),
  getConceptByNameParams,
)

// ============================================================
// WRITE 查询
// ------------------------------------------------------------

// 15. addPaper — addN('Paper')
// embedding 拆为独立查询 addPaperWithEmbedding：建了 vector index 后，
// embedding 属性必须是非空数组，传 null/[] 会报 "indexed vector property requires an array value"。
// 因此无 embedding 时完全不写入该属性（addPaper），有 embedding 时写入（addPaperWithEmbedding）。
// doi 同样可选，但无 index 约束，用 param.value() 允许 null 即可。
const addPaperParams = defineParams({
  title: param.string(),
  abstract: param.string(),
  authors: param.array(param.string()),
  year: param.i64(),
  doi: param.value(),
})

const addPaper = registerWrite(
  (p) =>
    writeBatch().varAs(
      'paper',
      g().addN('Paper', [
        ['title', p.title],
        ['abstract', p.abstract],
        ['authors', p.authors],
        ['year', p.year],
        ['doi', p.doi],
      ]),
    ),
  addPaperParams,
)

const addPaperWithEmbeddingParams = defineParams({
  title: param.string(),
  abstract: param.string(),
  authors: param.array(param.string()),
  year: param.i64(),
  doi: param.value(),
  embedding: param.array(param.f32()),
})

const addPaperWithEmbedding = registerWrite(
  (p) =>
    writeBatch().varAs(
      'paper',
      g().addN('Paper', [
        ['title', p.title],
        ['abstract', p.abstract],
        ['authors', p.authors],
        ['year', p.year],
        ['doi', p.doi],
        ['embedding', p.embedding],
      ]),
    ),
  addPaperWithEmbeddingParams,
)

// 16. addHypothesis — addN('Hypothesis')
// embedding 拆分原因同 addPaper（Hypothesis:embedding 也有 vector index）。
// 可选 CITES 边由 addCitesEdge 独立建立（条件连边无法在静态 builder 里分支）。
const addHypothesisParams = defineParams({
  statement: param.string(),
  roundId: param.i64(),
  runId: param.string(),
  f1Score: param.f64(),
  createdAt: param.string(),
})

const addHypothesis = registerWrite(
  (p) =>
    writeBatch().varAs(
      'hypo',
      g().addN('Hypothesis', [
        ['statement', p.statement],
        ['roundId', p.roundId],
        ['runId', p.runId],
        ['f1Score', p.f1Score],
        ['createdAt', p.createdAt],
      ]),
    ),
  addHypothesisParams,
)

const addHypothesisWithEmbeddingParams = defineParams({
  statement: param.string(),
  roundId: param.i64(),
  runId: param.string(),
  f1Score: param.f64(),
  embedding: param.array(param.f32()),
  createdAt: param.string(),
})

const addHypothesisWithEmbedding = registerWrite(
  (p) =>
    writeBatch().varAs(
      'hypo',
      g().addN('Hypothesis', [
        ['statement', p.statement],
        ['roundId', p.roundId],
        ['runId', p.runId],
        ['f1Score', p.f1Score],
        ['embedding', p.embedding],
        ['createdAt', p.createdAt],
      ]),
    ),
  addHypothesisWithEmbeddingParams,
)

// 16b. addCitesEdge — 从 Hypothesis 加 CITES 边到 Paper（配合 addHypothesis 可选调用）
const addCitesEdgeParams = defineParams({
  hypoId: param.i64(),
  paperId: param.i64(),
})

const addCitesEdge = registerWrite(
  (p) =>
    writeBatch().varAs(
      'edge',
      g()
        .n(NodeRef.param(p.hypoId.name))
        .hasLabel('Hypothesis')
        .addE('CITES', NodeRef.param(p.paperId.name)),
    ),
  addCitesEdgeParams,
)

// 17. addEvidence — addN('Evidence') + addE('SUPPORTED_BY'|'CONTRADICTED_BY') from hypo
// 双边无法在静态 builder 里按 type 分支；拆为 addSupportingEvidence / addContradictingEvidence，
// 客户端按 type 选择调用。
const addEvidenceParams = defineParams({
  hypoId: param.i64(),
  content: param.string(),
  f1Score: param.f64(),
  fitsPaths: param.array(param.string()),
  videoPath: param.value(),
  createdAt: param.string(),
})

const addSupportingEvidence = registerWrite((p) => {
  const t = g()
    .addN('Evidence', [
      ['hypothesisId', p.hypoId],
      ['type', 'support'],
      ['content', p.content],
      ['f1Score', p.f1Score],
      ['fitsPaths', p.fitsPaths],
      ['videoPath', p.videoPath],
      ['createdAt', p.createdAt],
    ])
    .addE('SUPPORTED_BY', NodeRef.param(p.hypoId.name))
  return writeBatch().varAs('evidence', t)
}, addEvidenceParams)

const addContradictingEvidence = registerWrite((p) => {
  const t = g()
    .addN('Evidence', [
      ['hypothesisId', p.hypoId],
      ['type', 'contradict'],
      ['content', p.content],
      ['f1Score', p.f1Score],
      ['fitsPaths', p.fitsPaths],
      ['videoPath', p.videoPath],
      ['createdAt', p.createdAt],
    ])
    .addE('CONTRADICTED_BY', NodeRef.param(p.hypoId.name))
  return writeBatch().varAs('evidence', t)
}, addEvidenceParams)

// 18. addCritique — addN('Critique') + addE('CRITIQUED_BY') from hypo
const addCritiqueParams = defineParams({
  hypoId: param.i64(),
  content: param.string(),
  severity: param.string(),
  mutationType: param.value(),
  createdAt: param.string(),
})

const addCritique = registerWrite((p) => {
  const entries: [string, typeof p.hypoId | typeof p.content | typeof p.mutationType][] = [
    ['hypothesisId', p.hypoId],
    ['content', p.content],
    ['severity', p.severity],
    ['mutationType', p.mutationType],
    ['createdAt', p.createdAt],
  ]
  const t = g().addN('Critique', entries).addE('CRITIQUED_BY', NodeRef.param(p.hypoId.name))
  return writeBatch().varAs('critique', t)
}, addCritiqueParams)

// 19. addMutationLink — addE('MUTATED_FROM') from new to old
const addMutationLinkParams = defineParams({
  fromHypoId: param.i64(),
  toHypoId: param.i64(),
  mutationType: param.string(),
})

const addMutationLink = registerWrite(
  (p) =>
    writeBatch().varAs(
      'edge',
      g()
        .n(NodeRef.param(p.fromHypoId.name))
        .hasLabel('Hypothesis')
        .addE('MUTATED_FROM', NodeRef.param(p.toHypoId.name), [['mutationType', p.mutationType]]),
    ),
  addMutationLinkParams,
)

// 20. addSnapshot — addN('Snapshot')
// CAPTURED_IN 边（Hypothesis → Snapshot）由 addCaptureInEdge 在 client 侧循环建立，
// 因为 WriteBatch 难以在 addN 后引用新节点 id。
const addSnapshotParams = defineParams({
  roundId: param.i64(),
  runId: param.string(),
  hypothesisIds: param.array(param.i64()),
  createdAt: param.string(),
})

const addSnapshot = registerWrite(
  (p) =>
    writeBatch().varAs(
      'snapshot',
      g().addN('Snapshot', [
        ['roundId', p.roundId],
        ['runId', p.runId],
        ['hypothesisIds', p.hypothesisIds],
        ['createdAt', p.createdAt],
      ]),
    ),
  addSnapshotParams,
)

// 20b. addCaptureInEdge — 从单个 hypo 加 CAPTURED_IN 边到 snapshot
const addCaptureInEdgeParams = defineParams({
  hypoId: param.i64(),
  snapshotId: param.i64(),
})

const addCaptureInEdge = registerWrite(
  (p) =>
    writeBatch().varAs(
      'edge',
      g()
        .n(NodeRef.param(p.hypoId.name))
        .hasLabel('Hypothesis')
        .addE('CAPTURED_IN', NodeRef.param(p.snapshotId.name)),
    ),
  addCaptureInEdgeParams,
)

// 21. upsertConcept — addN('Concept')（查重 + 更新在 client 侧用 getConceptByName + updateConceptDescription）
const upsertConceptParams = defineParams({
  name: param.string(),
  description: param.value(),
})

const upsertConcept = registerWrite((p) => {
  const entries: [string, typeof p.name | typeof p.description][] = [['name', p.name]]
  if (p.description != null) entries.push(['description', p.description])
  return writeBatch().varAs('concept', g().addN('Concept', entries))
}, upsertConceptParams)

// 21c. updateConceptDescription — upsert 命中分支
const updateConceptDescriptionParams = defineParams({
  id: param.i64(),
  description: param.string(),
})

const updateConceptDescription = registerWrite(
  (p) =>
    writeBatch().varAs(
      'concept',
      g().n(NodeRef.param(p.id.name)).hasLabel('Concept').setProperty('description', p.description),
    ),
  updateConceptDescriptionParams,
)

// 22. ensureIndexes — 创建 text + vector index（idempotent, if_not_exists: true）
//     HelixDB v3 的 TextSearchNodes / VectorSearchNodes 要求属性上预先存在对应 index，
//     否则返回 "Vector index not found: text index not found for Node <Label>:<prop>"。
//     此查询幂等（CreateIndex 带 if_not_exists），可在 client 初始化时调用。
const ensureIndexes = registerWrite(
  () =>
    writeBatch()
      .varAs('i1', g().createTextIndexNodes('Paper', 'title'))
      .varAs('i2', g().createVectorIndexNodes('Paper', 'embedding'))
      .varAs('i3', g().createTextIndexNodes('Hypothesis', 'statement'))
      .varAs('i4', g().createVectorIndexNodes('Hypothesis', 'embedding')),
  defineParams({}),
)

// ============================================================
// 顶层 queries 对象
// ============================================================

export const queries = defineQueries({
  read: {
    searchPapers,
    searchHypotheses,
    getPaper,
    getHypothesis,
    getEvidenceByHypothesis,
    getCritiquesByHypothesis,
    getRelatedConcepts,
    getSnapshot,
    getHypothesesByRound,
    getEvolutionChain,
    getLeaderboard,
    getConceptByName,
  },
  write: {
    addPaper,
    addPaperWithEmbedding,
    addHypothesis,
    addHypothesisWithEmbedding,
    addCitesEdge,
    addSupportingEvidence,
    addContradictingEvidence,
    addCritique,
    addMutationLink,
    addSnapshot,
    addCaptureInEdge,
    upsertConcept,
    updateConceptDescription,
    ensureIndexes,
  },
})

// 编译：vp run --filter @open-scientist/helix generate-queries
// （运行时 queries.generate 在模块 import 时即写入 src/queries.json；
//   失败不阻塞 import —— 动态查询路径仍可用。）
void queries.generate(new URL('./queries.json', import.meta.url).pathname).catch((err: unknown) => {
  console.warn('[helix] queries.generate failed:', err)
})
