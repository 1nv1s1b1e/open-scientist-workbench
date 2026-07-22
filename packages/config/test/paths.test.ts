import { describe, expect, it } from 'vite-plus/test'
import {
  getEvidenceDir,
  getGlobalDbPath,
  getHypothesisDir,
  getMcpConfigPath,
  getMhdDir,
  getProjectDbPath,
  getProjectDir,
  getPromptsDir,
  getRoundsDir,
  getRunsDir,
  getSkillsDir,
  getWorkspaceDir,
} from '../src/index.ts'

describe('config paths', () => {
  it('resolves project dir', () => {
    const p = getProjectDir('test-proj')
    expect(p).toContain('projects/test-proj')
  })

  it('resolves workspace dir with runId + hypoId', () => {
    const p = getWorkspaceDir('proj', 'run-1', 'hypo-1')
    expect(p).toContain('projects/proj/runs/run-1/workspace/hypo-1')
  })

  it('resolves global db path', () => {
    const p = getGlobalDbPath()
    expect(p.endsWith('global.sqlite')).toBe(true)
  })

  it('resolves mhd dir', () => {
    const p = getMhdDir('proj')
    expect(p).toContain('projects/proj/mhd')
  })

  it('resolves evidence dir with hypoId', () => {
    const p = getEvidenceDir('proj', 'h1')
    expect(p).toContain('projects/proj/evidence/h1')
  })

  it('resolves skills dir', () => {
    const p = getSkillsDir('proj')
    expect(p).toContain('projects/proj/skills')
  })

  it('resolves mcp config path', () => {
    const p = getMcpConfigPath('proj')
    expect(p).toContain('projects/proj/mcp/config.json')
  })

  it('resolves prompts dir', () => {
    const p = getPromptsDir('proj')
    expect(p).toContain('projects/proj/prompts')
  })

  it('resolves project db path', () => {
    const p = getProjectDbPath('proj')
    expect(p.endsWith('db.sqlite')).toBe(true)
    expect(p).toContain('projects/proj')
  })

  it('resolves runs dir with runId', () => {
    const p = getRunsDir('proj', 'run-42')
    expect(p).toContain('projects/proj/runs/run-42')
  })

  it('resolves rounds dir with numeric round', () => {
    const p = getRoundsDir('proj', 7)
    expect(p).toContain('projects/proj/rounds/7')
  })

  it('resolves hypothesis dir with hypoId', () => {
    const p = getHypothesisDir('proj', 'h-9')
    expect(p).toContain('projects/proj/hypotheses/h-9')
  })
})
