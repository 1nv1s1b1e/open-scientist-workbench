import { tool } from 'ai'
import { z } from 'zod'

export const helixQueryTool = tool({
  description:
    'Query HelixDB knowledge graph: semantic search papers/hypotheses, traverse concepts',
  inputSchema: z.object({
    queryType: z.enum(['searchPapers', 'searchHypotheses', 'getRelatedConcepts']),
    params: z.record(z.string(), z.unknown()),
  }),
  outputSchema: z.object({
    results: z.array(z.record(z.string(), z.unknown())),
  }),
  execute: async ({ queryType, params }) => {
    // 实际实现调 packages/helix client
    throw new Error(
      `helixQueryTool.execute not implemented: ${queryType} ${JSON.stringify(params)}`,
    )
  },
})
