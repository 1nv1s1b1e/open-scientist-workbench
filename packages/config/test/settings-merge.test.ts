import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { getSettings } from '../src/settings.ts'

const BASE_DIR_KEY = 'BASE_DIR'

let baseDir: string

beforeEach(async () => {
  delete process.env[BASE_DIR_KEY]
  baseDir = await mkdtemp(join(tmpdir(), 'os-merge-'))
  process.env[BASE_DIR_KEY] = baseDir
})

afterEach(async () => {
  delete process.env[BASE_DIR_KEY]
  await rm(baseDir, { recursive: true, force: true })
})

async function writeGlobalSettings(data: Record<string, unknown>): Promise<void> {
  await writeFile(join(baseDir, 'settings.json'), JSON.stringify(data, null, 2), 'utf-8')
}

async function writeProjectSettings(
  projectName: string,
  data: Record<string, unknown>,
): Promise<void> {
  const dir = join(baseDir, 'projects', projectName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'settings.json'), JSON.stringify(data, null, 2), 'utf-8')
}

describe('getSettings merge', () => {
  it('returns global defaults when no projectName is given', async () => {
    const settings = await getSettings(undefined)
    expect(settings.models).toEqual({})
    expect(settings.tournament.maxRounds).toBe(10)
    expect(settings.tournament.targetF1).toBe(0.9)
    expect(settings.concurrency.maxConcurrentRuns).toBe(4)
    expect(settings.steering.mode).toBe('one-at-a-time')
    expect(settings.agents.librarian?.mcpServers).toHaveLength(2)
  })

  it('project overrides global models atomically (replace, not deep merge)', async () => {
    await writeGlobalSettings({
      models: {
        librarian: { model: 'gpt-4o', credentialId: 'cred-a', thinkingLevel: 'medium' },
        oracle: { model: 'gpt-4o-mini', credentialId: 'cred-a', thinkingLevel: 'low' },
      },
      tournament: {
        maxRounds: 10,
        targetF1: 0.9,
        convergenceWindow: 3,
        convergenceThreshold: 0.005,
      },
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
    })
    await writeProjectSettings('proj1', {
      models: {
        librarian: { model: 'claude-3', credentialId: 'cred-b', thinkingLevel: 'high' },
      },
    })

    const settings = await getSettings('proj1')
    expect(settings.models.librarian?.model).toBe('claude-3')
    expect(settings.models.librarian?.credentialId).toBe('cred-b')
    expect(settings.models.oracle?.model).toBe('gpt-4o-mini')
  })

  it('project overrides tournament atomically (shallow merge drops global fields)', async () => {
    await writeGlobalSettings({
      models: {},
      tournament: {
        maxRounds: 10,
        targetF1: 0.9,
        convergenceWindow: 3,
        convergenceThreshold: 0.005,
      },
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
    })
    await writeProjectSettings('proj2', {
      tournament: { targetF1: 0.95 },
    })

    const settings = await getSettings('proj2')
    expect(settings.tournament.targetF1).toBe(0.95)
    expect(settings.tournament.maxRounds).toBe(10)
    expect(settings.tournament.convergenceWindow).toBe(3)
    expect(settings.tournament.convergenceThreshold).toBe(0.005)
  })

  it('agents union: global + project role keys are merged', async () => {
    await writeGlobalSettings({
      models: {},
      tournament: {
        maxRounds: 10,
        targetF1: 0.9,
        convergenceWindow: 3,
        convergenceThreshold: 0.005,
      },
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
      agents: {
        librarian: { instructions: 'global-librarian' },
      },
    })
    await writeProjectSettings('proj3', {
      agents: {
        oracle: { instructions: 'project-oracle' },
      },
    })

    const settings = await getSettings('proj3')
    expect(settings.agents.librarian?.instructions).toBe('global-librarian')
    expect(settings.agents.oracle?.instructions).toBe('project-oracle')
  })

  it('agents override: project fields win for a shared role (field-level merge)', async () => {
    await writeGlobalSettings({
      models: {},
      tournament: {
        maxRounds: 10,
        targetF1: 0.9,
        convergenceWindow: 3,
        convergenceThreshold: 0.005,
      },
      concurrency: { maxConcurrentRuns: 4 },
      steering: { mode: 'one-at-a-time' },
      agents: {
        librarian: { instructions: 'global-librarian' },
      },
    })
    await writeProjectSettings('proj4', {
      agents: {
        librarian: {
          mcpServers: [{ name: 'custom-mcp', transport: 'http', url: 'http://localhost:1234' }],
        },
      },
    })

    const settings = await getSettings('proj4')
    expect(settings.agents.librarian?.instructions).toBe('global-librarian')
    expect(settings.agents.librarian?.mcpServers).toHaveLength(1)
    expect(settings.agents.librarian?.mcpServers?.[0]?.name).toBe('custom-mcp')
  })
})
