import {
  createMCPClient,
  type MCPClient,
  type MCPClientConfig,
  type MCPTransport,
} from '@ai-sdk/mcp'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export interface McpServerConfig {
  name: string
  transport: 'http' | 'stdio' | 'sse'
  url?: string
  command?: string
  args?: string[]
  headers?: Record<string, string>
}

const clients = new Map<string, MCPClient>()

function resolveTransport(server: McpServerConfig): MCPClientConfig['transport'] {
  if (server.transport === 'http') {
    return { type: 'http', url: server.url!, headers: server.headers }
  }
  if (server.transport === 'sse') {
    return { type: 'sse', url: server.url!, headers: server.headers }
  }
  const stdio: MCPTransport = new StdioClientTransport({
    command: server.command!,
    args: server.args ?? [],
  })
  return stdio
}

export async function getMcpTools(server: McpServerConfig) {
  const existing = clients.get(server.name)
  if (existing) return existing.tools()

  const client = await createMCPClient({ transport: resolveTransport(server) })
  clients.set(server.name, client)
  return client.tools()
}

export async function closeAllMcpClients() {
  for (const client of clients.values()) {
    await client.close()
  }
  clients.clear()
}
