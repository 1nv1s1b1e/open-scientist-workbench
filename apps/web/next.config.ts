import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // sharp (native dep pulled in by next) fails to build in this monorepo;
  // we don't use next/image optimization, so disable it. Also required for
  // Electron packaging later.
  images: { unoptimized: true },
  // Transpile workspace packages (Next 15 needs this for monorepo TS sources).
  transpilePackages: ['@open-scientist/schema'],
  // Same-origin fallback for deployments that do not set the browser-visible
  // NEXT_PUBLIC_API_BASE_URL. When that variable is set, the API client sends
  // both REST and SSE traffic directly to the same configured Hono origin.
  async rewrites() {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000'
    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/api/:path*`,
      },
    ]
  },
  experimental: {
    optimizePackageImports: ['lucide-react', '@xyflow/react'],
  },
}

export default config
