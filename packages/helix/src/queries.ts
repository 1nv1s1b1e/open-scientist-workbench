// HelixDB DSL 查询定义（编译时生成 queries.json）
// 使用 defineQueries + registerRead/registerWrite
// 参见 https://github.com/HelixDB/helix-db

export const searchPapersQuery = `
  g().nWithLabel('Paper')
    .where(Predicate.vector('embedding', 'query', 'k'))
    .project(['id', 'title', 'abstract'])
`

export const searchHypothesesQuery = `
  g().nWithLabel('Hypothesis')
    .where(Predicate.vector('embedding', 'query', 'k'))
    .project(['id', 'statement', 'pythonCode'])
`

export const getRelatedConceptsQuery = `
  g().v('$id').out('RELATES_TO').project(['id', 'name', 'description'])
`
