import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  type CallToolResult,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import {
  assessCoronalDataCoverage,
  getCoronalObservationAsset,
  searchCoronalObservationCases,
  verifyCoronalDataPack,
  type CoronalRequirement,
} from '@open-scientist/tools'
import {
  asNumber,
  asString,
  asStringArray,
  errorResult,
  getArg,
  int,
  str,
  textResult,
} from './_helpers.ts'

const REQUIREMENTS = [
  'thermal-evolution',
  'magnetic-context',
  'wave-timescale',
  'spectroscopy',
  'simulation',
] as const

const TOOLS: Tool[] = [
  {
    name: 'list_local_observation_cases',
    description:
      'Search the verified local SDO coronal-observation pack by active region or natural-language cue. Returns bounded case coverage, never raw image pixels.',
    inputSchema: {
      type: 'object',
      properties: {
        activeRegion: str('Optional NOAA active-region identifier, for example 11158'),
        query: str('Optional phenomenon phrase used to match local case metadata'),
        limit: int('Maximum returned cases, 1 to 6; default 3'),
      },
    },
  },
  {
    name: 'check_local_observation_coverage',
    description:
      'Check whether a local case has verified coverage for thermal evolution, magnetic context, wave timescales, spectroscopy, or simulation. Missing diagnostics are returned as limitations.',
    inputSchema: {
      type: 'object',
      properties: {
        activeRegion: str('Optional NOAA active-region identifier'),
        query: str('Optional phenomenon phrase'),
        caseId: str('Optional exact local case id'),
        requirements: {
          type: 'array',
          items: { type: 'string', enum: [...REQUIREMENTS] },
          description: 'Requested diagnostic requirements',
        },
      },
    },
  },
  {
    name: 'get_local_observation_asset',
    description:
      'Read provenance for one manifest-backed FITS asset. The asset id must come from a prior local-case response.',
    inputSchema: {
      type: 'object',
      properties: { assetId: str('Manifest asset id') },
      required: ['assetId'],
    },
  },
  {
    name: 'verify_local_observation_pack',
    description:
      'Verify local manifest status and file-size presence for the bounded coronal observation pack. Read-only; no network or writes.',
    inputSchema: { type: 'object', properties: {} },
  },
]

function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined
  return asString(value, key)
}

function requirements(value: unknown): CoronalRequirement[] | undefined {
  if (value === undefined) return undefined
  const values = asStringArray(value as string[], 'requirements')
  for (const item of values) {
    if (!REQUIREMENTS.includes(item as CoronalRequirement)) {
      throw new TypeError(`'requirements' contains unsupported diagnostic: ${item}`)
    }
  }
  return values as CoronalRequirement[]
}

async function dispatch(name: string, args: Record<string, unknown> | undefined): Promise<unknown> {
  const input = args ?? {}
  switch (name) {
    case 'list_local_observation_cases': {
      const limit = input.limit === undefined ? undefined : asNumber(input.limit, 'limit')
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 6)) {
        throw new RangeError("'limit' must be an integer from 1 to 6")
      }
      return textResult(
        await searchCoronalObservationCases({
          activeRegion: optionalString(getArg(input, 'activeRegion'), 'activeRegion'),
          query: optionalString(getArg(input, 'query'), 'query'),
          ...(limit === undefined ? {} : { limit }),
        }),
      )
    }
    case 'check_local_observation_coverage':
      return textResult(
        await assessCoronalDataCoverage({
          activeRegion: optionalString(getArg(input, 'activeRegion'), 'activeRegion'),
          query: optionalString(getArg(input, 'query'), 'query'),
          caseId: optionalString(getArg(input, 'caseId'), 'caseId'),
          requirements: requirements(getArg(input, 'requirements')),
        }),
      )
    case 'get_local_observation_asset': {
      const asset = await getCoronalObservationAsset({
        assetId: asString(getArg(input, 'assetId'), 'assetId'),
      })
      if (!asset) throw new Error('Unknown local observation asset id')
      return textResult(asset)
    }
    case 'verify_local_observation_pack':
      return textResult(await verifyCoronalDataPack())
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

export function createSolarDataServer(): Server {
  const server = new Server(
    { name: 'solar-data-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const rawArgs = request.params.arguments
    const args =
      rawArgs && typeof rawArgs === 'object' ? (rawArgs as Record<string, unknown>) : undefined
    try {
      return (await dispatch(request.params.name, args)) as CallToolResult
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return errorResult(`solar-data-mcp tool '${request.params.name}' failed: ${message}`)
    }
  })
  return server
}

export async function startSolarDataServer(): Promise<void> {
  const server = createSolarDataServer()
  await server.connect(new StdioServerTransport())
}
