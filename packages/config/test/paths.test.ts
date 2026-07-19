import { describe, expect, it } from 'vitest'
import { getGlobalDbPath, getMhdDir, getProjectDir, getWorkspaceDir } from '../src/index.js'

describe('config paths', () => {
  it('resolves project dir', () => {
    const p = getProjectDir('test-proj')
    expect(p).toContain('projects/test-proj')
  })

  it('resolves workspace dir with hypoId', () => {
    const p = getWorkspaceDir('proj', 'hypo-1')
    expect(p).toContain('projects/proj/workspace/hypo-1')
  })

  it('resolves global db path', () => {
    const p = getGlobalDbPath()
    expect(p.endsWith('global.sqlite')).toBe(true)
  })

  it('resolves mhd dir', () => {
    const p = getMhdDir('proj')
    expect(p).toContain('projects/proj/mhd')
  })
})
