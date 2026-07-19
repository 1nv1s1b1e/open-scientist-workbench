import { env } from '@open-scientist/config'
import { Hono } from 'hono'

export const health = new Hono()

health.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    baseDir: env.BASE_DIR,
  })
})
