import { resolve } from 'node:path'
import { env } from './env.js'

export function getBaseDir(): string {
  return resolve(env.BASE_DIR)
}

export function getProjectDir(name: string): string {
  return resolve(getBaseDir(), 'projects', name)
}

export function getWorkspaceDir(project: string, hypoId: string): string {
  return resolve(getProjectDir(project), 'workspace', hypoId)
}

export function getEvidenceDir(project: string, hypoId: string): string {
  return resolve(getProjectDir(project), 'evidence', hypoId)
}

export function getMhdDir(project: string): string {
  return resolve(getProjectDir(project), 'mhd')
}

export function getSkillsDir(project: string): string {
  return resolve(getProjectDir(project), 'skills')
}

export function getMcpConfigPath(project: string): string {
  return resolve(getProjectDir(project), 'mcp', 'config.json')
}

export function getPromptsDir(project: string): string {
  return resolve(getProjectDir(project), 'prompts')
}

export function getGlobalDbPath(): string {
  return resolve(getBaseDir(), 'global.sqlite')
}

export function getProjectDbPath(project: string): string {
  return resolve(getProjectDir(project), 'db.sqlite')
}

export function getRunsDir(project: string, runId: string): string {
  return resolve(getProjectDir(project), 'runs', runId)
}

export function getRoundsDir(project: string, round: number): string {
  return resolve(getProjectDir(project), 'rounds', String(round))
}

export function getHypothesisDir(project: string, hypoId: string): string {
  return resolve(getProjectDir(project), 'hypotheses', hypoId)
}
