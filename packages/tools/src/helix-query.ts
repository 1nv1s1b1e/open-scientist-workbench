import * as helix from '@open-scientist/helix'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@open-scientist/logger'
import { tool } from 'ai'
import { z } from 'zod'

const logger = createLogger('tools')
interface LocalLiteratureRecord {
  id: string
  title: string
  authors: string[]
  year: number
  doi?: string
  source_url: string
  kind: string
  topics: string[]
  annotation: string
  evidence_boundary: string
}

let localLiteraturePromise: Promise<LocalLiteratureRecord[]> | null = null

function localLiterature(): Promise<LocalLiteratureRecord[]> {
  if (!localLiteraturePromise) {
    const path = fileURLToPath(
      new URL('../../../sources/coronal-heating-corpus-v1.json', import.meta.url),
    )
    localLiteraturePromise = readFile(path, 'utf8').then((text) => {
      const parsed = JSON.parse(text) as { records?: LocalLiteratureRecord[] }
      return Array.isArray(parsed.records) ? parsed.records : []
    })
  }
  return localLiteraturePromise
}

function queryTerms(query: string): string[] {
  return [...new Set(
    query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((term) => term.length > 1),
  )]
}

export async function searchVerifiedCoronalLiterature(query: string, k = 10): Promise<helix.PaperNode[]> {
  const terms = queryTerms(query)
  const records = await localLiterature()
  return records
    .map((record, index) => {
      const title = record.title.toLowerCase()
      const topics = record.topics.join(' ').toLowerCase()
      const annotation = record.annotation.toLowerCase()
      const score = terms.reduce(
        (total, term) => total
          + (title.includes(term) ? 4 : 0)
          + (topics.includes(term) ? 2 : 0)
          + (annotation.includes(term) ? 1 : 0),
        0,
      )
      return { record, index, score }
    })
    .sort((left, right) => right.score - left.score || right.record.year - left.record.year)
    .slice(0, k)
    .map(({ record, index }) => ({
      id: 900_001 + index,
      title: record.title,
      abstract: [
        record.annotation,
        `证据边界：${record.evidence_boundary}`,
        `元数据来源：${record.source_url}`,
      ].join('\n'),
      authors: record.authors,
      year: record.year,
      ...(record.doi ? { doi: record.doi } : {}),
    }))
}


// Shared id input schema — helix accepts string | number | bigint and converts
// via BigInt() internally. We expose string | number to avoid zod bigint
// serialization issues with the AI SDK.
const idInput = z.union([z.string(), z.number()]).describe('Node id (string or number)')

// ------------------------------------------------------------
// READ tools
// ------------------------------------------------------------

export const searchPapersTool = tool({
  description:
    'Search solar physics papers by text query (title + abstract). Returns top-k papers.',
  inputSchema: z.object({
    query: z.string().describe('Search query text'),
    k: z.number().int().positive().default(10).describe('Number of results'),
  }),
  outputSchema: z.object({
    papers: z.array(
      z.object({
        id: z.number(),
        title: z.string(),
        abstract: z.string().optional(),
        authors: z.array(z.string()),
        year: z.number(),
        doi: z.string().optional(),
      }),
    ),
  }),
  execute: async ({ query, k }) => {
    logger.info({ query, k }, 'searchPapersTool: execute start')
    let papers: helix.PaperNode[]
    try {
      papers = await helix.searchPapers(query, k)
    } catch (error) {
      logger.warn({ query, error: error instanceof Error ? error.message : String(error) }, 'searchPapersTool: Helix unavailable; using verified local corpus')
      papers = []
    }
    if (papers.length === 0) {
      papers = await searchVerifiedCoronalLiterature(query, k)
    }
    logger.info(
      { query, k, count: papers.length, firstTitle: papers[0]?.title?.slice(0, 60) },
      'searchPapersTool: execute done',
    )
    return { papers }
  },
})

export const searchHypothesesTool = tool({
  description: 'Search hypotheses by text query (statement). Returns top-k hypotheses.',
  inputSchema: z.object({
    query: z.string().describe('Search query text'),
    k: z.number().int().positive().default(10).describe('Number of results'),
  }),
  outputSchema: z.object({
    hypotheses: z.array(
      z.object({
        id: z.number(),
        statement: z.string(),
        roundId: z.number(),
        runId: z.string(),
        f1Score: z.number(),
        contextJson: z.string().optional(),
        createdAt: z.string(),
      }),
    ),
  }),
  execute: async ({ query, k }) => {
    logger.info({ query, k }, 'searchHypothesesTool: execute start')
    let hypotheses: helix.HypothesisNode[]
    try {
      hypotheses = await helix.searchHypotheses(query, k)
    } catch (error) {
      logger.warn({ query, error: error instanceof Error ? error.message : String(error) }, 'searchHypothesesTool: Helix unavailable; returning empty history')
      hypotheses = []
    }
    logger.info({ query, k, count: hypotheses.length }, 'searchHypothesesTool: execute done')
    return { hypotheses }
  },
})

export const getEvidenceByHypothesisTool = tool({
  description: 'Get all evidence (support + contradict) linked to a hypothesis.',
  inputSchema: z.object({
    hypoId: idInput,
  }),
  outputSchema: z.object({
    evidence: z.array(
      z.object({
        id: z.number(),
        hypothesisId: z.number(),
        type: z.enum(['support', 'contradict']),
        content: z.string(),
        f1Score: z.number(),
        fitsPaths: z.array(z.string()),
        videoPath: z.string().optional(),
        createdAt: z.string(),
      }),
    ),
  }),
  execute: async ({ hypoId }) => {
    logger.info({ hypoId }, 'getEvidenceByHypothesisTool: execute start')
    const evidence = await helix.getEvidenceByHypothesis(hypoId)
    return { evidence }
  },
})

export const getCritiquesByHypothesisTool = tool({
  description: 'Get all critiques linked to a hypothesis.',
  inputSchema: z.object({
    hypoId: idInput,
  }),
  outputSchema: z.object({
    critiques: z.array(
      z.object({
        id: z.number(),
        hypothesisId: z.number(),
        content: z.string(),
        severity: z.enum(['low', 'medium', 'high']),
        mutationType: z.string().optional(),
        createdAt: z.string(),
      }),
    ),
  }),
  execute: async ({ hypoId }) => {
    logger.info({ hypoId }, 'getCritiquesByHypothesisTool: execute start')
    const critiques = await helix.getCritiquesByHypothesis(hypoId)
    return { critiques }
  },
})

// ------------------------------------------------------------
// WRITE tools
// ------------------------------------------------------------

const successOutput = z.object({ success: z.boolean() })

export const addHypothesisTool = tool({
  description:
    'Add a complete scientific hypothesis node to the HelixDB knowledge graph, including its mechanism, observable predictions, falsification conditions, source IDs, and executable filter context.',
  inputSchema: z.object({
    statement: z.string(),
    mechanism: z.string().min(1),
    predictions: z.array(z.string().min(1)).min(1),
    falsificationConditions: z.array(z.string().min(1)).min(1),
    sourceIds: z.array(z.string().min(1)),
    pythonCode: z.string(),
    parentId: z.string().nullable(),
    roundId: z.number().int().nonnegative(),
    runId: z.string(),
    f1Score: z.number(),
    createdAt: z.string().describe('ISO 8601 timestamp'),
  }),
  outputSchema: successOutput,
  execute: async (input) => {
    logger.info(
      {
        roundId: input.roundId,
        runId: input.runId,
        f1Score: input.f1Score,
        statementLen: input.statement.length,
      },
      'addHypothesisTool: execute start',
    )
    await helix.addHypothesis({
      statement: input.statement,
      roundId: input.roundId,
      runId: input.runId,
      f1Score: input.f1Score,
      createdAt: input.createdAt,
      contextJson: JSON.stringify({
        mechanism: input.mechanism,
        predictions: input.predictions,
        falsificationConditions: input.falsificationConditions,
        sourceIds: input.sourceIds,
        pythonCode: input.pythonCode,
        parentId: input.parentId,
      }),
    })
    logger.info({ roundId: input.roundId, runId: input.runId }, 'addHypothesisTool: execute done')
    return { success: true }
  },
})

export const addEvidenceTool = tool({
  description: 'Add evidence (support or contradict) linked to a hypothesis.',
  inputSchema: z.object({
    hypoId: idInput,
    type: z.enum(['support', 'contradict']),
    content: z.string(),
    f1Score: z.number(),
    fitsPaths: z.array(z.string()),
    videoPath: z.string().optional(),
    createdAt: z.string().describe('ISO 8601 timestamp'),
  }),
  outputSchema: successOutput,
  execute: async (input) => {
    logger.info(
      { hypoId: input.hypoId, type: input.type, contentLen: input.content.length },
      'addEvidenceTool: execute start',
    )
    await helix.addEvidence(input)
    return { success: true }
  },
})

export const addCritiqueTool = tool({
  description: 'Add a critique linked to a hypothesis.',
  inputSchema: z.object({
    hypoId: idInput,
    content: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
    mutationType: z.string().optional(),
    createdAt: z.string().describe('ISO 8601 timestamp'),
  }),
  outputSchema: successOutput,
  execute: async (input) => {
    logger.info(
      {
        hypoId: input.hypoId,
        severity: input.severity,
        contentLen: input.content.length,
      },
      'addCritiqueTool: execute start',
    )
    await helix.addCritique(input)
    return { success: true }
  },
})

export const addMutationLinkTool = tool({
  description: 'Create a MUTATED_FROM edge between two hypotheses (from → to).',
  inputSchema: z.object({
    fromHypoId: idInput,
    toHypoId: idInput,
    mutationType: z.string(),
  }),
  outputSchema: successOutput,
  execute: async (input) => {
    logger.info(
      {
        fromHypoId: input.fromHypoId,
        toHypoId: input.toHypoId,
        mutationType: input.mutationType,
      },
      'addMutationLinkTool: execute start',
    )
    await helix.addMutationLink(input)
    return { success: true }
  },
})
