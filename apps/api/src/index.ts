import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { registerRoutes } from './routes'

const app = new Hono()

// Allow the web frontend (localhost:5173) to call the API directly for SSE
// streaming endpoints that bypass the Next.js rewrite proxy.
app.use(
  '/api/*',
  cors({
    origin: '*',
    exposeHeaders: ['x-workflow-run-id', 'x-workflow-stream-tail-index'],
  }),
)

registerRoutes(app)

app.notFound((c) => {
  return c.json({ error: 'not_found', message: 'Route not found' }, 404)
})

app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err)
  return c.json({ error: 'internal_error', message }, 500)
})

export default app
