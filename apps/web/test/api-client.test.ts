import { describe, expect, it } from 'vite-plus/test'
import { apiEndpoint } from '../src/lib/api/client.ts'

describe('apiEndpoint', () => {
  it('routes relative REST and SSE paths through one normalized API origin', () => {
    expect(apiEndpoint('/api/projects/demo/runs', 'http://127.0.0.1:3002/')).toBe(
      'http://127.0.0.1:3002/api/projects/demo/runs',
    )
    expect(apiEndpoint('api/projects/demo/runs/run-1/stream', 'http://127.0.0.1:3002')).toBe(
      'http://127.0.0.1:3002/api/projects/demo/runs/run-1/stream',
    )
  })

  it('preserves absolute artifact URLs returned by the backend', () => {
    expect(apiEndpoint('https://artifacts.example/figure.png', 'http://127.0.0.1:3002')).toBe(
      'https://artifacts.example/figure.png',
    )
  })
})
