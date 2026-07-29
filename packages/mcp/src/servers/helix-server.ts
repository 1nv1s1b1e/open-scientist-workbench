import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'

import {
  addCritique,
  addEvidence,
  addHypothesis,
  addMutationLink,
  addSnapshot,
  getCritiquesByHypothesis,
  getEvidenceByHypothesis,
  getEvolutionChain,
  getHypothesis,
  getLeaderboard,
  getRelatedConcepts,
  searchHypotheses,
  searchPapers,
} from '@open-scientist/helix'
import {
  asEnum,
  asNumber,
  asString,
  asStringArray,
  arrStr,
  errorResult,
  getArg,
  int,
  num,
  str,
  textResult,
} from './_helpers.ts'

// ------------------------------------------------------------
// JSON Schema 工具定义（MCP 协议用 JSON Schema，不用 zod）
// ------------------------------------------------------------

const TOOLS: Tool[] = [
  {
    name: 'search_papers',
    description:
      'Search solar physics papers in the HelixDB knowledge graph by semantic text query.',
    inputSchema: {
      type: 'object',
      properties: { query: str('Free-text search query'), k: int('Top-K results (default 10)') },
      required: ['query'],
    },
  },
  {
    name: 'search_hypotheses',
    description: 'Search existing hypotheses in HelixDB by semantic text query.',
    inputSchema: {
      type: 'object',
      properties: { query: str('Free-text search query'), k: int('Top-K results (default 10)') },
      required: ['query'],
    },
  },
  {
    name: 'get_hypothesis',
    description: 'Fetch a single hypothesis node by its numeric id.',
    inputSchema: {
      type: 'object',
      properties: { id: str('Hypothesis id (numeric, may be sent as string)') },
      required: ['id'],
    },
  },
  {
    name: 'get_evidence_by_hypothesis',
    description: 'List all evidence (supporting + contradicting) for a hypothesis.',
    inputSchema: {
      type: 'object',
      properties: { hypoId: str('Hypothesis id') },
      required: ['hypoId'],
    },
  },
  {
    name: 'get_critiques_by_hypothesis',
    description: 'List all critiques attached to a hypothesis.',
    inputSchema: {
      type: 'object',
      properties: { hypoId: str('Hypothesis id') },
      required: ['hypoId'],
    },
  },
  {
    name: 'get_related_concepts',
    description: 'List Concept nodes related to a hypothesis.',
    inputSchema: {
      type: 'object',
      properties: { hypoId: str('Hypothesis id') },
      required: ['hypoId'],
    },
  },
  {
    name: 'get_leaderboard',
    description: 'Top-K hypotheses for a given run, sorted by F1 score.',
    inputSchema: {
      type: 'object',
      properties: { runId: str('Run id'), k: int('Top-K results (default 10)') },
      required: ['runId'],
    },
  },
  {
    name: 'get_evolution_chain',
    description: 'Trace the mutation chain backwards from a hypothesis to its ancestors.',
    inputSchema: {
      type: 'object',
      properties: { hypoId: str('Hypothesis id') },
      required: ['hypoId'],
    },
  },
  {
    name: 'add_hypothesis',
    description: 'Persist a new hypothesis node to HelixDB (no edges — use add_mutation_link).',
    inputSchema: {
      type: 'object',
      properties: {
        statement: str('Hypothesis statement text'),
        roundId: int('Tournament round id'),
        runId: str('Run id'),
        f1Score: num('F1 score'),
        createdAt: str('ISO 8601 timestamp'),
      },
      required: ['statement', 'roundId', 'runId', 'f1Score', 'createdAt'],
    },
  },
  {
    name: 'add_evidence',
    description: 'Attach a supporting or contradicting evidence node to a hypothesis.',
    inputSchema: {
      type: 'object',
      properties: {
        hypoId: str('Hypothesis id'),
        type: { type: 'string', enum: ['support', 'contradict'], description: 'Evidence polarity' },
        content: str('Evidence description'),
        f1Score: num('F1 score assigned by Explore'),
        fitsPaths: arrStr('List of FITS file paths backing this evidence'),
        videoPath: str('Optional MP4 video path'),
        createdAt: str('ISO 8601 timestamp'),
      },
      required: ['hypoId', 'type', 'content', 'f1Score', 'fitsPaths', 'createdAt'],
    },
  },
  {
    name: 'add_critique',
    description: 'Attach a critique node to a hypothesis.',
    inputSchema: {
      type: 'object',
      properties: {
        hypoId: str('Hypothesis id'),
        content: str('Critique text'),
        severity: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Severity level',
        },
        mutationType: str('Optional mutation type label'),
        createdAt: str('ISO 8601 timestamp'),
      },
      required: ['hypoId', 'content', 'severity', 'createdAt'],
    },
  },
  {
    name: 'add_mutation_link',
    description: 'Create a MUTATED_FROM edge between two hypotheses.',
    inputSchema: {
      type: 'object',
      properties: {
        fromHypoId: str('New hypothesis id'),
        toHypoId: str('Ancestor hypothesis id'),
        mutationType: str('Mutation type label'),
      },
      required: ['fromHypoId', 'toHypoId', 'mutationType'],
    },
  },
  {
    name: 'add_snapshot',
    description: 'Persist a round snapshot (list of hypothesis ids captured in a round).',
    inputSchema: {
      type: 'object',
      properties: {
        roundId: int('Round id'),
        runId: str('Run id'),
        hypothesisIds: arrStr('List of hypothesis ids in this snapshot'),
        createdAt: str('ISO 8601 timestamp'),
      },
      required: ['roundId', 'runId', 'hypothesisIds', 'createdAt'],
    },
  },
]

// ------------------------------------------------------------
// Tool dispatch
// ------------------------------------------------------------

async function dispatch(name: string, args: Record<string, unknown> | undefined): Promise<unknown> {
  const a = args ?? {}
  switch (name) {
    case 'search_papers':
      return textResult(
        await searchPapers(asString(getArg(a, 'query'), 'query'), asNumber(a.k ?? 10, 'k')),
      )
    case 'search_hypotheses':
      return textResult(
        await searchHypotheses(asString(getArg(a, 'query'), 'query'), asNumber(a.k ?? 10, 'k')),
      )
    case 'get_hypothesis':
      return textResult(await getHypothesis(asString(getArg(a, 'id'), 'id')))
    case 'get_evidence_by_hypothesis':
      return textResult(await getEvidenceByHypothesis(asString(getArg(a, 'hypoId'), 'hypoId')))
    case 'get_critiques_by_hypothesis':
      return textResult(await getCritiquesByHypothesis(asString(getArg(a, 'hypoId'), 'hypoId')))
    case 'get_related_concepts':
      return textResult(await getRelatedConcepts(asString(getArg(a, 'hypoId'), 'hypoId')))
    case 'get_leaderboard':
      return textResult(
        await getLeaderboard(asString(getArg(a, 'runId'), 'runId'), asNumber(a.k ?? 10, 'k')),
      )
    case 'get_evolution_chain':
      return textResult(await getEvolutionChain(asString(getArg(a, 'hypoId'), 'hypoId')))
    case 'add_hypothesis':
      await addHypothesis({
        statement: asString(getArg(a, 'statement'), 'statement'),
        roundId: asNumber(getArg(a, 'roundId'), 'roundId'),
        runId: asString(getArg(a, 'runId'), 'runId'),
        f1Score: asNumber(getArg(a, 'f1Score'), 'f1Score'),
        createdAt: asString(getArg(a, 'createdAt'), 'createdAt'),
      })
      return textResult({ ok: true })
    case 'add_evidence':
      await addEvidence({
        hypoId: asString(getArg(a, 'hypoId'), 'hypoId'),
        type: asEnum(getArg(a, 'type'), 'type', ['support', 'contradict']),
        content: asString(getArg(a, 'content'), 'content'),
        f1Score: asNumber(getArg(a, 'f1Score'), 'f1Score'),
        fitsPaths: asStringArray(getArg(a, 'fitsPaths'), 'fitsPaths'),
        videoPath: typeof a.videoPath === 'string' ? a.videoPath : null,
        createdAt: asString(getArg(a, 'createdAt'), 'createdAt'),
      })
      return textResult({ ok: true })
    case 'add_critique':
      await addCritique({
        hypoId: asString(getArg(a, 'hypoId'), 'hypoId'),
        content: asString(getArg(a, 'content'), 'content'),
        severity: asEnum(getArg(a, 'severity'), 'severity', ['low', 'medium', 'high']),
        mutationType: typeof a.mutationType === 'string' ? a.mutationType : null,
        createdAt: asString(getArg(a, 'createdAt'), 'createdAt'),
      })
      return textResult({ ok: true })
    case 'add_mutation_link':
      await addMutationLink({
        fromHypoId: asString(getArg(a, 'fromHypoId'), 'fromHypoId'),
        toHypoId: asString(getArg(a, 'toHypoId'), 'toHypoId'),
        mutationType: asString(getArg(a, 'mutationType'), 'mutationType'),
      })
      return textResult({ ok: true })
    case 'add_snapshot':
      await addSnapshot({
        roundId: asNumber(getArg(a, 'roundId'), 'roundId'),
        runId: asString(getArg(a, 'runId'), 'runId'),
        hypothesisIds: asStringArray(getArg(a, 'hypothesisIds'), 'hypothesisIds'),
        createdAt: asString(getArg(a, 'createdAt'), 'createdAt'),
      })
      return textResult({ ok: true })
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ------------------------------------------------------------
// Server factory
// ------------------------------------------------------------

export function createHelixServer(): Server {
  const server = new Server(
    { name: 'helix-mcp', version: '0.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params
    const args =
      rawArgs && typeof rawArgs === 'object' ? (rawArgs as Record<string, unknown>) : undefined
    try {
      return (await dispatch(name, args)) as CallToolResult
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return errorResult(`helix-mcp tool '${name}' failed: ${message}`)
    }
  })

  return server
}

export async function startHelixServer(): Promise<void> {
  const server = createHelixServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
