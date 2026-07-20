import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // sharp (native dep pulled in by next) fails to build in this monorepo;
  // we don't use next/image optimization, so disable it. Also required for
  // Electron packaging later.
  images: { unoptimized: true },
  // Transpile workspace packages (Next 15 needs this for monorepo TS sources).
  transpilePackages: ['@open-scientist/schema'],
  // Proxy /api/* to the Hono backend (apps/api on :3000) so the browser stays
  // same-origin and we avoid CORS entirely. Works in dev (Next proxy) and prod
  // (deploy behind a single reverse proxy that routes /api/* → api).
  async rewrites() {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000'
    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/api/:path*`,
      },
    ]
  },
  // react-force-graph-3d / three ship untranspiled ESM; let Next handle it.
  experimental: {
    optimizePackageImports: ['lucide-react', '@xyflow/react'],
  },
}

export default config
