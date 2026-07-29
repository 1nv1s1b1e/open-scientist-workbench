import {
  createMCPClient,
  type MCPClient,
  type MCPClientConfig,
  type MCPTransport,
} from '@ai-sdk/mcp'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpServerConfig } from '@open-scientist/schema'

/**
 * MCP client cache keyed by `projectName:serverName`. Using the composite key
 * (not just `server.name`) ensures that two projects sharing a server name
 * get distinct clients, and that reconfiguring a server within a project
 * invalidates the stale entry.
 */
const clients = new Map<string, MCPClient>()

function cacheKey(projectName: string, serverName: string): string {
  return `${projectName}:${serverName}`
}

export function resolveTransport(server: McpServerConfig): MCPClientConfig['transport'] {
  if (server.transport === 'http') {
    if (!server.url) throw new Error(`MCP server "${server.name}": transport 'http' requires a url`)
    return { type: 'http', url: server.url, headers: server.headers }
  }
  if (server.transport === 'sse') {
    if (!server.url) throw new Error(`MCP server "${server.name}": transport 'sse' requires a url`)
    return { type: 'sse', url: server.url, headers: server.headers }
  }
  if (!server.command)
    throw new Error(`MCP server "${server.name}": transport 'stdio' requires a command`)
  const stdio: MCPTransport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
  })
  return stdio
}

/**
 * Connect to an MCP server (or return cached tools). MCP servers are trusted
 * automatically — no trust gate, fingerprint, or drift detection is performed.
 */
export async function getMcpTools(
  projectName: string,
  server: McpServerConfig,
): Promise<Awaited<ReturnType<MCPClient['tools']>>> {
  const key = cacheKey(projectName, server.name)
  const existing = clients.get(key)
  if (existing) {
    return existing.tools()
  }

  const client = await createMCPClient({ transport: resolveTransport(server) })
  clients.set(key, client)
  return client.tools()
}

export async function closeAllMcpClients() {
  for (const client of clients.values()) {
    await client.close()
  }
  clients.clear()
}
