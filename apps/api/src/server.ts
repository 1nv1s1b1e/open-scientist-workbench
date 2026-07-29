import { serve } from '@hono/node-server'
import { closeAllMcpClients } from '@open-scientist/mcp'
import app from './index'

const port = Number(process.env.PORT ?? 3000)

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`@open-scientist/api listening on http://localhost:${info.port}`)
  },
)

// Graceful shutdown: close cached MCP clients (stdio transports) on SIGTERM/SIGINT.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    await closeAllMcpClients()
    process.exit(0)
  })
}
