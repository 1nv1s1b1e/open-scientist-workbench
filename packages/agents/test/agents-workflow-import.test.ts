import { describe, expect, it } from 'vite-plus/test'

/**
 * Smoke tests: ensure all 6 workflow.ts files import cleanly and export a
 * workflow function. The workflow bodies cannot be exercised in vitest (they
 * call `getWritable()`, which only resolves inside a workflow runtime context),
 * but importing the module must not throw — this catches import-time errors,
 * bad re-exports, and missing dependencies.
 */
describe('workflow module imports (smoke)', () => {
  it('sisyphus exports tournamentWorkflow as a function', async () => {
    const mod = await import('../src/sisyphus/workflow.ts')
    expect(typeof mod.tournamentWorkflow).toBe('function')
  })

  it('librarian exports librarianWorkflow as a function', async () => {
    const mod = await import('../src/librarian/workflow.ts')
    expect(typeof mod.librarianWorkflow).toBe('function')
  })

  it('looker exports lookerWorkflow as a function', async () => {
    const mod = await import('../src/looker/workflow.ts')
    expect(typeof mod.lookerWorkflow).toBe('function')
  })

  it('explore exports exploreWorkflow as a function', async () => {
    const mod = await import('../src/explore/workflow.ts')
    expect(typeof mod.exploreWorkflow).toBe('function')
  })

  it('oracle exports oracleWorkflow as a function', async () => {
    const mod = await import('../src/oracle/workflow.ts')
    expect(typeof mod.oracleWorkflow).toBe('function')
  })

  it('prometheus exports prometheusWorkflow as a function', async () => {
    const mod = await import('../src/prometheus/workflow.ts')
    expect(typeof mod.prometheusWorkflow).toBe('function')
  })

  it('oracle workflow module re-exports the extracted logic helpers', async () => {
    const mod = await import('../src/oracle/index.ts')
    expect(typeof mod.buildHypothesesBlock).toBe('function')
    expect(typeof mod.buildEvalSummaryBlock).toBe('function')
  })
})
