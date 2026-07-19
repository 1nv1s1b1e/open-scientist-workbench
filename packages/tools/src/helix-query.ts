import * as helix from '@open-scientist/helix'
import { createLogger } from '@open-scientist/logger'
import { tool } from 'ai'
import { z } from 'zod'

const logger = createLogger('tools')

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
    try {
      const papers = await helix.searchPapers(query, k)
      logger.info(
        { query, k, count: papers.length, firstTitle: papers[0]?.title?.slice(0, 60) },
        'searchPapersTool: execute done',
      )
      return { papers }
    } catch (err) {
      logger.error({ query, k, error: (err as Error).message }, 'searchPapersTool: execute failed')
      throw err
    }
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
        createdAt: z.string(),
      }),
    ),
  }),
  execute: async ({ query, k }) => {
    logger.info({ query, k }, 'searchHypothesesTool: execute start')
    try {
      const hypotheses = await helix.searchHypotheses(query, k)
      logger.info({ query, k, count: hypotheses.length }, 'searchHypothesesTool: execute done')
      return { hypotheses }
    } catch (err) {
      logger.error(
        { query, k, error: (err as Error).message },
        'searchHypothesesTool: execute failed',
      )
      throw err
    }
  },
})

export const getHypothesisTool = tool({
  description: 'Get a single hypothesis by id. Returns null if not found.',
  inputSchema: z.object({
    id: idInput,
  }),
  outputSchema: z.object({
    hypothesis: z
      .object({
        id: z.number(),
        statement: z.string(),
        roundId: z.number(),
        runId: z.string(),
        f1Score: z.number(),
        createdAt: z.string(),
      })
      .nullable(),
  }),
  execute: async ({ id }) => {
    logger.info({ id }, 'getHypothesisTool: execute start')
    const hypothesis = await helix.getHypothesis(id)
    return { hypothesis }
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

export const getRelatedConceptsTool = tool({
  description: 'Get concepts related to a hypothesis (INVOLVES edges).',
  inputSchema: z.object({
    hypoId: idInput,
  }),
  outputSchema: z.object({
    concepts: z.array(
      z.object({
        id: z.number(),
        name: z.string(),
        description: z.string().optional(),
      }),
    ),
  }),
  execute: async ({ hypoId }) => {
    logger.info({ hypoId }, 'getRelatedConceptsTool: execute start')
    const concepts = await helix.getRelatedConcepts(hypoId)
    return { concepts }
  },
})

export const getLeaderboardTool = tool({
  description: 'Get top-k hypotheses for a run, ranked by f1Score descending.',
  inputSchema: z.object({
    runId: z.string(),
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
        createdAt: z.string(),
      }),
    ),
  }),
  execute: async ({ runId, k }) => {
    logger.info({ runId, k }, 'getLeaderboardTool: execute start')
    const hypotheses = await helix.getLeaderboard(runId, k)
    return { hypotheses }
  },
})

export const getEvolutionChainTool = tool({
  description: 'Get the full mutation chain for a hypothesis (ancestors + descendants).',
  inputSchema: z.object({
    hypoId: idInput,
  }),
  outputSchema: z.object({
    hypotheses: z.array(
      z.object({
        id: z.number(),
        statement: z.string(),
        roundId: z.number(),
        runId: z.string(),
        f1Score: z.number(),
        createdAt: z.string(),
      }),
    ),
  }),
  execute: async ({ hypoId }) => {
    logger.info({ hypoId }, 'getEvolutionChainTool: execute start')
    const hypotheses = await helix.getEvolutionChain(hypoId)
    return { hypotheses }
  },
})

export const getHypothesesByRoundTool = tool({
  description: 'Get all hypotheses captured in a specific tournament round.',
  inputSchema: z.object({
    roundId: z.number().int().nonnegative(),
  }),
  outputSchema: z.object({
    hypotheses: z.array(
      z.object({
        id: z.number(),
        statement: z.string(),
        roundId: z.number(),
        runId: z.string(),
        f1Score: z.number(),
        createdAt: z.string(),
      }),
    ),
  }),
  execute: async ({ roundId }) => {
    logger.info({ roundId }, 'getHypothesesByRoundTool: execute start')
    const hypotheses = await helix.getHypothesesByRound(roundId)
    return { hypotheses }
  },
})

// ------------------------------------------------------------
// WRITE tools
// ------------------------------------------------------------

const successOutput = z.object({ success: z.boolean() })

export const addHypothesisTool = tool({
  description: 'Add a new hypothesis node to the HelixDB knowledge graph.',
  inputSchema: z.object({
    statement: z.string(),
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
    try {
      await helix.addHypothesis(input)
      logger.info({ roundId: input.roundId, runId: input.runId }, 'addHypothesisTool: execute done')
      return { success: true }
    } catch (err) {
      logger.error(
        {
          roundId: input.roundId,
          runId: input.runId,
          error: (err as Error).message,
        },
        'addHypothesisTool: execute failed',
      )
      throw err
    }
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

export const addSnapshotTool = tool({
  description: 'Add a tournament round snapshot capturing a set of hypothesis ids.',
  inputSchema: z.object({
    roundId: z.number().int().nonnegative(),
    runId: z.string(),
    hypothesisIds: z.array(z.union([z.string(), z.number()])),
    createdAt: z.string().describe('ISO 8601 timestamp'),
  }),
  outputSchema: successOutput,
  execute: async (input) => {
    logger.info(
      {
        roundId: input.roundId,
        runId: input.runId,
        hypoCount: input.hypothesisIds.length,
      },
      'addSnapshotTool: execute start',
    )
    await helix.addSnapshot(input)
    return { success: true }
  },
})
