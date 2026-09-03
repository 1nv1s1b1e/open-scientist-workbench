import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  MAX_BYTES,
  MAX_LINES,
  type SpawnFn,
  type SpawnedProcess,
  execCommand,
  resolveWithinWorkspace,
  truncateTail,
} from '../src/bash.ts'

// ─── fake spawn infrastructure ───────────────────────────────────────────────

interface FakeSpawnCalls {
  command: string
  args: readonly string[]
  options: Record<string, unknown>
}

class FakeChildProcess extends EventEmitter implements SpawnedProcess {
  pid: number | undefined
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  killed = false
  killSignal?: NodeJS.Signals | number

  constructor(pid = 99999) {
    super()
    this.pid = pid
    this.stdout = new EventEmitter() as unknown as NodeJS.ReadableStream
    this.stderr = new EventEmitter() as unknown as NodeJS.ReadableStream
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true
    this.killSignal = signal
    return true
  }

  emitStdout(data: Buffer | string): void {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data
    ;(this.stdout as EventEmitter).emit('data', buf)
  }

  emitStderr(data: Buffer | string): void {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data
    ;(this.stderr as EventEmitter).emit('data', buf)
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('exit', code, signal)
  }

  emitError(err: Error): void {
    this.emit('error', err)
  }
}

/**
 * Create a fake spawn function. The `onSpawn` callback is deferred via
 * `queueMicrotask` so that `execCommand`'s event listeners are attached
 * before any events fire — mirroring real `child_process.spawn` semantics
 * where events are never emitted synchronously during the spawn call.
 */
function createFakeSpawn(
  handlers: {
    onSpawn?: (child: FakeChildProcess, call: FakeSpawnCalls) => void
    onKill?: (child: FakeChildProcess) => void
  } = {},
): { spawnFn: SpawnFn; calls: FakeSpawnCalls[]; lastChild: () => FakeChildProcess | undefined } {
  const calls: FakeSpawnCalls[] = []
  let lastChild: FakeChildProcess | undefined

  const spawnFn: SpawnFn = (command, args, options) => {
    const call: FakeSpawnCalls = { command, args, options: options as Record<string, unknown> }
    calls.push(call)
    const child = new FakeChildProcess()
    lastChild = child

    if (handlers.onKill) {
      const originalKill = child.kill.bind(child)
      child.kill = (signal?: NodeJS.Signals | number) => {
        handlers.onKill!(child)
        return originalKill(signal)
      }
    }

    if (handlers.onSpawn) {
      const fn = handlers.onSpawn
      queueMicrotask(() => fn(child, call))
    }

    return child
  }

  return {
    spawnFn,
    calls,
    lastChild: () => lastChild,
  }
}

const TEST_CWD = '/fake/workspace'
const FAKE_PID = 99999

// ─── truncateTail tests ──────────────────────────────────────────────────────

describe('truncateTail', () => {
  it('returns content unchanged when within both byte and line limits', () => {
    const text = 'hello world\n'.repeat(10)
    const result = truncateTail(text)
    expect(result.truncated).toBe(false)
    expect(result.content).toBe(text)
  })

  it('returns empty string unchanged', () => {
    const result = truncateTail('')
    expect(result.truncated).toBe(false)
    expect(result.content).toBe('')
  })

  it('truncates when exceeding MAX_LINES, keeping the newest lines', () => {
    const lines: string[] = []
    for (let i = 0; i < MAX_LINES + 500; i++) {
      lines.push(`line-${i}`)
    }
    const text = lines.join('\n')

    const result = truncateTail(text)
    expect(result.truncated).toBe(true)

    const resultLines = result.content.split('\n')
    expect(resultLines.length).toBe(MAX_LINES)
    expect(resultLines[0]).toBe(`line-500`)
    expect(resultLines[resultLines.length - 1]).toBe(`line-${MAX_LINES + 499}`)
  })

  it('truncates when exceeding MAX_BYTES, keeping the newest bytes', () => {
    const chunk = 'x'.repeat(1000)
    const text = chunk.repeat(60)

    const result = truncateTail(text)
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.content, 'utf-8')).toBeLessThanOrEqual(MAX_BYTES)
    expect(result.content.endsWith(chunk)).toBe(true)
  })

  it('handles a single very long line exceeding MAX_BYTES', () => {
    const text = 'a'.repeat(MAX_BYTES + 5000)

    const result = truncateTail(text)
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.content, 'utf-8')).toBeLessThanOrEqual(MAX_BYTES)
    expect(result.content).toBe('a'.repeat(MAX_BYTES))
  })

  it('does not split multi-byte UTF-8 codepoints at the byte boundary', () => {
    const emoji = '\uD83D\uDE00'
    expect(Buffer.byteLength(emoji, 'utf-8')).toBe(4)

    const text = 'a'.repeat(10) + emoji + 'a'.repeat(MAX_BYTES - 2)

    const result = truncateTail(text)
    expect(result.truncated).toBe(true)

    const buf = Buffer.from(result.content, 'utf-8')
    expect(buf.length).toBeLessThanOrEqual(MAX_BYTES)
    expect(result.content).not.toContain('\uFFFD')
  })

  it('produces valid UTF-8 when truncating text with multi-byte chars throughout', () => {
    const emoji = '\uD83D\uDE00'
    const lines: string[] = []
    for (let i = 0; i < MAX_LINES + 100; i++) {
      lines.push(`${emoji} line ${i} ${emoji}`)
    }
    const text = lines.join('\n')

    const result = truncateTail(text)
    expect(result.truncated).toBe(true)

    const buf = Buffer.from(result.content, 'utf-8')
    expect(buf.length).toBeLessThanOrEqual(MAX_BYTES)
    expect(result.content).not.toContain('\uFFFD')
  })
})

// ─── resolveWithinWorkspace tests ────────────────────────────────────────────

describe('resolveWithinWorkspace', () => {
  const cwd = '/fake/workspace'

  it('accepts a simple relative path', () => {
    const resolved = resolveWithinWorkspace(cwd, 'script.py')
    expect(resolved).toBe(resolve(cwd, 'script.py'))
  })

  it('accepts a nested relative path within the workspace', () => {
    const resolved = resolveWithinWorkspace(cwd, 'subdir/deep/file.txt')
    expect(resolved).toBe(resolve(cwd, 'subdir', 'deep', 'file.txt'))
  })

  it('accepts a path that normalizes to the cwd itself', () => {
    const resolved = resolveWithinWorkspace(cwd, '.')
    expect(resolved).toBe(resolve(cwd))
  })

  it('accepts a path with redundant ./ segments', () => {
    const resolved = resolveWithinWorkspace(cwd, './subdir/./file.txt')
    expect(resolved).toBe(resolve(cwd, 'subdir', 'file.txt'))
  })

  it('rejects an absolute path outside the workspace', () => {
    expect(() => resolveWithinWorkspace(cwd, '/etc/passwd')).toThrow(
      /resolves outside the workspace/,
    )
  })

  it('accepts an absolute path that is inside the workspace', () => {
    const abs = join(cwd, 'file.txt')
    const resolved = resolveWithinWorkspace(cwd, abs)
    expect(resolved).toBe(resolve(abs))
  })

  it('rejects .. traversal escaping the workspace', () => {
    expect(() => resolveWithinWorkspace(cwd, '../secret.txt')).toThrow(
      /resolves outside the workspace/,
    )
  })

  it('rejects nested .. traversal escaping the workspace', () => {
    expect(() => resolveWithinWorkspace(cwd, 'subdir/../../secret.txt')).toThrow(
      /resolves outside the workspace/,
    )
  })

  it('rejects .. traversal that targets the parent of the workspace', () => {
    expect(() => resolveWithinWorkspace(cwd, '..')).toThrow(/resolves outside the workspace/)
  })

  it('accepts .. that stays within the workspace via re-entry', () => {
    const resolved = resolveWithinWorkspace(cwd, 'subdir/../file.txt')
    expect(resolved).toBe(resolve(cwd, 'file.txt'))
  })
})

// ─── execCommand with fake spawn tests ───────────────────────────────────────

describe('execCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('collects stdout and stderr from data events and resolves with exit code', async () => {
    const { spawnFn, lastChild } = createFakeSpawn({
      onSpawn: (child) => {
        child.emitStdout('hello ')
        child.emitStdout('world\n')
        child.emitStderr('warning\n')
        child.emitExit(0)
      },
    })

    const result = await execCommand('echo hello', { cwd: TEST_CWD }, spawnFn)

    expect(result.stdout).toBe('hello world\n')
    expect(result.stderr).toBe('warning\n')
    expect(result.exitCode).toBe(0)
    expect(lastChild()?.killed).toBe(false)
  })

  it('resolves with exitCode null when process exits with a signal', async () => {
    const { spawnFn } = createFakeSpawn({
      onSpawn: (child) => {
        child.emitExit(null, 'SIGTERM')
      },
    })

    const result = await execCommand('kill', { cwd: TEST_CWD }, spawnFn)

    expect(result.exitCode).toBe(null)
  })

  it('resolves with exitCode 0 when process exits with code 0 and no signal', async () => {
    const { spawnFn } = createFakeSpawn({
      onSpawn: (child) => {
        child.emitExit(0, null)
      },
    })

    const result = await execCommand('true', { cwd: TEST_CWD }, spawnFn)

    expect(result.exitCode).toBe(0)
  })

  it('handles spawn error event', async () => {
    const { spawnFn } = createFakeSpawn({
      onSpawn: (child) => {
        child.emitError(new Error('ENOENT: command not found'))
      },
    })

    const result = await execCommand('nonexistent-cmd', { cwd: TEST_CWD }, spawnFn)

    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('ENOENT: command not found')
    expect(result.stderr).toContain('[failed to spawn process]')
    expect(result.exitCode).toBe(null)
  })

  it('kills the process and appends timeout message when timeout fires', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const { spawnFn, lastChild } = createFakeSpawn()

    const promise = execCommand('sleep 999', { cwd: TEST_CWD, timeoutMs: 5000 }, spawnFn)

    vi.advanceTimersByTime(5000)

    if (process.platform !== 'win32') {
      expect(killSpy).toHaveBeenCalledWith(-FAKE_PID, 'SIGKILL')
    }

    lastChild()?.emitExit(null, 'SIGKILL')

    const result = await promise

    expect(result.exitCode).toBe(null)
    expect(result.stderr).toContain('[timeout after 5s]')
  })

  it('does not fire timeout if process exits before the timer', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const { spawnFn, lastChild } = createFakeSpawn({
      onSpawn: (child) => {
        child.emitStdout('done\n')
        child.emitExit(0)
      },
    })

    const promise = execCommand('fast-cmd', { cwd: TEST_CWD, timeoutMs: 5000 }, spawnFn)
    const result = await promise

    vi.advanceTimersByTime(10000)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('done\n')
    expect(lastChild()?.killed).toBe(false)
    expect(killSpy).not.toHaveBeenCalled()
  })

  it('kills the process and appends aborted message when AbortSignal fires', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const { spawnFn, lastChild } = createFakeSpawn()

    const controller = new AbortController()
    const promise = execCommand(
      'long-running',
      { cwd: TEST_CWD, signal: controller.signal },
      spawnFn,
    )

    controller.abort()

    if (process.platform !== 'win32') {
      expect(killSpy).toHaveBeenCalledWith(-FAKE_PID, 'SIGKILL')
    }

    lastChild()?.emitExit(null, 'SIGKILL')

    const result = await promise

    expect(result.exitCode).toBe(null)
    expect(result.stderr).toContain('[aborted]')
  })

  it('truncates stdout output exceeding MAX_BYTES', async () => {
    const largeOutput = 'x'.repeat(MAX_BYTES + 10000)

    const { spawnFn } = createFakeSpawn({
      onSpawn: (child) => {
        child.emitStdout(largeOutput)
        child.emitExit(0)
      },
    })

    const result = await execCommand('big-output', { cwd: TEST_CWD }, spawnFn)

    expect(Buffer.byteLength(result.stdout, 'utf-8')).toBeLessThanOrEqual(MAX_BYTES)
    expect(result.stdout.endsWith('xxxx')).toBe(true)
  })

  it('truncates stderr output exceeding MAX_LINES', async () => {
    const lines: string[] = []
    for (let i = 0; i < MAX_LINES + 500; i++) {
      lines.push(`err-line-${i}`)
    }
    const largeStderr = lines.join('\n')

    const { spawnFn } = createFakeSpawn({
      onSpawn: (child) => {
        child.emitStderr(largeStderr)
        child.emitExit(1)
      },
    })

    const result = await execCommand('big-stderr', { cwd: TEST_CWD }, spawnFn)

    const stderrLines = result.stderr.split('\n')
    expect(stderrLines.length).toBeLessThanOrEqual(MAX_LINES + 1)
    expect(result.exitCode).toBe(1)
  })

  it('passes the shell and command as arguments to spawnFn', async () => {
    const { spawnFn, calls } = createFakeSpawn({
      onSpawn: (child) => child.emitExit(0),
    })

    await execCommand('echo hello', { cwd: TEST_CWD }, spawnFn)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.command).toBeTruthy()
    expect(calls[0]!.args).toContain('echo hello')
    expect(calls[0]!.options.cwd).toBe(TEST_CWD)
  })

  it('only resolves once even if exit and error both fire', async () => {
    const { spawnFn } = createFakeSpawn({
      onSpawn: (child) => {
        child.emitExit(0)
        child.emitError(new Error('late error'))
      },
    })

    const result = await execCommand('double-event', { cwd: TEST_CWD }, spawnFn)

    expect(result.exitCode).toBe(0)
  })

  it('clears the timeout timer so it does not fire after normal exit', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const { spawnFn } = createFakeSpawn({
      onSpawn: (child) => {
        child.emitStdout('ok\n')
        child.emitExit(0)
      },
    })

    const result = await execCommand('ok-cmd', { cwd: TEST_CWD, timeoutMs: 1000 }, spawnFn)

    vi.advanceTimersByTime(5000)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).not.toContain('[timeout')
    expect(killSpy).not.toHaveBeenCalled()
  })
})

// ─── createBashToolForHypothesis integration (fake spawn) ────────────────────

describe('createBashToolForHypothesis with fake spawn', () => {
  let tmpBase: string

  beforeEach(() => {
    vi.useFakeTimers()
    tmpBase = mkdtempSync(join(tmpdir(), 'os-bash-test-'))
    process.env.BASE_DIR = tmpBase
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete process.env.BASE_DIR
    rmSync(tmpBase, { recursive: true, force: true })
  })

  it('creates the workspace directory and uses the injected spawnFn', async () => {
    const { spawnFn, calls } = createFakeSpawn({
      onSpawn: (child) => {
        child.emitStdout('result\n')
        child.emitExit(0)
      },
    })

    const { createBashToolForHypothesis } = await import('../src/bash.ts')
    const toolkit = await createBashToolForHypothesis('test-proj', 'run-1', 'h-1', spawnFn)

    const bashTool = toolkit.tools.bash as unknown as {
      execute: (
        args: { command: string },
        options?: { abortSignal?: AbortSignal },
      ) => Promise<{ stdout: string; exitCode: number | null }>
    }

    const result = await bashTool.execute({ command: 'echo result' }, { abortSignal: undefined })

    expect(result.stdout).toBe('result\n')
    expect(result.exitCode).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.options.cwd).toContain('test-proj')
  })

  it('blocks direct command-line access to evaluator ground-truth targets', async () => {
    const { spawnFn, calls } = createFakeSpawn({
      onSpawn: (child) => child.emitExit(0),
    })

    const { createBashToolForHypothesis } = await import('../src/bash.ts')
    const toolkit = await createBashToolForHypothesis('test-proj', 'run-1', 'h-1', spawnFn)
    const bashTool = toolkit.tools.bash as unknown as {
      execute: (
        args: { command: string },
        options?: { abortSignal?: AbortSignal },
      ) => Promise<unknown>
    }

    await expect(
      bashTool.execute(
        { command: 'python -c "print(open(\'C:/dataset/targets.jsonl\').read())"' },
        { abortSignal: undefined },
      ),
    ).rejects.toThrow('targets.jsonl')
    expect(calls).toHaveLength(0)
  })
})
