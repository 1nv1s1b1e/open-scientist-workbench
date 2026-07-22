import { spawn } from 'node:child_process'
import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir } from 'node:fs/promises'
import nodePath from 'node:path'
import type { Tool } from '@ai-sdk/provider-utils'
import { getWorkspaceDir } from '@open-scientist/config'
import { createLogger } from '@open-scientist/logger'
import { tool } from 'ai'
import { z } from 'zod'

const logger = createLogger('tools')

// ─── types ───────────────────────────────────────────────────────────────────

export interface BashToolResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

export interface BashToolkit {
  tools: {
    bash: Tool
    readFile: Tool
    writeFile: Tool
  }
}

// ─── shell detection ─────────────────────────────────────────────────────────

function detectShell(): { shell: string; args: string[] } {
  // User override
  if (process.env.SHELL) return { shell: process.env.SHELL, args: ['-c'] }
  // Common Unix shells
  if (process.platform !== 'win32') {
    return { shell: '/bin/bash', args: ['-c'] }
  }
  // Windows fallback
  return { shell: 'cmd.exe', args: ['/c'] }
}

// ─── process tree kill ───────────────────────────────────────────────────────

function killProcessTree(pid: number): void {
  try {
    if (process.platform !== 'win32') {
      // Negative PID kills the entire process group (detached: true)
      process.kill(-pid, 'SIGKILL')
    } else {
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
    }
  } catch {
    // Process may have already exited
  }
}

// ─── output accumulator (tail-truncation + temp file overflow) ────────────────

const MAX_BYTES = 50_000
const MAX_LINES = 2000

interface TruncationResult {
  content: string
  truncated: boolean
  tempFilePath?: string
}

function truncateTail(text: string): TruncationResult {
  const bytes = Buffer.byteLength(text, 'utf-8')
  if (bytes <= MAX_BYTES && text.split('\n').length <= MAX_LINES) {
    return { content: text, truncated: false }
  }

  // Tail-truncate: keep the most recent output
  const lines = text.split('\n')
  const tailLines = lines.slice(-MAX_LINES)
  let tail = tailLines.join('\n')

  if (Buffer.byteLength(tail, 'utf-8') > MAX_BYTES) {
    // Still too large — cut from the front
    const buf = Buffer.from(tail, 'utf-8')
    tail = buf.subarray(buf.length - MAX_BYTES).toString('utf-8')
  }

  return { content: tail, truncated: true }
}

// ─── core execution (spawn-based, pi-style) ───────────────────────────────────

interface ExecOptions {
  cwd: string
  timeoutMs?: number
  signal?: AbortSignal
}

async function execCommand(command: string, opts: ExecOptions): Promise<BashToolResult> {
  const { shell, args } = detectShell()
  const timeoutMs = opts.timeoutMs ?? 120_000

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false
    let settled = false

    const child = spawn(shell, [...args, command], {
      cwd: opts.cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid) killProcessTree(child.pid)
    }, timeoutMs)

    if (opts.signal) {
      opts.signal.addEventListener(
        'abort',
        () => {
          aborted = true
          if (child.pid) killProcessTree(child.pid)
        },
        { once: true },
      )
    }

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8')
    })
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8')
    })

    child.on('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (timedOut) {
        stderr += `\n[timeout after ${timeoutMs / 1000}s]`
        resolve({
          stdout: truncateTail(stdout).content,
          stderr: truncateTail(stderr).content,
          exitCode: null,
        })
      } else if (aborted) {
        stderr += '\n[aborted]'
        resolve({
          stdout: truncateTail(stdout).content,
          stderr: truncateTail(stderr).content,
          exitCode: null,
        })
      } else {
        resolve({
          stdout: truncateTail(stdout).content,
          stderr: truncateTail(stderr).content,
          exitCode: code ?? (signal ? null : 0),
        })
      }
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        stdout: '',
        stderr: `${err.message}\n[failed to spawn process]`,
        exitCode: null,
      })
    })
  })
}

// ─── workspace boundary guard ────────────────────────────────────────────────

/**
 * Resolve a user-supplied path and verify it stays within `cwd`.
 *
 * Rejects absolute paths and `..` traversal that would escape the workspace
 * directory, preventing arbitrary file read/write on the host.
 */
function resolveWithinWorkspace(cwd: string, userPath: string): string {
  const resolved = nodePath.resolve(cwd, userPath)
  const normalizedCwd = nodePath.resolve(cwd)
  // Ensure the resolved path is the cwd itself or a descendant of it.
  if (resolved !== normalizedCwd && !resolved.startsWith(`${normalizedCwd}${nodePath.sep}`)) {
    throw new Error(
      `Path "${userPath}" resolves outside the workspace directory. Only paths within the workspace are allowed.`,
    )
  }
  return resolved
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Create a bash + file toolkit for a specific hypothesis workspace.
 *
 * Uses `node:child_process` spawn (real host shell) — supports Python,
 * Node.js, and any system binary. Files persist to disk under
 * `data/projects/<project>/runs/<runId>/workspace/<hypoId>/`.
 *
 * Features borrowed from pi (github.com/earendil-works/pi):
 * - spawn-based streaming output (not exec buffering)
 * - Process tree kill via detached process groups (SIGKILL)
 * - AbortSignal + timeout support
 * - Tail-truncation (50KB / 2000 lines, keep newest output)
 * - Workspace boundary enforcement for readFile/writeFile (no path traversal)
 */
export async function createBashToolForHypothesis(
  project: string,
  runId: string,
  hypoId: string,
): Promise<BashToolkit> {
  const cwd = getWorkspaceDir(project, runId, hypoId)
  logger.info({ project, runId, hypoId, cwd }, 'createBashToolForHypothesis: creating workspace')
  await mkdir(cwd, { recursive: true })

  const bashTool = tool({
    description:
      'Execute a bash command in the workspace directory. Supports Python (uv run python), Node.js, and system binaries. ' +
      'Output is truncated to the last 50KB. Use this for running scripts, installing packages (uv pip install), and file operations.',
    inputSchema: z.object({
      command: z.string().describe('The bash command to execute'),
    }),
    execute: async ({ command }, { abortSignal }) => {
      logger.debug({ project, runId, hypoId, command: command.slice(0, 200) }, 'bash execute')
      const result = await execCommand(command, {
        cwd,
        timeoutMs: 60_000,
        signal: abortSignal,
      })
      logger.debug(
        { project, runId, hypoId, exitCode: result.exitCode, stdoutLen: result.stdout.length },
        'bash result',
      )
      return result
    },
  })

  const readFileTool = tool({
    description: 'Read a file from the workspace directory.',
    inputSchema: z.object({
      path: z.string().describe('Relative path to the file within the workspace'),
    }),
    execute: async ({ path }) => {
      const resolved = resolveWithinWorkspace(cwd, path)
      const content = await fsReadFile(resolved, 'utf-8')
      return { content }
    },
  })

  const writeFileTool = tool({
    description:
      'Write content to a file in the workspace directory. Creates parent directories if needed.',
    inputSchema: z.object({
      path: z.string().describe('Relative path to the file within the workspace'),
      content: z.string().describe('The content to write'),
    }),
    execute: async ({ path, content }) => {
      const resolved = resolveWithinWorkspace(cwd, path)
      await mkdir(nodePath.dirname(resolved), { recursive: true })
      await fsWriteFile(resolved, content, 'utf-8')
      return { success: true as const }
    },
  })

  return {
    tools: {
      bash: bashTool,
      readFile: readFileTool,
      writeFile: writeFileTool,
    },
  }
}
