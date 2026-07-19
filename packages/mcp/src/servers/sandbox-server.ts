import { exec } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'

const execAsync = promisify(exec)

// ------------------------------------------------------------
// Sandbox MCP server
//
// 直接 host child_process 执行（与 bash-tool 一致的隔离策略：靠 project name
// 隔离 working dir，无 Docker 沙箱 —— 用户明确决定，见 AGENTS.md）。让多个
// agent 通过 MCP 共享同一套代码执行环境。
// ------------------------------------------------------------

function str(desc: string) {
  return { type: 'string' as const, description: desc }
}

const TOOLS: Tool[] = [
  {
    name: 'bash',
    description:
      'Execute a shell command in the sandbox working dir (host child_process, no Docker).',
    inputSchema: {
      type: 'object',
      properties: {
        command: str('Shell command to execute'),
        workingDir: str('Working directory (defaults to process cwd)'),
        timeoutMs: { type: 'integer', description: 'Optional timeout in ms (default 60000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file from the sandbox.',
    inputSchema: {
      type: 'object',
      properties: { path: str('File path (absolute or relative to workingDir)') },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write a UTF-8 text file (creates parent directories).',
    inputSchema: {
      type: 'object',
      properties: {
        path: str('File path'),
        content: str('File content (UTF-8)'),
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: 'List entries in a directory.',
    inputSchema: {
      type: 'object',
      properties: { path: str('Directory path (defaults to workingDir)') },
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

interface BashResult {
  command: string
  cwd: string
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}

async function runBash(
  command: string,
  workingDir: string | undefined,
  timeoutMs: number | undefined,
): Promise<BashResult> {
  const cwd = workingDir ? resolve(workingDir) : process.cwd()
  const timeout = timeoutMs ?? 60_000
  const start = Date.now()
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    })
    return {
      command,
      cwd,
      stdout,
      stderr,
      exitCode: 0,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    return {
      command,
      cwd,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? String(err),
      exitCode: typeof e.code === 'number' ? e.code : -1,
      durationMs: Date.now() - start,
    }
  }
}

async function dispatch(name: string, args: Record<string, unknown> | undefined): Promise<unknown> {
  const a = args ?? {}
  switch (name) {
    case 'bash': {
      const command = asString(getArg(a, 'command'), 'command')
      const workingDir = typeof a.workingDir === 'string' ? a.workingDir : undefined
      const timeoutMs = typeof a.timeoutMs === 'number' ? a.timeoutMs : undefined
      const result = await runBash(command, workingDir, timeoutMs)
      return textResult(result)
    }
    case 'read_file': {
      const path = resolve(asString(getArg(a, 'path'), 'path'))
      const content = await readFile(path, 'utf-8')
      return textResult({ path, content })
    }
    case 'write_file': {
      const path = resolve(asString(getArg(a, 'path'), 'path'))
      const content = asString(getArg(a, 'content'), 'content')
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf-8')
      return textResult({ path, bytes: content.length })
    }
    case 'list_dir': {
      const path = resolve(asString(getArg(a, 'path'), 'path'))
      const entries = await readdir(path, { withFileTypes: true })
      return textResult({
        path,
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        })),
      })
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

export function createSandboxServer(): Server {
  const server = new Server(
    { name: 'sandbox-mcp', version: '0.0.0' },
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
      return errorResult(`sandbox-mcp tool '${name}' failed: ${message}`)
    }
  })

  return server
}

export async function startSandboxServer(): Promise<void> {
  const server = createSandboxServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
