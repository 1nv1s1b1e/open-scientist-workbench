import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { env } from './env.ts'

// Detect monorepo root by walking up from this source file looking for
// pnpm-workspace.yaml. This makes `BASE_DIR` (and thus `data/`, `global.sqlite`,
// per-project dirs) resolve consistently to `<monorepo-root>/data` regardless
// of which workspace package's cwd the process started from (e.g. `nitro dev`
// runs from `apps/api`, but data must live at the repo root).
function findMonorepoRoot(start: string): string {
  let dir = start
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return start // reached filesystem root, fall back
    dir = parent
  }
}

const MONOREPO_ROOT = findMonorepoRoot(dirname(new URL(import.meta.url).pathname))

export function getBaseDir(): string {
  // Resolve BASE_DIR relative to the monorepo root so that `./data` always
  // means `<repo-root>/data`, not `<cwd>/data`.
  return resolve(MONOREPO_ROOT, env.BASE_DIR)
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
