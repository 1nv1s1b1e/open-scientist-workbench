import { describe, expect, it, vi } from 'vite-plus/test'
import type { McpServerConfig } from '../src/registry.ts'

// Mock StdioClientTransport so the stdio branch doesn't spawn a real process.
// We capture the constructor args for assertion.
const stdioInstances: Array<{ command?: string; args?: string[] }> = []
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  return {
    StdioClientTransport: class {
      command?: string
      args?: string[]
      constructor(opts: { command?: string; args?: string[] }) {
        this.command = opts.command
        this.args = opts.args
        stdioInstances.push({ command: opts.command, args: opts.args })
      }
    },
  }
})

// Import AFTER the mock is registered so registry.ts picks up the mock.
const { resolveTransport } = await import('../src/registry.ts')

describe('resolveTransport', () => {
  it('returns an http transport descriptor for transport="http"', () => {
    const server: McpServerConfig = {
      name: 'http-srv',
      transport: 'http',
      url: 'http://localhost:8080/mcp',
      headers: { Authorization: 'Bearer x' },
    }
    const t = resolveTransport(server) as {
      type: string
      url: string
      headers?: Record<string, string>
    }
    expect(t.type).toBe('http')
    expect(t.url).toBe('http://localhost:8080/mcp')
    expect(t.headers).toEqual({ Authorization: 'Bearer x' })
  })

  it('returns an sse transport descriptor for transport="sse"', () => {
    const server: McpServerConfig = {
      name: 'sse-srv',
      transport: 'sse',
      url: 'http://localhost:8081/sse',
    }
    const t = resolveTransport(server) as {
      type: string
      url: string
      headers?: Record<string, string>
    }
    expect(t.type).toBe('sse')
    expect(t.url).toBe('http://localhost:8081/sse')
    // headers undefined when not supplied
    expect(t.headers).toBeUndefined()
  })

  it('constructs a StdioClientTransport for transport="stdio" with command + args', () => {
    stdioInstances.length = 0
    const server: McpServerConfig = {
      name: 'stdio-srv',
      transport: 'stdio',
      command: 'node',
      args: ['server.js', '--port', '9000'],
    }
    const t = resolveTransport(server)
    // stdio returns a transport object (the mocked StdioClientTransport instance),
    // NOT a { type: 'stdio' } descriptor.
    expect(t).toBeDefined()
    expect(typeof t).toBe('object')
    expect((t as { type?: string }).type).toBeUndefined()
    expect(stdioInstances).toHaveLength(1)
    expect(stdioInstances[0]?.command).toBe('node')
    expect(stdioInstances[0]?.args).toEqual(['server.js', '--port', '9000'])
  })

  it('stdio branch defaults args to [] when not supplied', () => {
    stdioInstances.length = 0
    const server: McpServerConfig = {
      name: 'stdio-no-args',
      transport: 'stdio',
      command: 'python',
    }
    resolveTransport(server)
    expect(stdioInstances).toHaveLength(1)
    expect(stdioInstances[0]?.command).toBe('python')
    expect(stdioInstances[0]?.args).toEqual([])
  })
})
