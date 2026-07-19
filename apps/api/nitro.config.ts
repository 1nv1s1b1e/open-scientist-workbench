// @ts-check
import { defineNitroConfig } from 'nitro/config'

export default defineNitroConfig({
  modules: ['workflow/nitro'],
  entry: './src/index.ts',
  routes: {
    '/**': './src/index.ts',
  },
  devServer: {
    port: Number(process.env.PORT ?? 3000),
  },
  noExternals: ['@open-scientist/agents'],
})
