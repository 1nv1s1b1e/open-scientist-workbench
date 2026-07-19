import { z } from 'zod'

export const EnvSchema = z.object({
  BASE_DIR: z.string().default('./data'),
  PORT: z.coerce.number().default(3000),
  HELIX_URL: z.string().default('http://localhost:6969'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(): Env {
  return EnvSchema.parse({
    BASE_DIR: process.env.BASE_DIR,
    PORT: process.env.PORT,
    HELIX_URL: process.env.HELIX_URL,
    LOG_LEVEL: process.env.LOG_LEVEL,
  })
}

// Dynamic env: every property access re-parses process.env, so tests can
// simply set `process.env.BASE_DIR = tmpdir` without vi.resetModules().
// The Proxy keeps `env.BASE_DIR` call-site syntax unchanged for all
// consumers (paths.ts, health.ts, helix client.ts).
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return loadEnv()[prop as keyof Env]
  },
})
