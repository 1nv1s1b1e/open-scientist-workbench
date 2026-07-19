import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'drizzle-kit'

const configDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(configDir, '..', '..')
const dbPath = resolve(repoRoot, 'data', 'global.sqlite')

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/global.ts',
  out: './drizzle/global',
  dbCredentials: {
    url: dbPath,
  },
})
