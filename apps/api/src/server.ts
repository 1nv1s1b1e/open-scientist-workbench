import { serve } from '@hono/node-server'
import app from './index'

const port = Number(process.env.PORT ?? 3000)

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    // eslint-disable-next-line no-console
    console.log(`@open-scientist/api listening on http://localhost:${info.port}`)
  },
)
