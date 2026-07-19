import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MhdConfigSchema } from '@open-scientist/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * mhdConfigTool.execute calls getMhdDir(runId) → resolve(getBaseDir(), 'projects', runId, 'mhd').
 * getBaseDir() reads the module-scope `env` constant (captured at import time), so each
 * test sets BASE_DIR + vi.resetModules() before dynamically importing the tool.
 */
let tmp: string

beforeEach(() => {
  vi.resetModules()
  tmp = mkdtempSync(join(tmpdir(), 'os-mhd-config-'))
  process.env.BASE_DIR = tmp
})

afterEach(() => {
  delete process.env.BASE_DIR
  rmSync(tmp, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function loadTool() {
  const mod = await import('../src/mhd-config.js')
  return mod.mhdConfigTool as unknown as {
    execute: (args: {
      runId: string
      winningHypoId: string
      hypothesisStatement: string
      physicalParams: Record<string, number>
    }) => Promise<{
      runId: string
      cfgPath: string
      observationProposal: string
      summary: string
    }>
  }
}

const INPUT = {
  runId: 'run-xyz',
  winningHypoId: 'h-7',
  hypothesisStatement: 'AC wave heating via Alfvén wave dissipation',
  physicalParams: { temperature: 1e6, beta: 0.1, magneticField: 5e-4 },
}

describe('mhdConfigTool.execute', () => {
  it('writes a .cfg file under <BASE_DIR>/projects/<runId>/mhd/<runId>.cfg', async () => {
    const tool = await loadTool()
    const result = await tool.execute(INPUT)

    expect(result.runId).toBe('run-xyz')
    expect(result.cfgPath).toContain(join('projects', 'run-xyz', 'mhd'))
    expect(result.cfgPath.endsWith('run-xyz.cfg')).toBe(true)

    const cfg = await readFile(result.cfgPath, 'utf-8')
    expect(cfg).toContain('run-xyz')
    expect(cfg).toContain('h-7')
    expect(cfg).toContain('AC wave heating via Alfvén wave dissipation')
  })

  it('writes all physicalParams as key = value lines', async () => {
    const tool = await loadTool()
    const result = await tool.execute(INPUT)
    const cfg = await readFile(result.cfgPath, 'utf-8')

    expect(cfg).toContain('temperature = 1000000')
    expect(cfg).toContain('beta = 0.1')
    expect(cfg).toContain('magneticField = 0.0005')
  })

  it('returns a result that satisfies MhdConfigSchema', async () => {
    const tool = await loadTool()
    const result = await tool.execute(INPUT)
    const parsed = MhdConfigSchema.parse(result)
    expect(parsed.runId).toBe('run-xyz')
    expect(parsed.cfgPath).toBe(result.cfgPath)
    expect(parsed.observationProposal).toContain('h-7')
    expect(parsed.summary).toContain('AC wave heating via Alfvén wave dissipation')
  })

  it('handles multiple physicalParams entries', async () => {
    const tool = await loadTool()
    const result = await tool.execute({
      runId: 'run-multi',
      winningHypoId: 'h-multi',
      hypothesisStatement: 'turbulent heating',
      physicalParams: {
        density: 1e15,
        velocity: 2e5,
        pressure: 0.03,
        viscosity: 1e-6,
        resistivity: 1e-7,
      },
    })
    const cfg = await readFile(result.cfgPath, 'utf-8')
    expect(cfg).toContain('density = 1000000000000000')
    expect(cfg).toContain('velocity = 200000')
    expect(cfg).toContain('pressure = 0.03')
    expect(cfg).toContain('viscosity = 0.000001')
    expect(cfg).toContain('resistivity = 1e-7')
    expect(result.cfgPath.endsWith('run-multi.cfg')).toBe(true)
  })
})
