import { Hono } from 'hono'
import { registerRoutes } from './routes'

const app = new Hono()

registerRoutes(app)

app.notFound((c) => {
  return c.json({ error: 'not_found', message: 'Route not found' }, 404)
})

app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err)
  return c.json({ error: 'internal_error', message }, 500)
})

export default app
