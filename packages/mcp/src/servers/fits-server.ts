import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'

// ------------------------------------------------------------
// FITS MCP server
//
// Python 科学栈（astropy / sunpy）在当前 Node runtime 不可用。
// `align_fits` / `read_fits_header` 是 informative stub —— 它们向调用方
// 返回安装提示而非真实数据。`list_fits_files` 直接读 FS，可独立运行。
// 将来若引入 Python 子进程桥接，只需替换对应分支即可，MCP tool 接口不变。
// ------------------------------------------------------------

function str(desc: string) {
  return { type: 'string' as const, description: desc }
}

const ASTROPY_STUB_MSG =
  'FITS processing requires Python with astropy + sunpy installed. ' +
  'Install: `pip install astropy sunpy` and re-run with the Python bridge configured. ' +
  'This MCP server currently exposes only filesystem listing.'

const TOOLS: Tool[] = [
  {
    name: 'align_fits',
    description:
      'Align a FITS image observation to a hypothesis evidence record (stub: astropy/sunpy not installed).',
    inputSchema: {
      type: 'object',
      properties: {
        hypoId: str('Hypothesis id this evidence belongs to'),
        activeRegion: str('Solar active region identifier (e.g. NOAA AR 13664)'),
        timestamp: str('ISO 8601 observation timestamp'),
        wavelength: str('Observation wavelength (e.g. 171Å / 211Å)'),
      },
      required: ['hypoId', 'activeRegion', 'timestamp', 'wavelength'],
    },
  },
  {
    name: 'list_fits_files',
    description: 'List files (optionally filtered by extension) in a directory.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: str('Absolute or project-relative directory path'),
        extension: str('Optional extension filter (e.g. ".fits")'),
      },
      required: ['directory'],
    },
  },
  {
    name: 'read_fits_header',
    description: 'Read the header of a FITS file (stub: requires astropy).',
    inputSchema: {
      type: 'object',
      properties: { path: str('Path to the .fits file') },
      required: ['path'],
    },
  },
]

function textResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function asString(v: unknown, key: string): string {
  if (typeof v !== 'string') throw new TypeError(`'${key}' must be a string`)
  return v
}

function getArg(args: Record<string, unknown> | undefined, key: string): unknown {
  return args?.[key]
}

async function dispatch(name: string, args: Record<string, unknown> | undefined): Promise<unknown> {
  const a = args ?? {}
  switch (name) {
    case 'align_fits':
      return textResult({
        ok: false,
        stub: true,
        message: ASTROPY_STUB_MSG,
        echo: {
          hypoId: getArg(a, 'hypoId'),
          activeRegion: getArg(a, 'activeRegion'),
          timestamp: getArg(a, 'timestamp'),
          wavelength: getArg(a, 'wavelength'),
        },
      })
    case 'list_fits_files': {
      const dir = resolve(asString(getArg(a, 'directory'), 'directory'))
      const ext = typeof a.extension === 'string' ? a.extension.toLowerCase() : null
      const entries = await readdir(dir, { withFileTypes: true })
      const files = entries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .filter((name) => (ext ? name.toLowerCase().endsWith(ext) : true))
      return textResult({ directory: dir, files })
    }
    case 'read_fits_header':
      return textResult({
        ok: false,
        stub: true,
        path: asString(getArg(a, 'path'), 'path'),
        message: ASTROPY_STUB_MSG,
      })
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

export function createFitsServer(): Server {
  const server = new Server({ name: 'fits-mcp', version: '0.0.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params
    const args =
      rawArgs && typeof rawArgs === 'object' ? (rawArgs as Record<string, unknown>) : undefined
    try {
      return (await dispatch(name, args)) as CallToolResult
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return errorResult(`fits-mcp tool '${name}' failed: ${message}`)
    }
  })

  return server
}

export async function startFitsServer(): Promise<void> {
  const server = createFitsServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
