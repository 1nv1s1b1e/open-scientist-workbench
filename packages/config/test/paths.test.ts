import { existsSync } from 'node:fs'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import {
  env,
  getBaseDir,
  findMonorepoRoot,
  getGlobalDbPath,
  getMhdDir,
  getProjectDbPath,
  getProjectDir,
  getRoundsDir,
  getWorkspaceDir,
} from '../src/index.ts'

describe('config paths', () => {
  it('resolves the monorepo root from a Windows file URL without duplicating the drive', () => {
    const expected = resolve(findMonorepoRoot(import.meta.dirname), env.BASE_DIR)

    expect(getBaseDir()).toBe(expected)
    expect(getBaseDir()).not.toMatch(/^[A-Za-z]:\\[A-Za-z]:\\/)
  })

  it('resolves project dir', () => {
    const p = getProjectDir('test-proj')
    expect(p).toContain(join('projects', 'test-proj'))
  })

  it('resolves workspace dir with runId + hypoId', () => {
    const p = getWorkspaceDir('proj', 'run-1', 'hypo-1')
    expect(p).toContain(join('projects', 'proj', 'runs', 'run-1', 'hypo-1'))
  })

  it('resolves global db path', () => {
    const p = getGlobalDbPath()
    expect(p.endsWith('global.sqlite')).toBe(true)
  })

  it('resolves mhd dir', () => {
    const p = getMhdDir('proj')
    expect(p).toContain(join('projects', 'proj', 'mhd'))
  })

  it('resolves project db path', () => {
    const p = getProjectDbPath('proj')
    expect(p.endsWith('db.sqlite')).toBe(true)
    expect(p).toContain(join('projects', 'proj'))
  })

  it('resolves rounds dir with numeric round', () => {
    const p = getRoundsDir('proj', 7)
    expect(p).toContain(join('projects', 'proj', 'rounds', '7'))
  })
})

describe('findMonorepoRoot', () => {
  it('finds the actual monorepo root (has pnpm-workspace.yaml)', () => {
    const root = findMonorepoRoot(import.meta.dirname)
    expect(root).not.toBe(import.meta.dirname)
    expect(existsSync(join(root, 'pnpm-workspace.yaml'))).toBe(true)
  })

  it('finds the root from a deep subdirectory', async () => {
    const deep = join(import.meta.dirname, 'a', 'b', 'c', 'd')
    await mkdir(deep, { recursive: true })
    const root = findMonorepoRoot(deep)
    expect(root).not.toBe(deep)
    expect(existsSync(join(root, 'pnpm-workspace.yaml'))).toBe(true)
  })

  it('returns the start dir as fallback when no pnpm-workspace.yaml is found', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'os-paths-'))
    const start = join(tmp, 'nested')
    await mkdir(start, { recursive: true })
    const root = findMonorepoRoot(start)
    expect(root).toBe(start)
  })
})
